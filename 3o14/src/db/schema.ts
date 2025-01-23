import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { Uuid } from "../utils/uuid";
import { sql } from "drizzle-orm";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    username: text("username").notNull().unique(),
  },
  (table) => [
    check(
      "username",
      sql`rtrim(ltrim(${table.username})) = ${table.username} AND ${table.username} <> '' AND length(username) <= 50`,
    ),
  ],
);
