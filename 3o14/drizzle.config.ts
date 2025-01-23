import type { Config } from "drizzle-kit";

// biome-ignore lint/complexity/useLiteralKeys: tsc rants about this (TS4111)
const db_url = process.env["DATABASE_URL"];
if (db_url == null) throw new Error("DATABASE_URL must be defined");

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: db_url,
  },
} satisfies Config;
