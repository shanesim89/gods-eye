"""Morning Telegram digest — fires 09:30 SGT daily via Task Scheduler.

Per-bot: status, amount invested, portfolio return, all 24h trades/activity, 1-line summary.
Covers goldscalp (PDHL + VWAP), mcscalp, dipbounce (signal only), and Crypto DCA (live).

Run:
  python morning_digest.py             # build + send to Telegram
  python morning_digest.py --dry-run   # build + print only, no send
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import psycopg2

# ── paths ─────────────────────────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent
GOLD_PDHL_JOURNAL    = BASE / "goldscalp" / "data" / "pdhl_journal.csv"
GOLD_PDHL_4H_JOURNAL = BASE / "goldscalp" / "data" / "pdhl_journal_4h.csv"
GOLD_PDHL_8H_JOURNAL = BASE / "goldscalp" / "data" / "pdhl_journal_8h.csv"
MCSCALP_JOURNAL      = BASE / "mcscalp"   / "data" / "paper_journal.csv"
MCSCALP_STATE        = BASE / "mcscalp"   / "data" / "paper_state.json"

DCA_USER_ID       = "2d4c2a10-39d1-491c-ae39-18d515cd559e"
DCA_CADENCE_DAYS  = 15  # 14d cadence + 1d grace


# ── env + Telegram ────────────────────────────────────────────────────────────
def _load_env() -> None:
    env = BASE / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _send_one(token: str, chat: str, msg: str) -> None:
    url  = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode(
        {"chat_id": chat, "text": msg, "parse_mode": "HTML",
         "disable_web_page_preview": "true"}
    ).encode()
    urllib.request.urlopen(url, data=data, timeout=15)


def send_telegram(msg: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat  = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        print(f"[digest] TG not configured — would send:\n{msg}")
        return
    # Chunk at 3900 chars, split on blank lines between bot blocks.
    chunks, current = [], []
    for line in msg.split("\n"):
        current.append(line)
        if "\n".join(current).__len__() > 3900 and line == "":
            chunks.append("\n".join(current).strip())
            current = []
    if current:
        chunks.append("\n".join(current).strip())
    for chunk in chunks:
        try:
            _send_one(token, chat, chunk)
        except Exception as e:
            print(f"[digest] TG send failed: {e}")


# ── Neon helpers ──────────────────────────────────────────────────────────────
def _connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg2.connect(url, connect_timeout=15)


def _neon(cur, key: str):
    """Return (payload_dict, age_hours) or None."""
    cur.execute("SELECT payload, fetched_at FROM market_data_cache WHERE ticker = %s", (key,))
    row = cur.fetchone()
    if not row:
        return None
    payload, fetched_at = row
    if isinstance(payload, str):
        payload = json.loads(payload)
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    age_h = (datetime.now(timezone.utc) - fetched_at).total_seconds() / 3600
    return payload, age_h


def _read_journal_24h(path: Path, ts_col: str) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    try:
        df = pd.read_csv(path, encoding="utf-8-sig")
        if ts_col not in df.columns or df.empty:
            return pd.DataFrame()
        ts = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
        return df[ts >= datetime.now(timezone.utc) - timedelta(hours=24)]
    except Exception:
        return pd.DataFrame()


# ── formatting ────────────────────────────────────────────────────────────────
def _usd(v: float) -> str:
    return f"${v:,.2f}"


def _ret(equity: float, start: float) -> str:
    if start <= 0:
        return "n/a"
    pct = (equity - start) / start * 100
    return f"{pct:+.2f}%"


def _oanda_closed(now: datetime) -> bool:
    wd, hr = now.weekday(), now.hour
    return wd == 5 or (wd == 6 and hr < 21) or (wd == 4 and hr >= 21)


def _parse_vwap_actions(actions_str: str) -> list[str]:
    """Extract non-held action lines from pipe-delimited VWAP/mcscalp actions string."""
    out = []
    for part in str(actions_str).split("|"):
        part = part.strip()
        if not part or "held w=" in part:
            continue
        # Shorten: "ETH/USDT: OPEN 0.000→0.007 @ $1,578.68 (fee $0.04)" → "ETH OPEN →0.7%"
        try:
            coin = part.split("/")[0].strip()
            rest = part.split(":", 1)[1].strip() if ":" in part else part
            # Extract action keyword
            for kw in ("OPEN", "REDUCE", "CLOSE", "ENTER"):
                if kw in rest:
                    # grab weight target if present
                    if "→" in rest:
                        target = rest.split("→")[1].split("@")[0].strip().split(" ")[0]
                        try:
                            tw = float(target)
                            out.append(f"{coin} {kw} {tw*100:.1f}%")
                        except ValueError:
                            out.append(f"{coin} {kw}")
                    else:
                        out.append(f"{coin} {kw}")
                    break
        except Exception:
            out.append(part[:60])
    return out


# ── per-bot blocks ─────────────────────────────────────────────────────────────
def _pdhl_block(cur, label: str, neon_key: str, journal_path: Path, closed: bool) -> list[str]:
    lines = [f"🥇 <b>{label}</b>"]
    try:
        res = _neon(cur, neon_key)
        if res is None:
            lines.append(" ⚠️ no state published")
            return lines
        st, age_h = res
        eq      = float(st.get("equity", 0))
        start   = float(st.get("starting_balance", 10000))
        circuit = st.get("circuit_state", "NORMAL")
        if circuit != "NORMAL":
            status = f"⚠️ circuit {circuit}"
        elif age_h <= 2 or closed:
            status = "✅" if age_h <= 2 else "💤 mkt closed"
        else:
            status = f"⚠️ stale {age_h:.1f}h"
        lines.append(f" {status} · invested {_usd(start)} · equity {_usd(eq)} · return {_ret(eq, start)}")
        j = _read_journal_24h(journal_path, "exit_dt")
        if j.empty:
            lines.append(f" 24h trades: none{'  (mkt closed wknd)' if closed else ''}")
            op = (st.get("gates") or {}).get("overall_paper") or {}
            skips = op.get("skips") or {}
            n_total = op.get("trades", 0)
            if skips:
                skip_parts = ", ".join(f"{v} {k.replace('_',' ')}" for k, v in list(skips.items())[:2])
                lines.append(f' 💬 No setup today — {skip_parts}')
            elif n_total:
                wr = op.get("win_rate", 0) or 0
                pf = op.get("profit_factor") or 0
                lines.append(f' 💬 Overall: {n_total} trades, WR {wr*100:.0f}%, PF {pf:.2f}')
        else:
            for _, r in j.iterrows():
                side = "LONG" if int(r.get("direction", 1)) > 0 else "SHORT"
                lines.append(
                    f"  · {side} {_usd(float(r['entry']))}→{_usd(float(r['exit']))}"
                    f"  PnL {float(r['pnl']):+.2f}  ({r['exit_reason']})  R={float(r['r_mult']):.2f}"
                )
            total_pnl = float(j["pnl"].sum())
            wins = int((j["pnl"] > 0).sum())
            losses = len(j) - wins
            lines.append(f' 💬 {len(j)} trades: {wins}W/{losses}L · net {total_pnl:+.2f}')
    except Exception as e:
        lines.append(f" ⚠️ error: {str(e)[:100]}")
    return lines


def block_gold(cur) -> str:
    now    = datetime.now(timezone.utc)
    closed = _oanda_closed(now)
    lines  = _pdhl_block(cur, "GOLDSCALP PDHL (Daily)", "gold:pdhl:state", GOLD_PDHL_JOURNAL, closed)
    lines.append("")
    lines += _pdhl_block(cur, "GOLDSCALP PDHL (4H)", "gold:pdhl:4h:state", GOLD_PDHL_4H_JOURNAL, closed)
    lines.append("")
    lines += _pdhl_block(cur, "GOLDSCALP PDHL (8H)", "gold:pdhl:8h:state", GOLD_PDHL_8H_JOURNAL, closed)
    lines.append("")
    lines.append("🥇 <b>GOLDSCALP VWAP</b>")
    try:
        res = _neon(cur, "gold:scalper:state")
        if res is None:
            lines.append(" ⚠️ no state published")
        else:
            st, age_h = res
            eq      = float(st.get("equity", 0))
            start   = float(st.get("starting_balance", 10000))
            circuit = st.get("circuit_state", "NORMAL")
            regime  = st.get("regime", "unknown")
            if circuit != "NORMAL":
                status = f"⚠️ circuit {circuit}"
            elif age_h <= 2 or closed:
                status = "✅" if age_h <= 2 else "💤 mkt closed"
            else:
                status = f"⚠️ stale {age_h:.1f}h"

            lines.append(f" {status} · invested {_usd(start)} · equity {_usd(eq)} · return {_ret(eq, start)}")

            # VWAP has no journal CSV — derive 24h return from history
            hist = st.get("history") or []
            if len(hist) >= 2:
                prev_eq = float(hist[-2].get("equity", start))
                day_ret = (eq - prev_eq) / prev_eq * 100 if prev_eq else 0
                lines.append(f" 24h: {day_ret:+.2f}% vs prior day")
            else:
                lines.append(" 24h: no prior day data")

            recent = st.get("recent_trades") or []
            if recent:
                for t in recent[:3]:
                    side = t.get("side", "?")
                    lines.append(f"  · {side} entry {t.get('entry_px','?')} exit {t.get('exit_px','?')} {t.get('reason','')}")
            else:
                lines.append(" 24h trades: none")

            regime_display = regime if regime and regime.lower() not in ("n/a", "unknown") else "unknown"
            lines.append(f' 💬 {regime_display.capitalize()} regime — VWAP fade strategy, no active trades')
    except Exception as e:
        lines.append(f" ⚠️ error: {str(e)[:100]}")

    return "\n".join(lines)


def block_mcscalp(cur) -> str:
    lines = ["🪙 <b>MCSCALP</b>"]
    try:
        res = _neon(cur, "quant:scrap:state")
        if res is None:
            return lines[0] + "\n ⚠️ no state published"
        st, age_h = res
        eq      = float(st.get("equity", 0))
        start   = float(st.get("starting_balance", 10000))
        circuit = st.get("circuit_state", "NORMAL")
        regime  = st.get("regime", "unknown")
        daily   = st.get("daily_ret_pct")

        if circuit != "NORMAL":
            status = f"⚠️ circuit {circuit}"
        elif age_h <= 26:
            status = "✅"
        else:
            status = f"⚠️ stale {age_h:.1f}h"

        daily_str = f"{daily:+.2f}%" if isinstance(daily, (int, float)) else "n/a"
        lines.append(f" {status} · invested {_usd(start)} · equity {_usd(eq)} · return {_ret(eq, start)}")
        lines.append(f" 24h: {daily_str} · {regime} · {circuit}")

        # 24h actions from journal CSV — today's row
        j = _read_journal_24h(MCSCALP_JOURNAL, "date")
        if not j.empty and "actions" in j.columns:
            actions_blob = str(j.iloc[-1].get("actions", ""))
            acts = _parse_vwap_actions(actions_blob)
            if acts:
                lines.append(" moves: " + " · ".join(acts[:8]))
            else:
                lines.append(" 24h: no rebalance")
        else:
            lines.append(" 24h: no journal entry yet")

        # summary sentence from recent_decisions (local file, faster than Neon)
        try:
            ps = json.loads(MCSCALP_STATE.read_text())
            decisions = ps.get("recent_decisions") or []
            # Only today's decisions (UTC date)
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            decisions = [d for d in decisions if str(d.get("ts", "")).startswith(today_str)]
            if decisions:
                opens   = list(dict.fromkeys(d["symbol"].split("/")[0] for d in decisions if d.get("action") == "open"))
                reduces = list(dict.fromkeys(d["symbol"].split("/")[0] for d in decisions if d.get("action") == "reduce"))
                closes  = list(dict.fromkeys(d["symbol"].split("/")[0] for d in decisions if d.get("action") == "close"))
                parts   = []
                if opens:   parts.append("OPEN " + "/".join(opens))
                if reduces: parts.append("REDUCE " + "/".join(reduces))
                if closes:  parts.append("CLOSE " + "/".join(closes))
                sw = st.get("sleeve_weights") or {}
                tsmom = sw.get("tsmom", 0)
                summary = (", ".join(parts) if parts else "No rebalance") + f" — {regime}, TSMOM {tsmom*100:.0f}%"
                lines.append(f" 💬 {summary}")
        except Exception:
            lines.append(f" 💬 {daily_str} today, {regime}, circuit {circuit}")

        # current positions
        tops = st.get("top_positions") or []
        if tops:
            def lbl(p):
                s = p.get("symbol", "?").split("/")[0]
                w = p.get("weight", 0.0)
                return f"{s}{'▲' if w >= 0 else '▼'}"
            lines.append(" positions: " + " ".join(lbl(p) for p in tops[:6]))

    except Exception as e:
        lines.append(f" ⚠️ error: {str(e)[:100]}")
    return "\n".join(lines)


def block_dipbounce(cur) -> str:
    lines = ["📡 <b>DIPBOUNCE</b> <i>(signal only — no capital)</i>"]
    try:
        res = _neon(cur, "dipbounce:v1")
        if res is None:
            return lines[0] + "\n ⚠️ scanner not run"
        dip, age_h = res
        status = "✅" if age_h <= 26 else f"⚠️ stale {age_h:.1f}h"
        uni    = dip.get("universe", "?")
        passed = dip.get("passed", "?")
        rows   = sorted(dip.get("rows", []), key=lambda r: r.get("bounce_score", 0), reverse=True)

        lines.append(f" {status} · {uni} scanned · {passed} in dip zone")

        # Top 5 dips
        top5 = rows[:5]
        if top5:
            dip_str = " · ".join(
                f"{r['symbol']} {r['bounce_score']:.0f}({r.get('drop_pct','?')}%)"
                for r in top5
            )
            lines.append(f" dips: {dip_str}")

        # Top 3 leaders
        lres = _neon(cur, "leaders:v1")
        if lres:
            lrows = sorted(lres[0].get("rows", []), key=lambda r: r.get("leader_score", 0), reverse=True)
            top3  = lrows[:3]
            if top3:
                lead_str = " · ".join(
                    f"{r['symbol']} {r['leader_score']:.0f} {r.get('tag','')}"
                    for r in top3
                )
                lines.append(f" leaders: {lead_str}")

        # summary sentence from top dip
        if top5:
            t = top5[0]
            lines.append(
                f" 💬 Best: {t['symbol']} RSI {t.get('rsi','?'):.0f},"
                f" {t.get('drop_pct','?')}% off high,"
                f" bounce prob {t.get('bounce_probability',0)*100:.0f}%"
            )
    except Exception as e:
        lines.append(f" ⚠️ error: {str(e)[:100]}")
    return "\n".join(lines)


def block_dca(cur) -> str:
    lines = ["💰 <b>CRYPTO DCA</b> <i>(live)</i>"]
    try:
        # Holdings: filter null tickers (orphan rows)
        cur.execute(
            "SELECT upper(ticker), qty::numeric, cost_basis::numeric, "
            "current_value, last_priced_at "
            "FROM assets WHERE user_id=%s AND asset_class='crypto' AND ticker IS NOT NULL",
            (DCA_USER_ID,),
        )
        holdings = cur.fetchall()
        total_cost  = sum(float(r[2] or 0) for r in holdings)
        # current_value column = per-unit price; total = qty * price
        priced = [(r[0], float(r[1]), float(r[2] or 0), float(r[3]), r[4])
                  for r in holdings if r[3] is not None]
        total_value = sum(qty * price for _, qty, _, price, _ in priced) if priced else None
        pnl_str = ""
        if total_value is not None:
            pnl = total_value - total_cost
            pct = pnl / total_cost * 100 if total_cost > 0 else 0
            pnl_str = f" · value {_usd(total_value)} · P&L {pnl:+.2f} ({pct:+.1f}%)"

        # Settings: cap + kill switch
        cur.execute(
            "SELECT monthly_cap_usd, kill_switch FROM ai_trading_settings WHERE user_id=%s LIMIT 1",
            (DCA_USER_ID,),
        )
        srow = cur.fetchone()
        cap  = float(srow[0]) if srow and srow[0] is not None else 1300.0
        kill = bool(srow[1]) if srow else False

        # MTD spend
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cur.execute(
            "SELECT coalesce(sum(usd_amount::numeric),0) FROM ai_trade_orders "
            "WHERE user_id=%s AND status='filled' AND created_at>=%s",
            (DCA_USER_ID, month_start),
        )
        mtd = float(cur.fetchone()[0] or 0)

        # Last filled order
        cur.execute(
            "SELECT token, usd_amount::numeric, price::numeric, created_at, "
            "council_verdict, gate_trace FROM ai_trade_orders "
            "WHERE user_id=%s AND status='filled' ORDER BY created_at DESC LIMIT 1",
            (DCA_USER_ID,),
        )
        last = cur.fetchone()

        if kill:
            status = "🛑 kill switch ON"
        elif last and (datetime.now(timezone.utc) - last[3].replace(tzinfo=timezone.utc)).days <= DCA_CADENCE_DAYS:
            status = "✅ live"
        elif last:
            days   = (datetime.now(timezone.utc) - last[3].replace(tzinfo=timezone.utc)).days
            status = f"⚠️ no buy {days}d"
        else:
            status = "⚠️ no orders yet"

        n_coins = len(holdings)
        lines.append(f" {status} · {n_coins} coins · invested {_usd(total_cost)}{pnl_str}")
        lines.append(f" MTD: {_usd(mtd)} / {_usd(cap)} cap")

        # Per-coin breakdown
        for ticker, qty, cost, price, priced_at in priced:
            pos_val = qty * price
            pos_pnl = pos_val - cost
            pos_pct = pos_pnl / cost * 100 if cost > 0 else 0
            lines.append(f"  {ticker}: cost {_usd(cost)} · now {_usd(pos_val)} · {pos_pnl:+.0f} ({pos_pct:+.1f}%)")

        # 24h orders
        cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
        cur.execute(
            "SELECT token, side, usd_amount::numeric, price::numeric, status, "
            "council_verdict, gate_trace, created_at FROM ai_trade_orders "
            "WHERE user_id=%s AND created_at>=%s ORDER BY created_at DESC",
            (DCA_USER_ID, cutoff_24h),
        )
        orders_24h = cur.fetchall()
        if orders_24h:
            lines.append(" 24h orders:")
            for o in orders_24h:
                token, side, amt, px, ost, verdict, gt, ts = o
                px_str = f" @ ${float(px):,.0f}" if px is not None else ""
                status_icon = "✅" if ost == "filled" else "❌"
                lines.append(f"  {status_icon} {side.upper() if side else 'BUY'} {token} {_usd(float(amt))}{px_str}")
        else:
            lines.append(" 24h orders: none")

        # Summary from last order's gate_trace council detail
        if last:
            gt = last[5]
            if isinstance(gt, str):
                gt = json.loads(gt)
            council_gates = [g for g in (gt.get("gates", []) if gt else []) if g.get("id") == "council"]
            council_detail = council_gates[0].get("detail", "") if council_gates else ""
            try:
                day = last[3].replace(tzinfo=timezone.utc).strftime("%d %b").lstrip("0")
            except Exception:
                day = str(last[3])[:10]
            if council_detail:
                lines.append(f" 💬 Token market view: {council_detail} · last buy {last[0]} {_usd(float(last[1]))} on {day}")
            else:
                lines.append(f" 💬 Last buy: {last[0]} {_usd(float(last[1]))} on {day}")
        else:
            lines.append(" 💬 No orders yet")

    except Exception as e:
        lines.append(f" ⚠️ error: {str(e)[:100]}")
    return "\n".join(lines)


# ── compose + send ─────────────────────────────────────────────────────────────
def build_digest() -> str:
    sgt    = datetime.now(timezone.utc) + timedelta(hours=8)
    header = f"🌅 <b>Morning Digest</b> — {sgt.strftime('%a %d %b %H:%M')} SGT"
    with _connect() as conn, conn.cursor() as cur:
        blocks = [
            block_gold(cur),
            block_mcscalp(cur),
            block_dipbounce(cur),
            block_dca(cur),
        ]
    return header + "\n\n" + "\n\n".join(blocks)


def main() -> None:
    _load_env()
    dry = "--dry-run" in sys.argv
    msg = build_digest()
    print(msg)
    if not dry:
        send_telegram(msg)


if __name__ == "__main__":
    main()
