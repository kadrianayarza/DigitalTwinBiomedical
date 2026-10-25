"""Train the deterioration (sepsis-onset) early-warning model on PhysioNet 2019 and export it.

  ml/.venv/bin/python ml/train.py            # expects ~/.cache/physionet2019/setA, setB

Data: PhysioNet/CinC Challenge 2019, open access, CC BY 4.0. Hospital system A trains the model
(15% of its patients held out for early stopping, calibration and thresholds); hospital system B
is never seen during training and serves as the external test set.

Target: for every hour of a stay, will sepsis begin within the next 6 hours? Hours after onset
are dropped, because detecting sepsis that is already established is not early warning.
"""

from __future__ import annotations

import json
import math
import pickle
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_curve, roc_auc_score, roc_curve

sys.path.insert(0, str(Path(__file__).parent))
from features import FEATURES, RAW, SIGNALS, STATS, fast_features, news2, qsofa, reference_features  # noqa: E402

DATA = Path.home() / ".cache" / "physionet2019"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "ml" / ".cache"
REPORT = ROOT / "ml" / "report"
TS_OUT = ROOT / "spacetimedb" / "src" / "riskModelData.ts"
FIXTURE = ROOT / "tests" / "fixtures" / "riskModel.json"
SEED = 13
HORIZON_H = 6


def load_set(name: str):
    path = CACHE / f"{name}.pkl"
    if path.exists():
        return pickle.loads(path.read_bytes())
    patients = []
    for f in sorted((DATA / name).glob("p*.psv")):
        df = pd.read_csv(f, sep="|")
        patients.append(
            {
                "id": f.stem,
                "raw": df[RAW].to_numpy(dtype=float),
                "age": float(df["Age"].iloc[0]),
                "label": df["SepsisLabel"].to_numpy(dtype=int),
            }
        )
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(patients))
    return patients


def rows(patients):
    """Feature rows, labels, patient index, hours-to-onset and the raw latest vitals for baselines."""
    X, y, pid, to_onset, last_raw = [], [], [], [], []
    for i, p in enumerate(patients):
        lab = p["label"]
        septic = lab.any()
        first = int(np.argmax(lab)) if septic else len(lab)
        onset = first + HORIZON_H if septic else None
        keep = len(lab) if not septic else min(len(lab), onset)
        if keep == 0:
            continue
        F = fast_features(p["raw"][:keep], p["age"])
        X.append(F)
        hrs = np.arange(keep)
        y.append((hrs >= first).astype(int) if septic else np.zeros(keep, int))
        pid.append(np.full(keep, i))
        to_onset.append(onset - hrs if septic else np.full(keep, np.nan))
        last_raw.append(F[:, [FEATURES.index(f"{s}_last") for s in RAW]])
    return (
        np.vstack(X).astype(np.float32),
        np.concatenate(y),
        np.concatenate(pid),
        np.concatenate(to_onset),
        np.vstack(last_raw),
    )


def check_fast_matches_reference(patients, n=40):
    rng = np.random.default_rng(SEED)
    for i in rng.choice(len(patients), n, replace=False):
        p = patients[i]
        a = fast_features(p["raw"], p["age"])
        b = reference_features(p["raw"], p["age"])
        assert np.allclose(a, b, equal_nan=True, rtol=1e-9, atol=1e-9), p["id"]
    print(f"fast features match the reference definition on {n} patients")


def threshold_at_specificity(scores, labels, spec):
    neg = np.sort(scores[labels == 0])
    return float(neg[min(len(neg) - 1, int(math.ceil(spec * len(neg))))])


def operating_point(scores, labels, thr):
    pred = scores >= thr
    tp = int((pred & (labels == 1)).sum())
    fp = int((pred & (labels == 0)).sum())
    fn = int((~pred & (labels == 1)).sum())
    tn = int((~pred & (labels == 0)).sum())
    return {
        "threshold": round(float(thr), 4),
        "sensitivity": round(tp / max(1, tp + fn), 3),
        "specificity": round(tn / max(1, tn + fp), 3),
        "ppv": round(tp / max(1, tp + fp), 3),
    }


