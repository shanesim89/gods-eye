"""Risk-parity allocator with fractional-Kelly leverage + drawdown de-lever.

Layers (applied in order):
  1. Risk-parity allocation across gated sleeves (inverse-vol weighting)
  2. Portfolio vol target (25-30%) sets the reference leverage
  3. Fractional-Kelly leverage (0.25-0.5×) applied to combined Sharpe
  4. Drawdown-scaled de-leveraging (equity-curve control)
  5. Correlation crash brake (when corr→1 and vol explodes, cut gross hard)
  6. Hard gross leverage cap (3.0×)

Usage:
  from mcscalp.core.allocator import Allocator
  alloc = Allocator(equity=10000.0, history=equity_history_list)
  scale = alloc.leverage_scale()  # multiplier for each sleeve's weights
  gross = alloc.gross_leverage()  # current total gross exposure
"""

from __future__ import annotations

import numpy as np
import pandas as pd

PORT_VOL_TARGET = 0.30       # 30% ann vol target → ~11% more leverage vs prior 27%; still conservative for crypto
KELLY_FRACTION = 0.35        # fractional Kelly: 0.25-0.5 typical safe range
MAX_GROSS = 3.0              # hard cap on gross leverage
DD_FULL_GROSS = 0.00         # at 0% drawdown: full gross
DD_HALF_GROSS = 0.15         # at 15% drawdown: half gross
DD_FLAT = 0.30               # at 30% drawdown: flat (gross = 0)
CORR_CRASH_THRESHOLD = 0.80  # if avg pairwise corr > 0.80 across sleeves: cut leverage
CORR_CRASH_FACTOR = 0.40     # cut to 40% of normal gross when corr crash fires


class Allocator:
    def __init__(
        self,
        equity: float,
        equity_history: list[float],
        sleeve_returns: dict[str, list[float]] | None = None,
        combined_sharpe: float | None = None,
        combined_vol: float | None = None,
    ) -> None:
        self.equity = equity
        self.equity_history = equity_history
        self.sleeve_returns = sleeve_returns or {}
        self.combined_sharpe = combined_sharpe
        self.combined_vol = combined_vol

    # ── Risk parity ───────────────────────────────────────────────────────

    def risk_parity_weights(self) -> dict[str, float]:
        """Inverse-vol weights across sleeves. All weights sum to 1."""
        if not self.sleeve_returns:
            return {}
        inv_vols: dict[str, float] = {}
        for name, rets in self.sleeve_returns.items():
            r = np.array(rets)
            if len(r) < 20:
                continue
            vol = float(r.std(ddof=1) * np.sqrt(365))
            inv_vols[name] = 1.0 / max(vol, 0.02)
        total = sum(inv_vols.values())
        if total < 1e-8:
            n = len(inv_vols)
            return {k: 1.0 / n for k in inv_vols}
        return {k: v / total for k, v in inv_vols.items()}

    # ── Kelly leverage ─────────────────────────────────────────────────────

    def kelly_leverage(self) -> float:
        """Fractional-Kelly leverage from combined Sharpe + vol."""
        if self.combined_sharpe is None or self.combined_vol is None:
            return 1.0
        if self.combined_vol < 1e-4:
            return 1.0
        full_kelly = self.combined_sharpe / self.combined_vol
        frac_kelly = KELLY_FRACTION * full_kelly
        return float(np.clip(frac_kelly, 0.5, MAX_GROSS))

    # ── Portfolio vol scale ────────────────────────────────────────────────

    def vol_scale(self) -> float:
        """Scale factor to hit PORT_VOL_TARGET from combined_vol."""
        if self.combined_vol is None or self.combined_vol < 1e-4:
            return 1.0
        return float(PORT_VOL_TARGET / self.combined_vol)

    # ── Drawdown de-lever ──────────────────────────────────────────────────

    def drawdown_scale(self) -> float:
        """Linear de-lever based on current drawdown from peak equity.

        Returns multiplier ∈ [0, 1].
        """
        if len(self.equity_history) < 2:
            return 1.0
        peak = max(self.equity_history)
        current = self.equity_history[-1]
        dd = (peak - current) / peak if peak > 0 else 0.0
        if dd <= DD_FULL_GROSS:
            return 1.0
        if dd >= DD_FLAT:
            return 0.0
        # linear interpolation
        if dd < DD_HALF_GROSS:
            return 1.0 - 0.5 * (dd - DD_FULL_GROSS) / (DD_HALF_GROSS - DD_FULL_GROSS)
        else:
            return 0.5 - 0.5 * (dd - DD_HALF_GROSS) / (DD_FLAT - DD_HALF_GROSS)

    # ── Correlation crash brake ────────────────────────────────────────────

    def correlation_brake_factor(self) -> float:
        """Cut gross leverage if sleeves are all moving together (diversification broken).

        Returns 1.0 normally, CORR_CRASH_FACTOR when avg pairwise corr >
        CORR_CRASH_THRESHOLD over trailing 20d window.
        """
        if len(self.sleeve_returns) < 2:
            return 1.0
        min_len = 20
        arrays = []
        for rets in self.sleeve_returns.values():
            if len(rets) >= min_len:
                arrays.append(np.array(rets[-min_len:]))
        if len(arrays) < 2:
            return 1.0

        mat = np.column_stack(arrays)
        corr = np.corrcoef(mat.T)
        n = len(arrays)
        # avg pairwise (off-diagonal)
        off_diag = []
        for i in range(n):
            for j in range(i + 1, n):
                off_diag.append(corr[i, j])
        avg_corr = float(np.mean(off_diag)) if off_diag else 0.0

        if avg_corr > CORR_CRASH_THRESHOLD:
            return CORR_CRASH_FACTOR
        return 1.0

    # ── Combined scale ─────────────────────────────────────────────────────

    def leverage_scale(self) -> float:
        """Final leverage multiplier for all sleeve weights.

        = min(kelly_leverage, vol_scale) × drawdown_scale × corr_brake, capped at MAX_GROSS.
        """
        base = min(self.kelly_leverage(), self.vol_scale())
        dd = self.drawdown_scale()
        corr = self.correlation_brake_factor()
        scale = base * dd * corr
        return float(np.clip(scale, 0.0, MAX_GROSS))

    def gross_leverage(self) -> float:
        """Diagnostic: current gross leverage."""
        return self.leverage_scale()

    def state_dict(self) -> dict:
        """Serializable state for dashboard / Neon publish."""
        return {
            "kelly_leverage": round(self.kelly_leverage(), 3),
            "vol_scale": round(self.vol_scale(), 3),
            "drawdown_scale": round(self.drawdown_scale(), 3),
            "corr_brake": round(self.correlation_brake_factor(), 3),
            "leverage_scale": round(self.leverage_scale(), 3),
            "gross_cap": MAX_GROSS,
            "port_vol_target": PORT_VOL_TARGET,
        }
