"""Nightly walk-forward re-tuner — the self-improvement / optimise loop.

Grid-searches the fade params on a TRAIN slice, validates out-of-sample on a
held-out TEST slice, and runs a block-permutation null to guard against curve
fitting. Promotes winning params to data/active_params.json only if gates pass.

Multi-window walk-forward (3 expanding OOS slices) prevents a single trending
OOS window from killing the whole run: windows with < OOS_MIN_TRADES are skipped
(regime-dead, not a failure). Passes if MIN_WINDOWS_PASS non-skipped windows
clear all gates; promotes params from the most recent passing window.

CLI:
  python -m goldscalp.optimize --backtest      # eval default params on full cache
  python -m goldscalp.optimize                 # walk-forward + promote if gates pass
  python -m goldscalp.optimize --days 90       # use 90d cache window
"""

from __future__ import annotations

import argparse
import itertools
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from goldscalp.config import (ACTIVE_PARAMS_FILE, DATA_DIR, DEFAULT, Cfg,
                              with_params)
from goldscalp.data.oanda import _load_env, load_cached
from goldscalp.engine_fwd import run_replay, summarize
from goldscalp.mtf_gate import MTFGate

# search grid — small + meaningful (kept tight so the nightly job stays cheap)
GRID = {
    "stretch_entry": [2.0, 2.5, 3.0, 3.5],
    "max_hold_min": [60, 90, 120],
    "spread_room_mult": [1.5, 2.0, 3.0],
    "max_session_vwap_drift_pct": [0.002, 0.004, 0.006],
}
MIN_TRADES = 10       # train: ignore param sets with too few samples (was 20; trending regimes generate sparse trades)
OOS_MIN_TRADES = 3    # OOS: skip window (regime-dead) if below this (VWAP fade is sparse at 3σ)
OOS_SHARPE_GATE = 1.0
DD_GATE_PCT = 15.0
PERM_P_GATE = 0.05
N_PERM = 30
SEED = 42

# Multi-window expanding walk-forward splits (train_end_frac, oos_end_frac).
# OOS window = bars[train_end : oos_end]. Expanding train, non-overlapping OOS.
WF_SPLITS = [
    (0.60, 0.73),
    (0.73, 0.87),
    (0.87, 1.00),
]
MIN_WINDOWS_PASS = 2  # need this many non-skipped windows to clear gates


def evaluate(cfg: Cfg, df: pd.DataFrame, extra_gate=None) -> dict:
    rng = np.random.default_rng(SEED)
    mtf = MTFGate()
    combined = mtf if extra_gate is None else (lambda b, s: mtf(b, s) and extra_gate(b, s))
    gs = run_replay(cfg, df, rng, extra_gate=combined, bar_observer=mtf.update)
    return summarize(gs)


def _param_cfgs():
    keys = list(GRID)
    for combo in itertools.product(*(GRID[k] for k in keys)):
        params = dict(zip(keys, combo))
        yield params, with_params(DEFAULT, params)


def grid_search(train_df: pd.DataFrame) -> tuple[dict, dict]:
    """Return (best_params, best_stats) by train Sharpe with PF>1 & enough trades."""
    best, best_params, best_score = None, None, -1e9
    for params, cfg in _param_cfgs():
        st = evaluate(cfg, train_df)
        if st.get("trades", 0) < MIN_TRADES or st.get("profit_factor", 0) <= 1.0:
            continue
        score = st.get("sharpe_ann", -1e9)
        if score > best_score:
            best, best_params, best_score = st, params, score
    return best_params, best


def _block_shuffle_df(df: pd.DataFrame, rng: np.random.Generator, block: int = 30) -> pd.DataFrame:
    """Null series: block-shuffle close log-returns, rebuild a synthetic OHLC.
    Breaks the mean-reversion structure while preserving the return distribution."""
    out = df.copy().reset_index(drop=True)
    close = out["close"].to_numpy()
    lr = np.diff(np.log(close))
    n_blocks = int(np.ceil(len(lr) / block))
    starts = rng.integers(0, max(len(lr) - block, 1), size=n_blocks)
    shuffled = np.concatenate([lr[s:s + block] for s in starts])[:len(lr)]
    new_close = close[0] * np.exp(np.concatenate([[0], np.cumsum(shuffled)]))
    out["close"] = new_close
    out["open"] = np.concatenate([[new_close[0]], new_close[:-1]])
    out["high"] = np.maximum(out["open"], out["close"]) * 1.0002
    out["low"] = np.minimum(out["open"], out["close"]) * 0.9998
    return out


