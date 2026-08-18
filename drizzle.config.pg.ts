import { defineConfig } from "drizzle-kit";

// Use DATABASE_URL
const dbUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "./lib/db/schema/pg.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl || "postgres://localhost:5432/business_observer",
  },
});
