import { bigint, boolean, check, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { Uuid } from "../utils/uuid";
import { relations, sql } from "drizzle-orm";

const currentTimestamp = sql`CURRENT_TIMESTAMP`;

export const users = pgTable(
  "users",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    email: varchar("email", { length: 254 }).notNull().unique(),
    username: varchar("username", { length: 254 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").notNull().default(currentTimestamp),
    updatedAt: timestamp("updated_at").notNull().default(currentTimestamp),
  },
  (table) => [
    check(
      "username",
      sql`rtrim(ltrim(${table.username})) = ${table.username} AND ${table.username} <> '' AND length(username) <= 50`,
    ),
  ],
);

export const userRelations = relations(users, ({ one }) => ({
  account: one(accounts, {
    fields: [users.id],
    references: [accounts.userId],
  })
}))

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const accounts = pgTable("accounts", {
  id: uuid("id").$type<Uuid>().primaryKey(),
  userId: uuid("user_id").$type<Uuid>().references(() => users.id, { onDelete: "cascade" }),
  uri: text("uri").notNull().unique(),
  url: text("url"),
  handle: text("handle").notNull().unique(),
  bio: text("bio"),
  createdAt: timestamp("created_at").notNull().default(currentTimestamp),
  updatedAt: timestamp("updated_at").notNull().default(currentTimestamp),
  preferredName: text("preferred_name"),
  visibility: boolean("visibility").notNull().default(true),
  inboxUrl: text("inbox_url").notNull().unique(),
  sharedInboxUrl: text("shared_inbox_urk"),
  outboxUrl: text("outbox_url").notNull().unique(),
  followersUrl: text("followers_url").notNull().unique(),
  followingUrl: text("following_url").notNull().unique(),
  followingCount: bigint("following_count", { mode: "number" }).default(0),
  followersCount: bigint("followers_count", { mode: "number" }).default(0),
  postsCount: bigint("posts_count", { mode: "number" }).default(0),
  rsaPrivateKey: jsonb("rsa_private_key").$type<JsonWebKey>(),
  rsaPublicKey: jsonb("rsa_public_key").$type<JsonWebKey>().notNull(),
  ed25519PrivateKey: jsonb("ed25519_private_key").$type<JsonWebKey>(),
  ed25519PublicKey: jsonb("ed25519_public_key").$type<JsonWebKey>().notNull(),
})


export const Account = typeof accounts.$inferSelect;
export const NewAccount = typeof accounts.$inferInsert

export const accountRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  }),
}));
