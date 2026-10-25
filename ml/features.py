"""Vital-sign trajectory features, shared by training and the TypeScript port.

Every feature is computable from hourly vitals a patient at home also has. ICU-only signals
(labs, length of stay, how often staff charted a value) are left out on purpose so the model
cannot lean on hospital workflow.

The definitions here are the contract for spacetimedb/src/riskModel.ts; tests compare the two.
"""

from __future__ import annotations

import numpy as np

RAW = ["HR", "O2Sat", "Temp", "SBP", "DBP", "Resp"]
SIGNALS = RAW + ["MAP", "SI"]
STATS = ["last", "mean6", "min6", "max6", "std6", "mean24", "min24", "max24", "std24", "slope6", "delta24"]
FEATURES = [f"{s}_{k}" for s in SIGNALS for k in STATS] + ["Age"]


def derived(raw: np.ndarray) -> np.ndarray:
    """raw: (T, 6) hourly values with NaN for unmeasured -> (T, 8) adding MAP and shock index."""
    hr, sbp, dbp = raw[:, 0], raw[:, 3], raw[:, 4]
    with np.errstate(invalid="ignore", divide="ignore"):
        map_ = (sbp + 2 * dbp) / 3
        si = np.where(sbp > 0, hr / sbp, np.nan)
    return np.column_stack([raw, map_, si])


def reference_features(raw: np.ndarray, age: float) -> np.ndarray:
    """Slow, literal definition (one patient). Used to check the fast path and to build fixtures."""
    sig = derived(raw)
    T = sig.shape[0]
    out = np.full((T, len(FEATURES)), np.nan)
    for t in range(T):
        col = 0
        for s in range(sig.shape[1]):
            v = sig[:, s]
            seen = [j for j in range(t + 1) if not np.isnan(v[j])]
            last = v[seen[-1]] if seen else np.nan
            row = [last]
            stats = {}
            for w in (6, 24):
                js = [j for j in seen if j >= t - w + 1]
                ys = np.array([v[j] for j in js])
                if len(ys):
                    m = ys.mean()
                    stats[w] = (m, ys.min(), ys.max(), np.sqrt(((ys - m) ** 2).mean()) if len(ys) >= 2 else np.nan)
                else:
                    stats[w] = (np.nan, np.nan, np.nan, np.nan)
                if w == 6:
                    xs6, ys6 = np.array(js, dtype=float), ys
            row += list(stats[6]) + list(stats[24])
            n = len(ys6)
            den = n * (xs6**2).sum() - xs6.sum() ** 2 if n else 0.0
            row.append((n * (xs6 * ys6).sum() - xs6.sum() * ys6.sum()) / den if n >= 2 and den != 0 else np.nan)
            row.append(last - stats[24][0])
            out[t, col : col + len(STATS)] = row
            col += len(STATS)
        out[t, -1] = age
    return out


def _windowed(v: np.ndarray, w: int):
    """(T,) -> (T, w) trailing windows including t, NaN-padded before the start."""
    pad = np.concatenate([np.full(w - 1, np.nan), v])
    return np.lib.stride_tricks.sliding_window_view(pad, w)


def fast_features(raw: np.ndarray, age: float) -> np.ndarray:
    """Vectorized equivalent of reference_features for one patient."""
    sig = derived(raw)
    T = sig.shape[0]
    cols = []
    idx = np.arange(T, dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"), _quiet():
        for s in range(sig.shape[1]):
            v = sig[:, s]
            observed = ~np.isnan(v)
            last_idx = np.maximum.accumulate(np.where(observed, np.arange(T), -1))
            last = np.where(last_idx >= 0, v[np.maximum(last_idx, 0)], np.nan)
            feats = [last]
            means = {}
            for w in (6, 24):
                win = _windowed(v, w)
                n = (~np.isnan(win)).sum(1)
                m = np.nanmean(win, 1)
                sd = np.sqrt(np.nanmean((win - m[:, None]) ** 2, 1))
                feats += [m, np.nanmin(win, 1), np.nanmax(win, 1), np.where(n >= 2, sd, np.nan)]
                means[w] = m
            win = _windowed(v, 6)
            xs = _windowed(idx, 6)
            mask = ~np.isnan(win)
            n = mask.sum(1)
            x = np.where(mask, xs, 0.0)
            y = np.where(mask, win, 0.0)
            den = n * (x**2).sum(1) - x.sum(1) ** 2
            slope = (n * (x * y).sum(1) - x.sum(1) * y.sum(1)) / den
            feats.append(np.where((n >= 2) & (den != 0), slope, np.nan))
            feats.append(last - means[24])
            cols += feats
    cols.append(np.full(T, float(age)))
    return np.column_stack(cols)


class _quiet:
    """Silences numpy's all-NaN slice warnings inside fast_features."""

    def __enter__(self):
        import warnings

        self._ctx = warnings.catch_warnings()
        self._ctx.__enter__()
        warnings.simplefilter("ignore", category=RuntimeWarning)

    def __exit__(self, *exc):
        self._ctx.__exit__(*exc)


def news2(raw_last: np.ndarray) -> np.ndarray:
    """NEWS2 from the latest vitals, assuming alert and on room air (the home pod has neither input).
    raw_last: (N, 6) in RAW order. Missing values score 0, as a nurse could not chart them."""
    hr, spo2, temp, sbp, _dbp, rr = (raw_last[:, i] for i in range(6))
    score = np.zeros(len(raw_last))

    def band(x, edges):
        s = np.zeros(len(x))
        for cond, pts in edges:
            s = np.where(~np.isnan(x) & cond(x), pts, s)
        return s

    score += band(rr, [(lambda x: x <= 8, 3), (lambda x: (x >= 9) & (x <= 11), 1), (lambda x: (x >= 21) & (x <= 24), 2), (lambda x: x >= 25, 3)])
    score += band(spo2, [(lambda x: x <= 91, 3), (lambda x: (x >= 92) & (x <= 93), 2), (lambda x: (x >= 94) & (x <= 95), 1)])
    score += band(sbp, [(lambda x: x <= 90, 3), (lambda x: (x >= 91) & (x <= 100), 2), (lambda x: (x >= 101) & (x <= 110), 1), (lambda x: x >= 220, 3)])
    score += band(hr, [(lambda x: x <= 40, 3), (lambda x: (x >= 41) & (x <= 50), 1), (lambda x: (x >= 91) & (x <= 110), 1), (lambda x: (x >= 111) & (x <= 130), 2), (lambda x: x >= 131, 3)])
    score += band(temp, [(lambda x: x <= 35.0, 3), (lambda x: (x >= 35.1) & (x <= 36.0), 1), (lambda x: (x >= 38.1) & (x <= 39.0), 1), (lambda x: x >= 39.1, 2)])
    return score


def qsofa(raw_last: np.ndarray) -> np.ndarray:
    """Partial qSOFA (respiratory rate >= 22, systolic <= 100); mental status is not available."""
    rr, sbp = raw_last[:, 5], raw_last[:, 3]
    return (np.nan_to_num(rr) >= 22).astype(float) + ((~np.isnan(sbp)) & (sbp <= 100)).astype(float)
