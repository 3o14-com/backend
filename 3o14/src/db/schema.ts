import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { Uuid } from "../utils/uuid";
import { sql } from "drizzle-orm";

const currentTimestamp = sql`CURRENT_TIMESTAMP`;

export const users = pgTable(
  "users",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    email: varchar("email", { length: 254 }).notNull().unique(),
    username: varchar("username", { length: 254 }).notNull().unique(),
    preferred_name: varchar("preferred_name", { length: 254 }).unique(),
    password_hash: text("password_hash").notNull(),
    bio: text("bio"),
    created_at: timestamp("created_at").notNull().default(currentTimestamp),
    updated_at: timestamp("updated_at").notNull().default(currentTimestamp),
  },
  (table) => [
    check(
      "username",
      sql`rtrim(ltrim(${table.username})) = ${table.username} AND ${table.username} <> '' AND length(username) <= 50`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
