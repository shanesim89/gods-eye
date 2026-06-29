"""Neon DB bridge for the options brain loop.

Reads/writes ai_options_settings and ai_options_positions via psycopg2 (pooler
URL from quant-scrap/.env). Called by metrics.py (read-only) and amend.py
(write on validated apply).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

# ── env ─────────────────────────────────────────────────────────────────────────

def _load_env() -> None:
    env = Path(__file__).resolve().parent.parent / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _conn():
    import psycopg2
    _load_env()
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL not set in .env")
    return psycopg2.connect(url)


# ── param columns (flat keys brain uses → DB column names) ──────────────────────

_PARAM_COLS = {
    "target_delta":              "target_delta",
    "dte_min":                   "dte_min",
    "dte_max":                   "dte_max",
    "conviction_threshold":      "conviction_threshold",
    "collateral_per_contract_usd": "collateral_per_contract_usd",
    "long_play_budget_usd":      "long_play_budget_usd",
}


def load_params(user_id: str) -> dict[str, float]:
    """Pull current tunable params from ai_options_settings → flat float dict."""
    cols = ", ".join(_PARAM_COLS.values())
    with _conn() as cx, cx.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM ai_options_settings WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if row is None:
        return {}
    return {k: float(row[i]) for i, k in enumerate(_PARAM_COLS)}


def save_params(user_id: str, params: dict[str, float]) -> None:
    """Push amended params back to ai_options_settings. Integer columns cast to int."""
    _INT_COLS = {"target_delta", "dte_min", "dte_max", "conviction_threshold"}
    set_parts = []
    values: list[Any] = []
    for flat_key, col in _PARAM_COLS.items():
        if flat_key not in params:
            continue
        v = int(round(params[flat_key])) if flat_key in _INT_COLS else float(params[flat_key])
        set_parts.append(f"{col} = %s")
        values.append(v)
    if not set_parts:
        return
    set_parts.append("updated_at = now()")
    values.append(user_id)
    sql = f"UPDATE ai_options_settings SET {', '.join(set_parts)} WHERE user_id = %s"
    with _conn() as cx, cx.cursor() as cur:
        cur.execute(sql, values)
        cx.commit()


def load_metrics(user_id: str) -> dict:
    """Pull settled positions from ai_options_positions → metrics dict."""
    sql = """
        SELECT
            strategy,
            status,
            realized_pnl::float,
            entry_premium::float,
            contract_multiplier::float,
            council_verdict,
            opened_at
        FROM ai_options_positions
        WHERE user_id = %s
          AND status NOT IN ('open')
        ORDER BY opened_at
    """
    with _conn() as cx, cx.cursor() as cur:
        cur.execute(sql, (user_id,))
        rows = cur.fetchall()

    if not rows:
        return {"positions": 0, "note": "no settled positions yet"}

    total = len(rows)
    total_pnl = sum(r[2] for r in rows)
    wins = sum(1 for r in rows if r[2] > 0)

    by_strategy: dict[str, dict] = {}
    for strat, status, pnl, prem, mult, verdict, _ in rows:
        s = by_strategy.setdefault(strat, {"n": 0, "pnl": 0.0, "wins": 0, "premium": 0.0})
        s["n"] += 1
        s["pnl"] = round(s["pnl"] + pnl, 2)
        s["wins"] += 1 if pnl > 0 else 0
        s["premium"] = round(s["premium"] + prem * mult, 4)

    for s in by_strategy.values():
        s["win_rate"] = round(s["wins"] / s["n"], 3) if s["n"] else 0.0

    # assignment rate: how often CSP gets assigned vs expires worthless
    csp_rows = [(r[1], r[2]) for r in rows if r[0] == "csp"]
    assigned = sum(1 for status, _ in csp_rows if status == "assigned")
    csp_n = len(csp_rows)

    # council accuracy: when council gave a directive verdict (not HOLD/null), did it profit?
    # DB stores 'SELL' for CSP (sell the put) and 'BUY' for long plays — HOLD = no trade.
    directed = [(r[2], r[5]) for r in rows if r[5] not in (None, "HOLD")]
    council_acc = round(
        sum(1 for pnl, _ in directed if pnl > 0) / max(len(directed), 1), 3
    )

    return {
        "positions": total,
        "total_pnl": round(total_pnl, 2),
        "win_rate": round(wins / total, 3),
        "by_strategy": {k: {kk: vv for kk, vv in v.items() if kk != "wins"} for k, v in by_strategy.items()},
        "csp_assignment_rate": round(assigned / csp_n, 3) if csp_n else None,
        "council_accuracy": council_acc,
    }
