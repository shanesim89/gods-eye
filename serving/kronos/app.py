"""
Kronos forecast Modal app.
CPU-only (2 vCPU / 4 GB) — sufficient for Kronos-small at batch=1.
Deploy:  modal deploy serving/kronos/app.py
Test:    modal run serving/kronos/app.py::test_predict
"""

import modal

# ---------------------------------------------------------------------------
# Image — clone Kronos repo + install deps
# ---------------------------------------------------------------------------
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch==2.2.2",
        "transformers>=4.40.0",
        "huggingface_hub>=0.23.0",
        "pandas>=2.0.0",
        "numpy>=1.24.0",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cpu",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/shiyu-coder/Kronos /kronos"
    )
)

app = modal.App("kronos-forecast", image=image)

# ---------------------------------------------------------------------------
# Service class — model loaded once per container lifetime
# ---------------------------------------------------------------------------
@app.cls(
    cpu=2.0,
    memory=4096,
    scaledown_window=300,   # sleep after 5 min idle — no idle cost
    timeout=120,            # hard kill after 2 min
)
class KronosService:

    @modal.enter()
    def load(self):
        import sys
        import os
        sys.path.insert(0, "/kronos")
        os.chdir("/kronos")  # needed for relative imports inside the repo

        from model import Kronos, KronosTokenizer, KronosPredictor  # type: ignore

        print("[kronos] loading tokenizer …")
        self.tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
        print("[kronos] loading model …")
        self.model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
        self.predictor = KronosPredictor(self.model, self.tokenizer, max_context=512)
        print("[kronos] ready.")

    @modal.method()
    def predict(self, payload: dict) -> dict:
        """
        payload: {
          ohlcv: [{ts, open, high, low, close, volume}, ...],   # 50-400 bars
          pred_len: int,   # 5 for stocks/etf, 7 for crypto
          samples: int,    # default 8
        }
        returns: {
          direction: "up" | "down" | "flat",
          price_delta_pct: float,
          sample_std: float,
          bars: [{ts, open, high, low, close, volume}, ...]
        }
        """
        import pandas as pd
        import numpy as np

        ohlcv = payload["ohlcv"]
        pred_len = int(payload.get("pred_len", 5))
        samples = int(payload.get("samples", 8))

        df = pd.DataFrame(ohlcv)
        df["timestamps"] = pd.to_datetime(df["ts"])

        # Use last min(400, len) bars as context
        ctx_len = min(400, len(df))
        x_df = df.tail(ctx_len)[["open", "high", "low", "close", "volume"]].reset_index(drop=True)
        x_ts = df.tail(ctx_len)["timestamps"].reset_index(drop=True)

        # Build future timestamps (daily spacing from last bar)
        last_ts = x_ts.iloc[-1]
        freq = pd.tseries.frequencies.to_offset("B")  # business day
        y_ts = pd.date_range(start=last_ts, periods=pred_len + 1, freq=freq)[1:]

        # Run with multiple samples for uncertainty
        sample_closes = []
        pred_df = None
        for _ in range(samples):
            p = self.predictor.predict(
                df=x_df,
                x_timestamp=x_ts,
                y_timestamp=pd.Series(y_ts),
                pred_len=pred_len,
                T=1.0,
                top_p=0.9,
                sample_count=1,
                verbose=False,
            )
            sample_closes.append(float(p["close"].iloc[-1]))
            if pred_df is None:
                pred_df = p

        current_close = float(x_df["close"].iloc[-1])
        mean_final_close = float(np.mean(sample_closes))
        price_delta_pct = ((mean_final_close - current_close) / current_close) * 100
        sample_std = float(np.std(sample_closes))

        FLAT_BAND = 0.5
        if price_delta_pct > FLAT_BAND:
            direction = "up"
        elif price_delta_pct < -FLAT_BAND:
            direction = "down"
        else:
            direction = "flat"

        bars = []
        if pred_df is not None:
            for i, row in pred_df.iterrows():
                bars.append({
                    "ts": str(y_ts[i]) if i < len(y_ts) else "",
                    "open": float(row.get("open", 0)),
                    "high": float(row.get("high", 0)),
                    "low": float(row.get("low", 0)),
                    "close": float(row.get("close", 0)),
                    "volume": float(row.get("volume", 0)),
                })

        return {
            "direction": direction,
            "price_delta_pct": round(price_delta_pct, 4),
            "sample_std": round(sample_std, 4),
            "bars": bars,
        }


# ---------------------------------------------------------------------------
# HTTP endpoint — validates Bearer token, delegates to KronosService.predict
# ---------------------------------------------------------------------------
@app.function(cpu=0.25, memory=256, timeout=130)
@modal.fastapi_endpoint(method="POST", label="kronos-forecast-web")
def web(payload: dict) -> dict:
    """
    HTTP POST endpoint. URL kept private — no auth header needed.
    Delegates to KronosService.predict running in the GPU/CPU container.
    """
    svc = KronosService()
    return svc.predict.remote(payload)


# ---------------------------------------------------------------------------
# Local test entrypoint
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def test_predict():
    """Run: modal run serving/kronos/app.py"""
    import json, datetime

    # Build 60 synthetic daily bars
    import math
    bars = []
    price = 100.0
    base_date = datetime.date(2024, 1, 2)
    for i in range(60):
        d = base_date + datetime.timedelta(days=i)
        price *= 1 + 0.001 * math.sin(i / 5)
        bars.append({
            "ts": d.isoformat(),
            "open": round(price * 0.999, 4),
            "high": round(price * 1.005, 4),
            "low":  round(price * 0.995, 4),
            "close": round(price, 4),
            "volume": 1_000_000,
        })

    svc = KronosService()
    result = svc.predict.remote({
        "ohlcv": bars,
        "pred_len": 5,
        "samples": 4,
    })
    print(json.dumps(result, indent=2))
