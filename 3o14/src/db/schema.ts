import { bigint, boolean, check, index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Uuid } from "../utils/uuid";
import { isNotNull, relations, sql } from "drizzle-orm";

const currentTimestamp = sql`CURRENT_TIMESTAMP`;


export const postVisibilityEnum = pgEnum("post_visibility", [
  "public",
  "unlisted",
  "private",
  "direct",
]);

export type PostVisibility = (typeof postVisibilityEnum.enumValues)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    email: varchar("email", { length: 254 }).notNull().unique(),
    username: varchar("username", { length: 254 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").notNull().default(currentTimestamp),
    updatedAt: timestamp("updated_at").notNull().default(currentTimestamp),
    visibility: postVisibilityEnum("visibility").notNull().default("public")
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
  followersUrl: text("followers_url"),
  followingUrl: text("following_url"),
  followingCount: bigint("following_count", { mode: "number" }).default(0),
  followersCount: bigint("followers_count", { mode: "number" }).default(0),
  postsCount: bigint("posts_count", { mode: "number" }).default(0),
  rsaPrivateKey: jsonb("rsa_private_key").$type<JsonWebKey>(),
  rsaPublicKey: jsonb("rsa_public_key").$type<JsonWebKey>(),
  ed25519PrivateKey: jsonb("ed25519_private_key").$type<JsonWebKey>(),
  ed25519PublicKey: jsonb("ed25519_public_key").$type<JsonWebKey>(),
})


export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert

export const accountRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  }),
  following: many(follows, { relationName: "following" }),
  follower: many(follows, { relationName: "follower" }),
}));

export const follows = pgTable(
  "follows",
  {
    uri: text("uri").notNull().unique(),
    followingId: uuid("following_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    followerId: uuid("follower_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created")
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    check("check_self_follow", sql`${table.followerId} != ${table.followingId}`),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;

export const followRelations = relations(follows, ({ one }) => ({
  following: one(accounts, {
    fields: [follows.followingId],
    references: [accounts.id],
    relationName: "follower",
  }),
  follower: one(accounts, {
    fields: [follows.followerId],
    references: [accounts.id],
    relationName: "following",
  })
}))

export const postTypeEnum = pgEnum("post_type", [
  "Article",
  "Note",
  "Question",
]);

export type PostType = (typeof postTypeEnum.enumValues)[number];

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    uri: text("uri").notNull().unique(),
    type: postTypeEnum("type").notNull(),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // TODO application
    replyTargetId: uuid("reply_target_id")
      .$type<Uuid>()
      .references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    sharingId: uuid("sharing_id")
      .$type<Uuid>()
      .references((): AnyPgColumn => posts.id, { onDelete: "cascade" }),
    visibility: postVisibilityEnum("visibility").notNull(),
    summary: text("summary"),
    contentHtml: text("content_html"),
    content: text("content"),
    // TODO polls, media, tags etc
    sensitive: boolean("sensitive").notNull().default(false),
    url: text("url"),
    repliesCount: bigint("replies_count", { mode: "number" }).default(0),
    sharesCount: bigint("shares_count", { mode: "number" }).default(0),
    likesCount: bigint("likes_count", { mode: "number" }).default(0),
    published: timestamp("published", { withTimezone: true }),
    updated: timestamp("updated", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    unique("posts_id_actor_id_unique").on(table.id, table.accountId),
    unique().on(table.accountId, table.sharingId),
    index().on(table.sharingId),
    index().on(table.accountId),
    index().on(table.accountId, table.sharingId),
    index().on(table.replyTargetId),
    index().on(table.visibility, table.accountId),
    index()
      .on(table.visibility, table.accountId, table.sharingId)
      .where(isNotNull(table.sharingId)),
    index()
      .on(table.visibility, table.accountId, table.replyTargetId)
      .where(isNotNull(table.replyTargetId)),
  ]
)

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export const postRelations = relations(posts, ({ one, many }) => ({
  account: one(accounts, {
    fields: [posts.accountId],
    references: [accounts.id],
  }),
  //application
  replyTarget: one(posts, {
    fields: [posts.replyTargetId],
    references: [posts.id],
    relationName: "reply",
  }),
  replies: many(posts, { relationName: "reply" }),
  // likes
  sharing: one(posts, {
    fields: [posts.sharingId],
    references: [posts.id],
    relationName: "share",
  }),
  shares: many(posts, { relationName: "share" }),
}))
