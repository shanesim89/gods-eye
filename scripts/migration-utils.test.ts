import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  executeMigration,
  loadMigration,
  verifyStrategyLedgerSchema,
} from "./migration-utils.mjs";

describe("migration utilities", () => {
  it("validates the migration argument and file", () => {
    expect(() => loadMigration(undefined)).toThrow("migration file argument is required");
    expect(() => loadMigration("missing.sql", tmpdir())).toThrow("migration file does not exist");
    expect(() => loadMigration("migration.txt", tmpdir())).toThrow("migration file must have a .sql extension");
  });

  it("rejects empty migration files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gods-eye-migration-"));
    const file = join(dir, "empty.sql");
    writeFileSync(file, "", "utf8");

    expect(() => loadMigration(file)).toThrow("migration file contains no statements");
  });

  it("splits non-empty migration statements", () => {
    const dir = mkdtempSync(join(tmpdir(), "gods-eye-migration-"));
    const file = join(dir, "0011_test.sql");
    writeFileSync(file, "SELECT 1;\n--> statement-breakpoint\n\nSELECT 2;\n", "utf8");

    expect(loadMigration(file).statements).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("submits every statement in one transaction", async () => {
    const query = vi.fn((statement: string) => ({ statement }));
    const transaction = vi.fn((callback: (txn: { query: typeof query }) => unknown[]) => {
      const queries = callback({ query });
      return Promise.resolve(queries);
    });

    await expect(executeMigration({ transaction }, ["SELECT 1", "SELECT 2"]))
      .resolves.toEqual([{ statement: "SELECT 1" }, { statement: "SELECT 2" }]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, "SELECT 1");
    expect(query).toHaveBeenNthCalledWith(2, "SELECT 2");
  });

  it("propagates transaction failures", async () => {
    const failure = new Error("statement failed");
    const sql = { transaction: vi.fn(() => Promise.reject(failure)) };

    await expect(executeMigration(sql, ["invalid sql"])).rejects.toBe(failure);
  });

  it("accepts complete strategy-ledger schema postconditions", async () => {
    const sql = vi.fn().mockResolvedValue([{
      runs: true,
      events: true,
      observations: true,
      reconciliations: true,
      entries_enabled: true,
      management_enabled: true,
      runs_trigger: true,
      events_trigger: true,
      observations_trigger: true,
      reconciliations_trigger: true,
    }]);

    await expect(verifyStrategyLedgerSchema(sql)).resolves.toBeUndefined();
  });

  it("rejects incomplete strategy-ledger schema postconditions", async () => {
    const sql = vi.fn().mockResolvedValue([{
      runs: true,
      events: false,
      observations: true,
      reconciliations: true,
      entries_enabled: true,
      management_enabled: true,
      runs_trigger: true,
      events_trigger: true,
      observations_trigger: true,
      reconciliations_trigger: true,
    }]);

    await expect(verifyStrategyLedgerSchema(sql))
      .rejects.toThrow("strategy ledger schema postconditions failed");
  });
});
