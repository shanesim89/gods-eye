import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import fs from "fs";
if (!process.env.DATABASE_URL) { console.error("no DATABASE_URL"); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const file = fs.readFileSync(process.argv[2], "utf8");
const parts = file.split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean);
for (const p of parts) {
  console.log("running:", p.slice(0,80).replace(/\n/g," "));
  try { await sql.query(p); console.log("ok"); } catch(e){ console.log("err:", e.message); }
}
console.log("done");
