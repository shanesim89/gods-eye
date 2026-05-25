// One-shot migration runner: executes drizzle-generated SQL against Neon via HTTP.
// Usage: node scripts/migrate.mjs
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv(); // also try .env as fallback
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Put it in .env.local");
  process.exit(1);
}

const sql = neon(url);
const dir = resolve(process.cwd(), "drizzle");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No .sql files in ./drizzle");
  process.exit(1);
}

for (const f of files) {
  const full = resolve(dir, f);
  const content = readFileSync(full, "utf8");
  // drizzle-kit emits `--> statement-breakpoint` between statements
  const statements = content
    .split(/-->\s*statement-breakpoint/g)
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`[migrate] ${f} — ${statements.length} statements`);
  for (const stmt of statements) {
    try {
      await sql.query(stmt);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("already exists")) {
        console.log(`  skip (exists): ${stmt.slice(0, 60)}...`);
        continue;
      }
      console.error(`  FAIL: ${stmt.slice(0, 120)}...`);
      console.error(`  -> ${msg}`);
      process.exit(1);
    }
  }
}

console.log("[migrate] done.");
