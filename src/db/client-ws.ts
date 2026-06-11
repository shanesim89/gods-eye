import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// WebSocket driver — required for transactions in Neon serverless.
// Only used where atomic read-modify-write is needed (e.g. monthly cap claim).
// For read-only / single-statement queries keep using the HTTP client (src/db/client.ts).
neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

// Pool is opened per-module load and reused within the same serverless invocation.
// Vercel closes the function after the response, so no persistent connection leak.
const pool = new Pool({ connectionString: url });
export const dbWs = drizzle(pool, { schema });
export { pool as wsPool };
