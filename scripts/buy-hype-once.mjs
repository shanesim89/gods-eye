// One-off manual buy: 1 HYPE on Hyperliquid spot (mainnet). Real money.
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// --- load .env.local ---
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "");
  env[m[1]] = v;
}

const isTestnet = env.HYPERLIQUID_TESTNET === "1";
const addr = env.HYPERLIQUID_ACCOUNT_ADDRESS;
const pk = env.HYPERLIQUID_PRIVATE_KEY;
if (!addr || !pk) throw new Error("missing HL env");
console.log("network:", isTestnet ? "TESTNET" : "MAINNET");

const transport = new HttpTransport({ isTestnet });
const info = new InfoClient({ transport });

// --- resolve HYPE/USDC spot pair ---
const meta = await info.spotMeta();
const tok = meta.tokens.find((t) => t.name === "HYPE");
const pair = meta.universe.find((u) => u.tokens[0] === tok.index && u.tokens[1] === 0);
const assetId = 10000 + pair.index;
console.log("HYPE token idx:", tok.index, "pair idx:", pair.index, "assetId:", assetId, "szDecimals:", tok.szDecimals);

// --- price + balance ---
const mids = await info.allMids();
const px = parseFloat(mids["@" + pair.index] ?? mids["HYPE"]);
console.log("HYPE spot mid:", px);

const state = await info.spotClearinghouseState({ user: addr });
const usdc = state.balances.find((b) => b.coin === "USDC" || b.coin === "@0");
const bal = usdc ? parseFloat(usdc.total) : 0;
console.log("USDC spot balance:", bal);

const qty = 1; // 1 HYPE
const limitPx = (px * 1.05).toFixed(2); // 5% marketable, 4 sig figs — valid for HL
const needed = px * qty * 1.05;
if (bal < needed) {
  throw new Error(`insufficient USDC spot balance: ${bal} < ~${needed.toFixed(2)} needed`);
}

console.log(`\nPLACING: BUY ${qty} HYPE @ limit ${limitPx} (FrontendMarket IOC)\n`);

const wallet = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const exchange = new ExchangeClient({ transport, wallet });
const result = await exchange.order({
  orders: [{ a: assetId, b: true, p: limitPx, s: String(qty), r: false, t: { limit: { tif: "FrontendMarket" } } }],
  grouping: "na",
});

console.log("RAW RESULT:", JSON.stringify(result, null, 2));
const status = result.response.data.statuses[0];
if (status?.filled) {
  console.log(`\n✅ FILLED: ${status.filled.totalSz} HYPE @ avg ${status.filled.avgPx} (oid ${status.filled.oid})`);
} else {
  console.log("\n⚠️ NOT FILLED:", JSON.stringify(status));
}
