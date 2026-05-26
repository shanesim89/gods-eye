// One-off: set base_currency = SGD for existing user(s)
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const r = await sql`UPDATE users SET base_currency = 'SGD' RETURNING id, email, base_currency`;
console.log("updated:", r);
