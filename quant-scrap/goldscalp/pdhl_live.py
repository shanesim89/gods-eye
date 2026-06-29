"""PDH/PDL Break+Retest — paper-forward live poller.

Mirrors live.py (GoldScalper VWAP fade) but runs PDHLScalper independently.
Separate state file, journal CSV, and Neon key so both can run concurrently.

Modes:
  python -m goldscalp.pdhl_live                 # live: poll OANDA M1, paper-trade
  python -m goldscalp.pdhl_live --replay FILE    # dry session: replay cached parquet
  python -m goldscalp.pdhl_live --synthetic 3000 # smoke test: no creds needed
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from goldscalp.config import (DATA_DIR, DEFAULT, INSTRUMENT, OANDA_HOST,
                               STARTING_BALANCE, with_half_spread)
from goldscalp.engine_fwd import bars_from_df, summarize
from goldscalp.pdhl_engine import PDHL_DEFAULT, PDHLParams, run_pdhl_replay
from goldscalp.state import build_pub_state

_DEFAULT_STATE_FILE = DATA_DIR / "pdhl_state.json"
_DEFAULT_JOURNAL_CSV = DATA_DIR / "pdhl_journal.csv"
_DEFAULT_STATE_KEY = "gold:pdhl:state"

# filled in by _init_period_paths() once --period arg is parsed
PDHL_STATE_FILE: Path = _DEFAULT_STATE_FILE
PDHL_JOURNAL_CSV: Path = _DEFAULT_JOURNAL_CSV
PDHL_STATE_KEY: str = _DEFAULT_STATE_KEY


def _init_period_paths(period_min: int | None) -> None:
    """Set module-level file paths based on --period (None = daily default)."""
    global PDHL_STATE_FILE, PDHL_JOURNAL_CSV, PDHL_STATE_KEY
    if period_min is None or period_min == 1440:
        return  # keep defaults
    tag = f"{period_min // 60}h"
    PDHL_STATE_FILE = DATA_DIR / f"pdhl_state_{tag}.json"
    PDHL_JOURNAL_CSV = DATA_DIR / f"pdhl_journal_{tag}.csv"
    PDHL_STATE_KEY = f"gold:pdhl:{tag}:state"

def _publish_pdhl(state: dict, key: str | None = None) -> bool:
    import json, os, time, psycopg2
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("[pdhl_state] DATABASE_URL not set — skipping publish")
        return False
    from datetime import datetime, timezone
    state = {**state, "published_at": datetime.now(timezone.utc).isoformat()}
    payload = json.dumps(state)
    publish_key = key or PDHL_STATE_KEY
    for attempt in range(1, 6):
        try:
            with psycopg2.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO market_data_cache (ticker, payload, fetched_at) "
                    "VALUES (%s, %s::jsonb, now()) "
                    "ON CONFLICT (ticker) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=now()",
                    (publish_key, payload),
                )
            return True
        except psycopg2.OperationalError as e:
            if attempt == 5:
                print(f"[pdhl_state] publish failed: {e}")
                return False
            time.sleep(3 * 2 ** (attempt - 1))
    return False


STRATEGY_DESC = (
    "XAUUSD PDH/PDL break+retest (long+short, 1m). Entry: confirmed close-break "
    "of prev-day H/L, retest within 0.03% of level, close holds above/below. "
    "Exit: scale-out — bank half at +1R, move stop to breakeven, run the rest to "
    "2.0R / structure SL / 2h time stop. Session: London+NY (07–21 UTC). Paper-forward."
)


def _load_params(period_override: int | None = None) -> PDHLParams:
    from goldscalp.pdhl_optimize import PDHL_PARAMS_FILE
    base = PDHL_DEFAULT
    if PDHL_PARAMS_FILE.exists():
        try:
            d = json.loads(PDHL_PARAMS_FILE.read_text()).get("params", {})
            from goldscalp.pdhl_engine import pdhl_params_from_dict
            base = pdhl_params_from_dict(d)
        except Exception:
            pass
    if period_override is not None:
        from dataclasses import replace
        base = replace(base, period_min=period_override)
    return base


def _session_stats(gs, day) -> dict:
    rows = [t for t in gs.trades if getattr(t.exit_dt, "date", lambda: None)() == day]
    if not rows:
        return {"trades": 0, "win_rate": None, "profit_factor": None, "pnl": 0.0}
    pnl = sum(t.pnl for t in rows)
    wins = [t for t in rows if t.pnl > 0]
    loss = sum(t.pnl for t in rows if t.pnl <= 0)
    pf = (sum(t.pnl for t in wins) / abs(loss)) if loss != 0 else float("inf")
    return {
        "trades": len(rows),
        "win_rate": round(len(wins) / len(rows), 3),
        "profit_factor": round(float(pf), 3),
        "pnl": round(pnl, 2),
    }


def _journal_new_trades(gs, already: int) -> int:
    new = gs.trades[already:]
    if not new:
        return already
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rows = [{
        "exit_dt": t.exit_dt.isoformat() if hasattr(t.exit_dt, "isoformat") else str(t.exit_dt),
        "entry_dt": t.entry_dt.isoformat() if hasattr(t.entry_dt, "isoformat") else str(t.entry_dt),
        "direction": t.direction, "entry": round(t.entry, 3), "exit": round(t.exit, 3),
        "level": round(float(t.stretch), 3),   # stretch reused as PDH/PDL level
        "pnl": round(t.pnl, 2), "r_mult": round(t.r_mult, 3),
        "exit_reason": t.exit_reason, "equity_after": round(t.equity_after, 2),
    } for t in new]
    expected_header = ",".join(rows[0].keys())
    write_header = True
    if PDHL_JOURNAL_CSV.exists():
        with PDHL_JOURNAL_CSV.open("r", encoding="utf-8-sig") as fh:
            cur = fh.readline().strip()
        if cur == expected_header:
            write_header = False
        else:
            bak = PDHL_JOURNAL_CSV.with_suffix(
                f".{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.bak.csv")
            PDHL_JOURNAL_CSV.rename(bak)
    pd.DataFrame(rows).to_csv(PDHL_JOURNAL_CSV, mode="a", header=write_header,
                               index=False, encoding="utf-8-sig")
    return len(gs.trades)


def _recent_trades(gs) -> list:
    cutoff = datetime.now(timezone.utc).timestamp() - 24 * 3600
    rows = []
    for t in gs.trades:
        try:
            ts = t.exit_dt.timestamp()
        except Exception:
            continue
        if ts < cutoff:
            continue
        rows.append({
            "exit": t.exit_dt.isoformat() if hasattr(t.exit_dt, "isoformat") else str(t.exit_dt),
            "side": "LONG" if t.direction > 0 else "SHORT",
            "entry": round(float(t.entry), 3),
            "exit_px": round(float(t.exit), 3),
            "level": round(float(t.stretch), 3),
            "pnl": round(float(t.pnl), 2),
            "reason": t.exit_reason,
        })
    rows.sort(key=lambda r: r["exit"], reverse=True)
    return rows


def _finalize(gs, stage: str, last_run: str, do_publish: bool = True) -> None:
    eq = gs.risk.s.equity
    open_pos = None
    if gs.open_pos:
        p = gs.open_pos
        open_pos = {"direction": p["direction"], "entry": round(p["entry"], 3),
                    "level": round(float(p.get("level", 0)), 3), "size": round(p["size"], 4),
                    "remaining": round(float(p.get("remaining", p["size"])), 4),
                    "tp1_done": bool(p.get("tp1_done", False))}
    today = datetime.now(timezone.utc).date()
    sess = _session_stats(gs, today)
    overall = summarize(gs)
    curve = pd.DataFrame(gs.equity_curve, columns=["ts", "equity"])["equity"]
    hist = []
    if not curve.empty:
        df_c = pd.DataFrame(gs.equity_curve, columns=["ts", "equity"])
        df_c["date"] = pd.to_datetime(df_c["ts"], unit="ms", utc=True).dt.date.astype(str)
        hist = [{"date": d, "equity": round(float(e), 2)}
                for d, e in df_c.groupby("date")["equity"].last().items()]

    state = build_pub_state(
        stage=stage, equity=eq, starting_balance=STARTING_BALANCE, regime="n/a",
        circuit_state="NORMAL", lever=1.0, open_pos=open_pos,
        session_stats=sess, params={},
        backtest_stats=None, history=hist, last_run=last_run,
        strategy_desc=STRATEGY_DESC, recent_trades=_recent_trades(gs),
        gates={
            "research": "walk-forward pass (OOS Sharpe 5.0, DD 1.4%)",
            "paper": f"FORWARD since {last_run[:10]}",
            "live": "LOCKED — needs 4wk paper + gate review",
            "overall_paper": overall,
        },
    )
    PDHL_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PDHL_STATE_FILE.write_text(json.dumps({"state": state, "saved_at": last_run}, indent=1))
    if do_publish:
        _publish_pdhl(state)


def synthetic_df(n: int, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-06-01", tz="UTC")
    ts0 = int(start.timestamp() * 1000)
    rets = rng.normal(0, 0.0008, n)
    close = 2300.0 * np.exp(np.cumsum(rets))
    op = np.concatenate([[2300.0], close[:-1]])
    hi = np.maximum(op, close) * (1 + np.abs(rng.normal(0, 0.0004, n)))
    lo = np.minimum(op, close) * (1 - np.abs(rng.normal(0, 0.0004, n)))
    vol = rng.integers(50, 500, n).astype(float)
    ts = ts0 + np.arange(n) * 60_000
    df = pd.DataFrame({"ts": ts, "open": op, "high": hi, "low": lo, "close": close, "volume": vol})
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df["spread"] = close * 0.0002
    return df


def run_offline(df: pd.DataFrame, stage: str, do_publish: bool,
                period_override: int | None = None) -> None:
    params = _load_params(period_override)
    rng = np.random.default_rng(42)
    gs = run_pdhl_replay(DEFAULT, params, df, rng)
    journaled = _journal_new_trades(gs, 0)
    last_run = datetime.now(timezone.utc).isoformat()
    _finalize(gs, stage, last_run, do_publish)
    print(f"[offline {stage}] bars={len(df)}  " + json.dumps(summarize(gs)))


def poll_live(period_override: int | None = None) -> None:
    from goldscalp.data.oanda import _load_env, fetch_candles, get_pricing
    from dipbounce.scanner import _wait_for_network

    _load_env()
    _wait_for_network(OANDA_HOST.replace("https://", ""))
    params = _load_params(period_override)

    warm = None
    for attempt in range(1, 6):
        try:
            from goldscalp.data.oanda import fetch_candles
            warm = fetch_candles("M1", 600)
            break
        except Exception as e:
            print(f"[pdhl_live] warmup attempt {attempt}/5 failed: {str(e)[:120]} — retrying 30s")
            time.sleep(30)
    if warm is None or warm.empty:
        print("[pdhl_live] warmup failed — exiting for Task Scheduler restart")
        return

    from goldscalp.pdhl_engine import PDHLScalper
    rng = np.random.default_rng()
    gs = PDHLScalper(DEFAULT, params, STARTING_BALANCE, rng)
    for bar in bars_from_df(warm):
        gs.on_bar(bar)

    print(f"[pdhl_live] warmed {len(warm)} bars  equity=${gs.risk.s.equity:,.2f}")
    last_ts = int(warm["ts"].iloc[-1])
    journaled = len(gs.trades)

    consecutive_errors = 0
    MAX_ERRORS = 30  # ~15 min of retries before giving up

    while True:
        now_utc = datetime.now(timezone.utc)
        # OANDA forex closes Fri 21:00 UTC, reopens Sun 21:00 UTC
        weekday = now_utc.weekday()  # 5=Sat, 6=Sun
        hour = now_utc.hour
        market_closed = (
            weekday == 5  # all Saturday
            or weekday == 6 and hour < 21  # Sunday before 21:00 UTC
            or weekday == 4 and hour >= 21  # Friday after 21:00 UTC
        )
        if market_closed:
            print(f"[pdhl_live] market closed ({now_utc:%a %H:%M UTC}) — exiting for Task Scheduler restart")
            break

        try:
            from goldscalp.data.oanda import fetch_candles, get_pricing
            recent = fetch_candles("M1", 5)
            new = recent[recent["ts"] > last_ts]
            if not new.empty:
                px = get_pricing()
                gs.cfg = with_half_spread(DEFAULT, px["half_spread_pct"])
                gs.risk.cfg = gs.cfg
                for bar in bars_from_df(new):
                    bar["half_spread_pct"] = px["half_spread_pct"]
                    gs.on_bar(bar)
                    last_ts = bar["ts"]
                journaled = _journal_new_trades(gs, journaled)
                last_run = datetime.now(timezone.utc).isoformat()
                _finalize(gs, "PAPER FORWARD", last_run)
                print(f"[pdhl_live] {new['dt'].iloc[-1]}  bars+={len(new)}  "
                      f"equity=${gs.risk.s.equity:,.2f}  trades={len(gs.trades)}")
            consecutive_errors = 0
            time.sleep(30)
        except KeyboardInterrupt:
            print("[pdhl_live] stopped")
            break
        except Exception as e:
            consecutive_errors += 1
            print(f"[pdhl_live] error: {str(e)[:160]} — retrying 30s ({consecutive_errors}/{MAX_ERRORS})")
            if consecutive_errors >= MAX_ERRORS:
                print("[pdhl_live] too many consecutive errors — exiting for Task Scheduler restart")
                break
            time.sleep(30)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", metavar="PARQUET")
    ap.add_argument("--synthetic", type=int, metavar="N")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument(
        "--period", type=int, default=None, metavar="MIN",
        help="Override PDH/PDL period in minutes (240=4H, 480=8H, 1440=daily). "
             "Changes state file, journal, and Neon key so multiple instances run concurrently.",
    )
    args = ap.parse_args()
    _init_period_paths(args.period)
    if args.synthetic:
        run_offline(synthetic_df(args.synthetic), "SMOKE", not args.no_publish, args.period)
    elif args.replay:
        run_offline(pd.read_parquet(args.replay), "DRY REPLAY", not args.no_publish, args.period)
    else:
        poll_live(args.period)


if __name__ == "__main__":
    main()