def patient_level(scores, labels, pid, to_onset, thr):
    """Per patient: flagged in the 6 h before onset (septic) or ever flagged (non-septic)."""
    df = pd.DataFrame({"s": scores, "y": labels, "p": pid, "h": to_onset})
    septic = df[df.groupby("p")["y"].transform("max") == 1]
    clean = df[df.groupby("p")["y"].transform("max") == 0]
    caught, lead = 0, []
    for _, g in septic.groupby("p"):
        hit = g[(g.s >= thr) & (g.h <= 12)]
        if len(hit):
            caught += 1
            lead.append(float(hit.h.max()))
    flagged_clean = clean.groupby("p")["s"].max().ge(thr).mean()
    return {
        "septic_patients": int(septic.p.nunique()),
        "caught_within_12h_before_onset": round(caught / max(1, septic.p.nunique()), 3),
        "median_hours_warning": float(np.median(lead)) if lead else None,
        "non_septic_patients_ever_flagged": round(float(flagged_clean), 3),
    }


def f32(x) -> float:
    """Shortest decimal that rounds back to the same float32 (the text dump rounds split values, and vitals
    often sit exactly on a split, so thresholds must survive the round trip bit for bit)."""
    return float(str(np.float32(x)))


def export_trees(booster: xgb.Booster):
    """Flattens each tree from the model's own JSON (exact float32 splits and leaves)."""
    model = json.loads(booster.save_raw("json"))
    names = booster.feature_names
    trees = []
    for t in model["learner"]["gradient_booster"]["model"]["trees"]:
        left, right, cond = t["left_children"], t["right_children"], t["split_conditions"]
        feat, default_left, cover = t["split_indices"], t["default_left"], t["sum_hessian"]

        def value(i):
            if left[i] == -1:
                return cond[i], cover[i]
            vy, cy = value(left[i])
            vn, cn = value(right[i])
            return (vy * cy + vn * cn) / (cy + cn), cy + cn

        flat = []
        for i in range(len(left)):
            if left[i] == -1:
                flat += [-1, 0, 0, 0, 0, f32(cond[i])]
            else:
                missing = left[i] if default_left[i] else right[i]
                flat += [FEATURES.index(names[feat[i]]), f32(cond[i]), left[i], right[i], missing, float(f"{value(i)[0]:.9g}")]
        trees.append(flat)
    return trees


def margin_py(trees, x):
    """Reference traversal with the same float32 comparison the TypeScript port uses."""
    total = 0.0
    for t in trees:
        i = 0
        while t[i * 6] != -1:
            f, thr, yes, no, missing = t[i * 6 : i * 6 + 5]
            v = x[int(f)]
            i = int(missing) if np.isnan(v) else (int(yes) if np.float32(v) < np.float32(thr) else int(no))
        total += t[i * 6 + 5]
    return total


