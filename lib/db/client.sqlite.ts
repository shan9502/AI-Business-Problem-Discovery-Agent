import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema/sqlite";
import fs from "fs";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

if (process.env.DATABASE_PROVIDER !== "postgres") {
  const DB_PATH = process.env.DATABASE_URL ?? "./data/business_observer.db";
  const absolutePath = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(/*turbopackIgnore: true*/ process.cwd(), DB_PATH);

  // Ensure the data directory exists
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Singleton connection — reused across hot-reloads in dev
  const globalForDb = global as typeof globalThis & {
    _sqliteDb?: Database.Database;
  };

  if (!globalForDb._sqliteDb) {
    globalForDb._sqliteDb = new Database(absolutePath);
    // Enable WAL for better concurrency
    globalForDb._sqliteDb.pragma("journal_mode = WAL");
  }

  sqlite = globalForDb._sqliteDb;
  db = drizzle(sqlite, { schema });
} else {
  // Dummy initialization to satisfy exports if evaluated when not active
  sqlite = {} as any;
  db = {} as any;
}

export { sqlite, db };
