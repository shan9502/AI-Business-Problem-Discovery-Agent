import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_URL ?? "./data/business_observer.db";
const absolutePath = path.resolve(DB_PATH);

// Ensure the data directory exists
import fs from "fs";
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

export const sqlite = globalForDb._sqliteDb;
export const db = drizzle(sqlite, { schema });
