import fs from "node:fs";
import path from "node:path";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function loadMigration(fileArgument, cwd = process.cwd()) {
  if (typeof fileArgument !== "string" || fileArgument.trim() === "") {
    throw new Error("migration file argument is required");
  }

  const filePath = path.resolve(cwd, fileArgument);
  if (path.extname(filePath).toLowerCase() !== ".sql") {
    throw new Error("migration file must have a .sql extension");
  }

  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error("migration file does not exist");
    }
    throw new Error("migration file could not be read");
  }

  const statements = source
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    throw new Error("migration file contains no statements");
  }

  return { filePath, statements };
}

export async function executeMigration(sql, statements) {
  if (!sql || typeof sql.transaction !== "function") {
    throw new Error("database client does not support transactions");
  }
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error("migration contains no statements");
  }

  return sql.transaction((txn) => statements.map((statement) => txn.query(statement)));
}

export async function verifyStrategyLedgerSchema(sql) {
  if (typeof sql !== "function") {
    throw new Error("database client does not support schema verification");
  }

  const rows = await sql`
    SELECT
      to_regclass('public.strategy_runs') IS NOT NULL AS runs,
      to_regclass('public.strategy_events') IS NOT NULL AS events,
      to_regclass('public.strategy_daily_observations') IS NOT NULL AS observations,
      to_regclass('public.strategy_reconciliation_snapshots') IS NOT NULL AS reconciliations,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_options_settings'
          AND column_name = 'entries_enabled'
      ) AS entries_enabled,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_options_settings'
          AND column_name = 'risk_reducing_management_enabled'
      ) AS management_enabled,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'strategy_runs_immutable' AND NOT tgisinternal
      ) AS runs_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'strategy_events_immutable' AND NOT tgisinternal
      ) AS events_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'strategy_daily_observations_immutable' AND NOT tgisinternal
      ) AS observations_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'strategy_reconciliation_snapshots_immutable' AND NOT tgisinternal
      ) AS reconciliations_trigger
  `;

  const result = rows[0];
  const checks = result && Object.values(result);
  if (!checks || checks.length !== 10 || checks.some((value) => value !== true)) {
    throw new Error("strategy ledger schema postconditions failed");
  }
}
