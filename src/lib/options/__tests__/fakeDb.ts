// In-memory double for the exact drizzle-orm surface engine.ts uses:
// select/insert/update, .from/.where/.limit, .onConflictDoNothing/.onConflictDoUpdate,
// .returning, and the one raw `sql` aggregate (coalesce(sum(...))) it runs.
//
// Design: `eq`/`and`/`lte` are mocked (via vi.mock("drizzle-orm", ...)) to
// return plain row-predicate closures instead of real SQL AST nodes — a
// FakeQueryBuilder's .where() just runs the predicate against the in-memory
// store. This exercises engine.ts's REAL control flow (gate order, state
// transitions, idempotency) without a Postgres connection, at the cost of
// not validating the real SQL drizzle would generate — acceptable since
// strategy.ts's pure-math paths are already covered elsewhere; this suite's
// job is the orchestration logic, not the ORM layer.

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

// Column DEFAULTs Postgres applies when an insert omits the field — real
// drizzle/Postgres fills these in transparently; our fake INSERT must too,
// or a value the engine legitimately relies on defaulting (e.g. `status`
// defaulting to "open" — engine.ts:813-828's reshort() insert never sets
// `status` explicitly) silently comes back `undefined` instead. Mirror only
// `src/db/schema.ts`'s `.default(...)` values actually depended on here.
const TABLE_DEFAULTS: Record<string, Row> = {
  ai_options_positions: { status: "open", contracts: 1, collateral_usd: "0" },
};

export function makeStore(): Store {
  return {
    ai_options_settings: [],
    ai_options_wheel: [],
    ai_options_positions: [],
    ai_options_orders: [],
  };
}

function tableName(table: unknown): string {
  // drizzle pgTable objects carry their name at a well-known symbol; the
  // schema modules we import here also export the table under that exact
  // JS identifier, so matching by reference identity via a registry set at
  // mock-setup time is simpler and more robust than reading drizzle internals.
  const found = tableRegistry.get(table);
  if (!found) throw new Error("fakeDb: unregistered table object");
  return found;
}

const tableRegistry = new Map<unknown, string>();
export function registerTables(tables: Record<string, unknown>) {
  for (const [name, t] of Object.entries(tables)) tableRegistry.set(t, name);
}

type Pred = (row: Row) => boolean;
type AggMarker = { __aggSum: string };

function isAgg(v: unknown): v is AggMarker {
  return !!v && typeof v === "object" && "__aggSum" in v;
}

class SelectBuilder {
  private table = "";
  private pred: Pred = () => true;
  private lim: number | null = null;
  constructor(private store: Store, private selectShape?: Record<string, unknown>) {}
  from(table: unknown) {
    this.table = tableName(table);
    return this;
  }
  where(pred: Pred) {
    this.pred = pred;
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  private exec(): Row[] {
    const rows = (this.store[this.table] ?? []).filter(this.pred);
    const sliced = this.lim != null ? rows.slice(0, this.lim) : rows;
    if (this.selectShape) {
      const aggEntry = Object.entries(this.selectShape).find(([, v]) => isAgg(v));
      if (aggEntry) {
        const [key, marker] = aggEntry as [string, AggMarker];
        const sum = rows.reduce((s, r) => s + parseFloat(String(r[marker.__aggSum] ?? 0)), 0);
        return [{ [key]: String(sum) }];
      }
      return sliced.map((r) => {
        const out: Row = {};
        for (const k of Object.keys(this.selectShape!)) out[k] = r[k];
        return out;
      });
    }
    return sliced;
  }
  then<T>(resolve: (v: Row[]) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.exec()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

class InsertBuilder {
  private table = "";
  private row: Row = {};
  private conflictTarget: unknown[] | null = null;
  private conflictSet: Row | null = null;
  private conflictSkip = false;
  private returningShape: Record<string, unknown> | null = null;
  constructor(private store: Store, table: unknown) {
    this.table = tableName(table);
  }
  values(row: Row) {
    this.row = { ...row };
    return this;
  }
  onConflictDoNothing(opts: { target: unknown }) {
    this.conflictSkip = true;
    this.conflictTarget = Array.isArray(opts.target) ? opts.target : [opts.target];
    return this;
  }
  onConflictDoUpdate(opts: { target: unknown; set: Row }) {
    this.conflictTarget = Array.isArray(opts.target) ? opts.target : [opts.target];
    this.conflictSet = opts.set;
    return this;
  }
  returning(shape?: Record<string, unknown>) {
    this.returningShape = shape ?? null;
    return this;
  }
  private conflictKeyCols(): string[] {
    // Registered conflict target columns resolve to their JS field names via
    // the same tableRegistry-adjacent column name lookup used elsewhere —
    // simplified here by convention: composite PK tables key on
    // (user_id, underlying); single-unique tables key on idempotency_key.
    if (this.table === "ai_options_wheel") return ["user_id", "underlying"];
    if (this.table === "ai_options_orders") return ["idempotency_key"];
    return ["id"];
  }
  private exec(): Row[] {
    const rows = this.store[this.table] ?? (this.store[this.table] = []);
    const keyCols = this.conflictKeyCols();
    const existing =
      this.conflictTarget &&
      rows.find((r) => keyCols.every((c) => r[c] === this.row[c]));
    if (existing) {
      if (this.conflictSkip) return [];
      if (this.conflictSet) Object.assign(existing, this.conflictSet);
      return this.returningShape ? [pick(existing, this.returningShape)] : [existing];
    }
    const defaults = TABLE_DEFAULTS[this.table] ?? {};
    const inserted: Row = { id: this.row.id ?? cryptoRandomId(), created_at: new Date(), ...defaults, ...this.row };
    rows.push(inserted);
    return this.returningShape ? [pick(inserted, this.returningShape)] : [inserted];
  }
  then<T>(resolve: (v: Row[]) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.exec()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

class UpdateBuilder {
  private table = "";
  private patch: Row = {};
  private pred: Pred = () => true;
  constructor(private store: Store, table: unknown) {
    this.table = tableName(table);
  }
  set(patch: Row) {
    this.patch = patch;
    return this;
  }
  where(pred: Pred) {
    this.pred = pred;
    return this;
  }
  private exec(): Row[] {
    const rows = (this.store[this.table] ?? []).filter(this.pred);
    for (const r of rows) Object.assign(r, this.patch);
    return rows;
  }
  then<T>(resolve: (v: Row[]) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.exec()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

class DeleteBuilder {
  private table = "";
  private pred: Pred = () => true;
  constructor(private store: Store, table: unknown) {
    this.table = tableName(table);
  }
  where(pred: Pred) {
    this.pred = pred;
    return this;
  }
  private exec(): Row[] {
    const rows = this.store[this.table] ?? [];
    const keep = rows.filter((r) => !this.pred(r));
    const removed = rows.filter((r) => this.pred(r));
    this.store[this.table] = keep;
    return removed;
  }
  then<T>(resolve: (v: Row[]) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.exec()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

function pick(row: Row, shape: Record<string, unknown>): Row {
  const out: Row = {};
  for (const k of Object.keys(shape)) out[k] = row[k];
  return out;
}

function cryptoRandomId(): string {
  return `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function makeFakeDb(store: Store) {
  return {
    select: (shape?: Record<string, unknown>) => new SelectBuilder(store, shape),
    insert: (table: unknown) => new InsertBuilder(store, table),
    update: (table: unknown) => new UpdateBuilder(store, table),
    delete: (table: unknown) => new DeleteBuilder(store, table),
  };
}

