"""Quick model comparisons on the same split as train.py (not part of the shipped pipeline)."""

import sys
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import average_precision_score, roc_auc_score

sys.path.insert(0, str(Path(__file__).parent))
import train  # noqa: E402
from features import FEATURES  # noqa: E402

A, B = train.load_set("setA"), train.load_set("setB")
rng = np.random.default_rng(train.SEED)
septicA = np.array([p["label"].any() for p in A])
val_ids = set()
for flag in (True, False):
    ids = np.where(septicA == flag)[0]
    val_ids |= set(rng.choice(ids, int(0.15 * len(ids)), replace=False).tolist())
Xtr, ytr, *_ = train.rows([p for i, p in enumerate(A) if i not in val_ids])
Xva, yva, *_ = train.rows([p for i, p in enumerate(A) if i in val_ids])
Xte, yte, *_ = train.rows(B)
dtr = xgb.DMatrix(Xtr, ytr, feature_names=FEATURES, missing=np.nan)
dva = xgb.DMatrix(Xva, yva, feature_names=FEATURES, missing=np.nan)
dte = xgb.DMatrix(Xte, yte, feature_names=FEATURES, missing=np.nan)

base = {"objective": "binary:logistic", "eval_metric": "auc", "tree_method": "hist", "subsample": 0.8, "seed": 13}
for name, extra in {
    "d4 current": {"max_depth": 4, "eta": 0.06, "colsample_bytree": 0.8, "min_child_weight": 20, "lambda": 2},
    "d6 slow": {"max_depth": 6, "eta": 0.03, "colsample_bytree": 0.6, "min_child_weight": 50, "lambda": 5},
    "d3 slow": {"max_depth": 3, "eta": 0.03, "colsample_bytree": 0.6, "min_child_weight": 50, "lambda": 5},
    "d5 balanced": {"max_depth": 5, "eta": 0.03, "colsample_bytree": 0.5, "min_child_weight": 100, "lambda": 10, "scale_pos_weight": 5},
}.items():
    bst = xgb.train({**base, **extra}, dtr, 800, evals=[(dva, "val")], early_stopping_rounds=60, verbose_eval=False)
    val_auc = bst.best_score
    bst = bst[: bst.best_iteration + 1]
    p = bst.predict(dte)
    print(f"{name:12s} trees {bst.num_boosted_rounds():4d}  val AUROC {val_auc:.3f}  hospital B AUROC {roc_auc_score(yte, p):.3f}  AUPRC {average_precision_score(yte, p):.3f}", flush=True)
