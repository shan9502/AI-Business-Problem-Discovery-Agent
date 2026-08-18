import { defineConfig } from "drizzle-kit";
import path from "path";

const dbUrl = process.env.DATABASE_URL ?? "./data/business_observer.db";

export default defineConfig({
  schema: "./lib/db/schema/sqlite.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl,
  },
});