def permutation_pvalue(cfg: Cfg, test_df: pd.DataFrame, real_sharpe: float, n: int = N_PERM) -> float:
    rng = np.random.default_rng(SEED + 1)
    null = []
    for _ in range(n):
        sdf = _block_shuffle_df(test_df, rng)
        st = evaluate(cfg, sdf)
        null.append(st.get("sharpe_ann", 0.0))
    null = np.asarray(null)
    return float((np.sum(null >= real_sharpe) + 1) / (n + 1))


def walk_forward(df: pd.DataFrame) -> dict:
    """Multi-window expanding walk-forward.

    Runs WF_SPLITS OOS windows. Skips windows with < OOS_MIN_TRADES (regime-dead).
    Passes if >= MIN_WINDOWS_PASS surviving windows clear all gates.
    Promoted params come from the most recent passing window's train grid search.
    """
    if df is None or df.empty or len(df) < 5000:
        return {"passed": False, "reason": "insufficient data", "bars": 0 if df is None else len(df)}

    n = len(df)
    window_results = []
    best_params_candidate = None
    best_params_train_stats = None

    for train_frac, oos_end_frac in WF_SPLITS:
        train_end = int(n * train_frac)
        oos_end = int(n * oos_end_frac)
        train = df.iloc[:train_end].copy()
        oos = df.iloc[train_end:oos_end].copy()

        if len(train) < 2000 or len(oos) < 200:
            window_results.append({"skipped": True, "reason": "insufficient bars",
                                   "train_end_frac": train_frac, "oos_end_frac": oos_end_frac})
            continue

        params, tr_stats = grid_search(train)
        if params is None:
            window_results.append({"skipped": True, "reason": "no train param set passed",
                                   "train_end_frac": train_frac, "oos_end_frac": oos_end_frac})
            continue

        cfg = with_params(DEFAULT, params)
        oos_stats = evaluate(cfg, oos)
        oos_trades = oos_stats.get("trades", 0)

        if oos_trades < OOS_MIN_TRADES:
            window_results.append({"skipped": True, "reason": "regime_dead",
                                   "oos_trades": oos_trades,
                                   "train_end_frac": train_frac, "oos_end_frac": oos_end_frac})
            continue

        oos_sharpe = oos_stats.get("sharpe_ann", -1e9)
        oos_dd = oos_stats.get("max_dd_pct", 100.0)
        pval = permutation_pvalue(cfg, oos, oos_sharpe)

        gates_ok = (oos_sharpe >= OOS_SHARPE_GATE
                    and oos_dd <= DD_GATE_PCT
                    and pval < PERM_P_GATE)
        window_results.append({
            "skipped": False,
            "passed": gates_ok,
            "params": params,
            "oos_sharpe": round(oos_sharpe, 3),
            "oos_dd_pct": round(oos_dd, 2),
            "perm_p": round(pval, 4),
            "oos_trades": oos_trades,
            "train_end_frac": train_frac,
            "oos_end_frac": oos_end_frac,
            "gates": {
                f"oos_sharpe>={OOS_SHARPE_GATE}": oos_sharpe >= OOS_SHARPE_GATE,
                f"oos_dd<={DD_GATE_PCT}%": oos_dd <= DD_GATE_PCT,
                f"perm_p<{PERM_P_GATE}": pval < PERM_P_GATE,
            },
        })

        if gates_ok:
            best_params_candidate = params
            best_params_train_stats = tr_stats

    evaluated = [w for w in window_results if not w.get("skipped")]
    skipped = [w for w in window_results if w.get("skipped")]
    passed_windows = [w for w in evaluated if w.get("passed")]

    overall_passed = (len(passed_windows) >= MIN_WINDOWS_PASS)

    # aggregate OOS stats from passing windows (latest wins for reporting)
    agg_sharpe = round(float(np.mean([w["oos_sharpe"] for w in passed_windows])), 3) if passed_windows else None
    agg_dd = round(float(np.mean([w["oos_dd_pct"] for w in passed_windows])), 2) if passed_windows else None
    agg_perm_p = round(float(np.max([w["perm_p"] for w in passed_windows])), 4) if passed_windows else None

    return {
        "passed": overall_passed,
        "reason": (f"{len(passed_windows)}/{len(evaluated)} windows passed "
                   f"(+{len(skipped)} skipped regime-dead)")
                  if overall_passed else
                  (f"only {len(passed_windows)}/{len(evaluated)} windows passed, "
                   f"need {MIN_WINDOWS_PASS} (skipped {len(skipped)} regime-dead)"),
        "params": best_params_candidate,
        "train": best_params_train_stats,
        "oos_sharpe": agg_sharpe,
        "oos_dd_pct": agg_dd,
        "perm_p": agg_perm_p,
        "windows": window_results,
    }