def main():
    A, B = load_set("setA"), load_set("setB")
    print(f"hospital A: {len(A)} patients, hospital B: {len(B)} patients")
    check_fast_matches_reference(A)

    rng = np.random.default_rng(SEED)
    septicA = np.array([p["label"].any() for p in A])
    val_ids = set()
    for flag in (True, False):
        ids = np.where(septicA == flag)[0]
        val_ids |= set(rng.choice(ids, int(0.15 * len(ids)), replace=False).tolist())
    train_p = [p for i, p in enumerate(A) if i not in val_ids]
    val_p = [p for i, p in enumerate(A) if i in val_ids]

    Xtr, ytr, _, _, _ = rows(train_p)
    Xva, yva, pva, hva, rva = rows(val_p)
    Xte, yte, pte, hte, rte = rows(B)
    print(f"rows: train {len(ytr)} ({ytr.mean():.2%} positive), val {len(yva)}, external test {len(yte)} ({yte.mean():.2%})")

    dtr = xgb.DMatrix(Xtr, ytr, feature_names=FEATURES, missing=np.nan)
    dva = xgb.DMatrix(Xva, yva, feature_names=FEATURES, missing=np.nan)
    dte = xgb.DMatrix(Xte, yte, feature_names=FEATURES, missing=np.nan)
    params = {
        "objective": "binary:logistic",
        "eval_metric": ["aucpr", "auc"],
        "tree_method": "hist",
        "max_depth": 4,
        "eta": 0.06,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 20,
        "lambda": 2.0,
        "seed": SEED,
    }
    booster = xgb.train(params, dtr, num_boost_round=400, evals=[(dva, "val")], early_stopping_rounds=40, verbose_eval=50)
    booster = booster[: booster.best_iteration + 1]
    print(f"trees kept: {booster.num_boosted_rounds()}")

    m_va = booster.predict(dva, output_margin=True)
    m_te = booster.predict(dte, output_margin=True)
    platt = LogisticRegression(C=1e6).fit(m_va.reshape(-1, 1), yva)
    a, b = float(platt.coef_[0][0]), float(platt.intercept_[0])
    cal = lambda m: 1 / (1 + np.exp(-(a * m + b)))  # noqa: E731
    p_va, p_te = cal(m_va), cal(m_te)

    thr_elev = threshold_at_specificity(p_va, yva, 0.90)
    thr_high = threshold_at_specificity(p_va, yva, 0.97)

    n2_te, q_te = news2(rte), qsofa(rte)
    n2_spec = 1 - ((n2_te >= 5) & (yte == 0)).sum() / (yte == 0).sum()
    metrics = {
        "data": "PhysioNet/CinC Challenge 2019 (open access, CC BY 4.0)",
        "target": f"sepsis onset within the next {HORIZON_H} hours (hourly), hours after onset excluded",
        "train": {"hospital": "A", "patients": len(train_p), "rows": int(len(ytr)), "positive_rate": round(float(ytr.mean()), 4)},
        "external_test": {"hospital": "B (never seen in training)", "patients": len(B), "rows": int(len(yte)), "positive_rate": round(float(yte.mean()), 4)},
        "trees": booster.num_boosted_rounds(),
        "features": len(FEATURES),
        "auroc": {
            "model": round(roc_auc_score(yte, p_te), 3),
            "news2": round(roc_auc_score(yte, n2_te), 3),
            "qsofa_partial": round(roc_auc_score(yte, q_te), 3),
        },
        "auprc": {
            "model": round(average_precision_score(yte, p_te), 3),
            "news2": round(average_precision_score(yte, n2_te), 3),
            "qsofa_partial": round(average_precision_score(yte, q_te), 3),
            "prevalence": round(float(yte.mean()), 4),
        },
        "brier_calibrated": round(brier_score_loss(yte, p_te), 4),
        "operating_points_external": {
            "elevated (90% specificity on hospital A)": operating_point(p_te, yte, thr_elev),
            "high (97% specificity on hospital A)": operating_point(p_te, yte, thr_high),
            "news2 >= 5": operating_point(n2_te, yte, 5),
            "model at news2>=5 specificity": operating_point(p_te, yte, threshold_at_specificity(p_te, yte, float(n2_spec))),
        },
        "patients_external": {
            "elevated": patient_level(p_te, yte, pte, hte, thr_elev),
            "high": patient_level(p_te, yte, pte, hte, thr_high),
        },
    }

    contrib = booster.predict(xgb.DMatrix(Xte[:: max(1, len(Xte) // 30000)], feature_names=FEATURES, missing=np.nan), pred_contribs=True)
    imp = np.abs(contrib[:, :-1]).mean(0)
    order = np.argsort(-imp)[:15]
    metrics["top_features_mean_abs_shap"] = {FEATURES[i]: round(float(imp[i]), 4) for i in order}

    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps({k: metrics[k] for k in ("auroc", "auprc", "brier_calibrated", "operating_points_external", "patients_external")}, indent=1))
    plots(yte, p_te, n2_te, q_te, imp, order)

    trees = export_trees(booster)
    probe = Xte[rng.choice(len(Xte), 3000, replace=False)]
    m_ref = booster.predict(xgb.DMatrix(probe, feature_names=FEATURES, missing=np.nan), output_margin=True)
    sums = np.array([margin_py(trees, x.astype(float)) for x in probe])
    base = float(np.median(m_ref - sums))
    err = np.abs(m_ref - (sums + base)).max()
    print(f"exported trees reproduce XGBoost margins to {err:.2e} (base {base:.6f})")
    assert err < 1e-4, err

    write_ts(trees, base, a, b, thr_elev, thr_high, metrics)
    write_fixture(B, booster, a, b, trees, base)


def plots(y, p, n2, q, imp, order):
    fig, ax = plt.subplots(figsize=(5, 5))
    for s, name in ((p, "Model"), (n2, "NEWS2"), (q, "qSOFA (partial)")):
        fpr, tpr, _ = roc_curve(y, s)
        ax.plot(fpr, tpr, label=f"{name}  AUROC {roc_auc_score(y, s):.3f}")
    ax.plot([0, 1], [0, 1], ls=":", c="grey")
    ax.set(xlabel="False positive rate", ylabel="True positive rate", title="External test (hospital B)")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(REPORT / "roc.png", dpi=150)

    fig, ax = plt.subplots(figsize=(5, 5))
    for s, name in ((p, "Model"), (n2, "NEWS2"), (q, "qSOFA (partial)")):
        pr, rc, _ = precision_recall_curve(y, s)
        ax.plot(rc, pr, label=f"{name}  AUPRC {average_precision_score(y, s):.3f}")
    ax.axhline(y.mean(), ls=":", c="grey", label=f"Prevalence {y.mean():.3f}")
    ax.set(xlabel="Recall", ylabel="Precision", title="External test (hospital B)")
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(REPORT / "pr.png", dpi=150)

    fig, ax = plt.subplots(figsize=(5, 5))
    frac, mean = calibration_curve(y, p, n_bins=10, strategy="quantile")
    ax.plot(mean, frac, "o-", label="Model (Platt-calibrated on hospital A)")
    ax.plot([0, max(mean.max(), frac.max())], [0, max(mean.max(), frac.max())], ls=":", c="grey", label="Perfect")
    ax.set(xlabel="Predicted probability", ylabel="Observed rate", title="Calibration on hospital B")
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(REPORT / "calibration.png", dpi=150)

    fig, ax = plt.subplots(figsize=(6, 5))
    ax.barh([FEATURES[i] for i in order][::-1], imp[order][::-1])
    ax.set(xlabel="Mean |SHAP| (log-odds)", title="Top features, hospital B")
    fig.tight_layout()
    fig.savefig(REPORT / "importance.png", dpi=150)


def write_ts(trees, base, a, b, thr_elev, thr_high, metrics):
    body = ",\n".join("  [" + ",".join(repr(v) for v in t) + "]" for t in trees)
    summary = {
        "trainedOn": "PhysioNet/CinC Challenge 2019, hospital A",
        "externalTest": "hospital B",
        "auroc": metrics["auroc"]["model"],
        "auprcModel": metrics["auprc"]["model"],
        "aurocNews2": metrics["auroc"]["news2"],
        "auprcNews2": metrics["auprc"]["news2"],
    }
    TS_OUT.write_text(
        "// Generated by ml/train.py. Do not edit by hand.\n"
        "// XGBoost trees: each node is [feature, threshold, yes, no, missing, value]; feature -1 marks a leaf.\n"
        "// `value` on an internal node is the cover-weighted mean of its leaves (used to attribute the score).\n\n"
        f"export const FEATURES = {json.dumps(FEATURES)} as const;\n"
        f"export const SIGNALS = {json.dumps(SIGNALS)} as const;\n"
        f"export const STATS = {json.dumps(STATS)} as const;\n"
        f"export const BASE_MARGIN = {base:.9g};\n"
        f"export const PLATT = [{a:.9g}, {b:.9g}] as const;\n"
        f"export const THRESHOLDS = {{ elevated: {thr_elev:.6g}, high: {thr_high:.6g} }} as const;\n"
        f"export const MODEL_CARD = {json.dumps(summary)} as const;\n"
        f"export const TREES: readonly (readonly number[])[] = [\n{body}\n];\n"
    )
    print(f"wrote {TS_OUT.relative_to(ROOT)} ({TS_OUT.stat().st_size / 1024:.0f} KB, {len(trees)} trees)")


def write_fixture(B, booster, a, b, trees, base):
    rng = np.random.default_rng(SEED + 1)
    septic = [p for p in B if p["label"].any() and 8 <= len(p["label"]) <= 60]
    clean = [p for p in B if not p["label"].any() and 8 <= len(p["label"]) <= 60]
    cases = []
    for p in [septic[i] for i in rng.choice(len(septic), 4, replace=False)] + [clean[i] for i in rng.choice(len(clean), 4, replace=False)]:
        T = min(len(p["label"]), 48)
        raw = p["raw"][:T]
        F = reference_features(raw, p["age"])
        margin = booster.predict(xgb.DMatrix(F.astype(np.float32), feature_names=FEATURES, missing=np.nan), output_margin=True)
        ported = np.array([margin_py(trees, x) for x in F]) + base
        assert np.abs(margin - ported).max() < 1e-4, (p["id"], np.abs(margin - ported).max())
        prob = 1 / (1 + np.exp(-(a * margin + b)))
        hours = sorted({4, T // 2, T - 1})
        cases.append(
            {
                "id": p["id"],
                "age": p["age"],
                "raw": [[None if np.isnan(v) else float(v) for v in r] for r in raw],
                "features": {str(h): [None if np.isnan(v) else float(v) for v in F[h]] for h in hours},
                "prob": [round(float(x), 6) for x in prob],
            }
        )
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps({"raw": RAW, "cases": cases}) + "\n")
    print(f"wrote {FIXTURE.relative_to(ROOT)} ({len(cases)} patients)")


if __name__ == "__main__":
    main()
