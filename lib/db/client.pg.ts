import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/pg";

// Singleton connection — reused across hot-reloads in dev
const globalForDb = global as typeof globalThis & {
  _pgPool?: Pool;
};

if (!globalForDb._pgPool) {
  const connectionString = process.env.DATABASE_URL;
  if (process.env.DATABASE_PROVIDER === "postgres" && connectionString) {
    globalForDb._pgPool = new Pool({
      connectionString,
    });
  }
}

export const pgPool = globalForDb._pgPool;

// We export db as an optional. The queries.pg.ts will assert it exists when running.
export const db = pgPool ? drizzle(pgPool, { schema }) : null;