def promote(result: dict) -> None:
    """Write winning params to active_params.json (live.py hot-reloads them)."""
    if not result.get("params"):
        print("[optimize] promote called but no params in result — skipping")
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "params": result["params"],
        "oos_sharpe": result["oos_sharpe"],
        "oos_dd_pct": result["oos_dd_pct"],
        "perm_p": result["perm_p"],
        "promoted_at": datetime.now(timezone.utc).isoformat(),
        "windows_passed": sum(1 for w in result.get("windows", [])
                              if not w.get("skipped") and w.get("passed")),
    }
    ACTIVE_PARAMS_FILE.write_text(json.dumps(payload, indent=2))
    print(f"[optimize] promoted params → {ACTIVE_PARAMS_FILE.name}: {result['params']}")

    # Mirror the numeric promotion into the Obsidian brain so the nightly tuner's
    # changes show up alongside the weekly reflection's amendments (best-effort).
    try:
        from brain.bots import get_bot
        from brain.schema import Amendment
        from brain import vault as brain_vault
        bot = get_bot("goldscalp")
        defaults = bot.defaults
        for k, to_val in result["params"].items():
            if k not in bot.bounds:
                continue
            brain_vault.write_amendment(bot, "APPLIED",
                Amendment(param=k, from_val=float(defaults.get(k, to_val)),
                          to_val=float(to_val),
                          rationale="nightly walk-forward optimizer"),
                {"stage": "applied", "gate": "walk_forward",
                 "oos_sharpe": result["oos_sharpe"], "oos_dd_pct": result["oos_dd_pct"],
                 "perm_p": result["perm_p"]})
    except Exception as e:
        print(f"[optimize] brain log skipped: {e}")


def load_active_params() -> dict:
    if ACTIVE_PARAMS_FILE.exists():
        try:
            return json.loads(ACTIVE_PARAMS_FILE.read_text()).get("params", {})
        except Exception:
            return {}
    return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", action="store_true", help="eval default params on full cache")
    ap.add_argument("--days", type=int, default=60)
    args = ap.parse_args()
    _load_env()
    df = load_cached("M1", args.days)
    if df is None or df.empty:
        print("[optimize] no cached XAU_USD M1 data — run: python -m goldscalp.data.oanda --history 60")
        return

    if args.backtest:
        st = evaluate(DEFAULT, df)
        print("=== GOLD backtest (default params) ===")
        for k, v in st.items():
            print(f"  {k}: {v}")
        gate = (st.get("trades", 0) >= MIN_TRADES and st.get("sharpe_ann", 0) >= OOS_SHARPE_GATE
                and st.get("max_dd_pct", 100) <= DD_GATE_PCT)
        print(f"\nresearch gate: {'PASS' if gate else 'FAIL'} "
              f"(Sharpe>={OOS_SHARPE_GATE}, DD<={DD_GATE_PCT}%, trades>={MIN_TRADES})")
        return

    result = walk_forward(df)
    print("=== GOLD walk-forward re-tune ===")
    print(json.dumps({k: v for k, v in result.items() if k not in ("train", "windows")}, indent=2))
    print("\n=== window detail ===")
    for i, w in enumerate(result.get("windows", [])):
        tag = "SKIP" if w.get("skipped") else ("PASS" if w.get("passed") else "FAIL")
        frac = f"{w['train_end_frac']:.0%}→{w['oos_end_frac']:.0%}"
        if w.get("skipped"):
            print(f"  [{tag}] {frac}  reason={w.get('reason')}  trades={w.get('oos_trades', 0)}")
        else:
            print(f"  [{tag}] {frac}  sharpe={w['oos_sharpe']}  dd={w['oos_dd_pct']}%  "
                  f"p={w['perm_p']}  trades={w['oos_trades']}")
    if result.get("passed"):
        promote(result)
    else:
        print(f"\n[optimize] gates NOT passed ({result.get('reason', 'see gates')}) — keeping current params")


if __name__ == "__main__":
    main()
