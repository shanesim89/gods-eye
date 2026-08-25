import "dotenv/config";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import {
  executeMigration,
  loadMigration,
  verifyStrategyLedgerSchema,
} from "./migration-utils.mjs";

config({ path: ".env.local", override: false });

function safeErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "unknown migration error";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const { statements } = loadMigration(process.argv[2]);
  console.log(`applying ${statements.length} statements in one transaction`);

  const sql = neon(process.env.DATABASE_URL);
  await executeMigration(sql, statements);
  await verifyStrategyLedgerSchema(sql);

  console.log(`migration committed and verified (${statements.length}/${statements.length} statements)`);
}

try {
  await main();
} catch (error) {
  console.error(`migration failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}
