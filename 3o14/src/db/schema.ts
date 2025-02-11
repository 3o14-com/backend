import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  interval,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  type AnyPgColumn
} from "drizzle-orm/pg-core";
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
    visibility: postVisibilityEnum("visibility").notNull().default("public"),
    discoverable: boolean().notNull().default(true),
  },
  (table) => [
    check(
      "username",
      sql`rtrim(ltrim(${table.username})) = ${table.username} AND ${table.username} <> '' AND length(username) <= 50`,
    ),
  ],
);

export const userRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, {
    fields: [users.id],
    references: [accounts.userId],
  }),
  accessTokens: many(accessTokens),
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
  avatarurl: text("avatar_url"),
  coverurl: text("cover_url"),
  createdAt: timestamp("created_at").notNull().default(currentTimestamp),
  updatedAt: timestamp("updated_at").notNull().default(currentTimestamp),
  name: text("preferred_name"),
  visibility: boolean("visibility").notNull().default(true),
  protected: boolean("protected").notNull().default(false),
  inboxUrl: text("inbox_url").notNull().unique(),
  sharedInboxUrl: text("shared_inbox_urk"),
  followersUrl: text("followers_url"),
  followingUrl: text("following_url"),
  featuredUrl: text("featured_url"),
  followingCount: bigint("following_count", { mode: "number" }).default(0),
  followersCount: bigint("followers_count", { mode: "number" }).default(0),
  postsCount: bigint("posts_count", { mode: "number" }).default(0),
  instanceHost: text("instance_host")
    .notNull()
    .references(() => instances.host),
  sensitive: boolean("sensitive").notNull().default(false),
  successorId: uuid("successor_id")
    .$type<Uuid>()
    .references((): AnyPgColumn => accounts.id, { onDelete: "cascade" }),
  aliases: text("aliases").array().notNull().default(sql`(ARRAY[]::text[])`),
  fieldHtmls: json("field_htmls")
    .notNull()
    .default({})
    .$type<Record<string, string>>(),
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
  successor: one(accounts, {
    fields: [accounts.successorId],
    references: [accounts.id],
    relationName: "successor",
  }),
  predecessors: many(accounts, { relationName: "successor" }),
  following: many(follows, { relationName: "following" }),
  followers: many(follows, { relationName: "follower" }),
  posts: many(posts),
  mentions: many(mentions),
  likes: many(likes),
  pinnedPosts: many(pinnedPosts),
  mutes: many(mutes, { relationName: "muter" }),
  mutedBy: many(mutes, { relationName: "muted" }),
  blocks: many(blocks, { relationName: "blocker" }),
  blockedBy: many(blocks, { relationName: "blocked" }),
  instance: one(instances),
  featuredTags: many(featuredTags),
}));


export const instances = pgTable("instances", {
  host: text("host").notNull().primaryKey(),
  software: text("software"),
  softwareVersion: text("software_version"),
  created: timestamp("created", { withTimezone: true })
    .notNull()
    .default(currentTimestamp),
});

export type Instance = typeof instances.$inferSelect;
export type NewInstance = typeof instances.$inferInsert;

export const instanceRelations = relations(instances, ({ many }) => ({
  accounts: many(accounts),
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
    shares: boolean("shares").notNull().default(true),
    notify: boolean("notify").notNull().default(false),
    approved: timestamp("approved", { withTimezone: true }),
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
    accountId: uuid("actor_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .$type<Uuid>()
      .references(() => applications.id, { onDelete: "set null" }),
    replyTargetId: uuid("reply_target_id")
      .$type<Uuid>()
      .references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    sharingId: uuid("sharing_id")
      .$type<Uuid>()
      .references((): AnyPgColumn => posts.id, { onDelete: "cascade" }),
    quoteTargetId: uuid("quote_target_id")
      .$type<Uuid>()
      .references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    visibility: postVisibilityEnum("visibility").notNull(),
    summary: text("summary"),
    contentHtml: text("content_html"),
    content: text("content"),
    pollId: uuid("poll_id")
      .$type<Uuid>()
      .references(() => polls.id, { onDelete: "set null" }),
    language: text("language"),
    tags: jsonb("tags").notNull().default({}).$type<Record<string, string>>(),
    emojis: jsonb("emojis")
      .notNull()
      .default({})
      .$type<Record<string, string>>(),
    sensitive: boolean("sensitive").notNull().default(false),
    url: text("url"),
    repliesCount: bigint("replies_count", { mode: "number" }).default(0),
    sharesCount: bigint("shares_count", { mode: "number" }).default(0),
    likesCount: bigint("likes_count", { mode: "number" }).default(0),
    idempotenceKey: text("idempotence_key"),
    published: timestamp("published", { withTimezone: true }),
    updated: timestamp("updated", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    unique("posts_id_actor_id_unique").on(table.id, table.accountId),
    unique().on(table.pollId),
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
  ],
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;


export const postRelations = relations(posts, ({ one, many }) => ({
  account: one(accounts, {
    fields: [posts.accountId],
    references: [accounts.id],
  }),
  application: one(applications, {
    fields: [posts.applicationId],
    references: [applications.id],
  }),
  replyTarget: one(posts, {
    fields: [posts.replyTargetId],
    references: [posts.id],
    relationName: "reply",
  }),
  replies: many(posts, { relationName: "reply" }),
  likes: many(likes),
  sharing: one(posts, {
    fields: [posts.sharingId],
    references: [posts.id],
    relationName: "share",
  }),
  shares: many(posts, { relationName: "share" }),
  quoteTarget: one(posts, {
    fields: [posts.quoteTargetId],
    references: [posts.id],
    relationName: "quote",
  }),
  quotes: many(posts, { relationName: "quote" }),
  media: many(media),
  poll: one(polls, {
    fields: [posts.pollId],
    references: [polls.id],
  }),
  mentions: many(mentions),
  bookmarks: many(bookmarks),
  pin: one(pinnedPosts, {
    fields: [posts.id, posts.accountId],
    references: [pinnedPosts.postId, pinnedPosts.accountId],
  }),
}));


export const media = pgTable(
  "media",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    postId: uuid("post_id")
      .$type<Uuid>()
      .references(() => posts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    url: text("url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    description: text("description"),
    thumbnailType: text("thumbnail_type").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    thumbnailWidth: integer("thumbnail_width").notNull(),
    thumbnailHeight: integer("thumbnail_height").notNull(),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [index().on(table.postId)],
);

export type Medium = typeof media.$inferSelect;
export type NewMedium = typeof media.$inferInsert;

export const mediumRelations = relations(media, ({ one }) => ({
  post: one(posts, {
    fields: [media.postId],
    references: [posts.id],
  }),
}));

export const polls = pgTable("polls", {
  id: uuid("id").$type<Uuid>().primaryKey(),
  multiple: boolean("multiple").notNull().default(false),
  votersCount: bigint("voters_count", { mode: "number" }).notNull().default(0),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  created: timestamp("created", { withTimezone: true })
    .notNull()
    .default(currentTimestamp),
});

export type Poll = typeof polls.$inferSelect;
export type NewPoll = typeof polls.$inferInsert;

export const pollRelations = relations(polls, ({ one, many }) => ({
  post: one(posts, {
    fields: [polls.id],
    references: [posts.pollId],
  }),
  options: many(pollOptions),
  votes: many(pollVotes),
}));

export const pollOptions = pgTable(
  "poll_options",
  {
    pollId: uuid("poll_id")
      .$type<Uuid>()
      .references(() => polls.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    title: text("title").notNull(),
    votesCount: bigint("votes_count", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.pollId, table.index] }),
    unique().on(table.pollId, table.title),
    index().on(table.pollId, table.index),
  ],
);

export type PollOption = typeof pollOptions.$inferSelect;
export type NewPollOption = typeof pollOptions.$inferInsert;

export const pollOptionRelations = relations(pollOptions, ({ one, many }) => ({
  poll: one(polls, {
    fields: [pollOptions.pollId],
    references: [polls.id],
  }),
  votes: many(pollVotes),
}));

export const pollVotes = pgTable(
  "poll_votes",
  {
    pollId: uuid("poll_id")
      .$type<Uuid>()
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionIndex: integer("option_index").notNull(),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    primaryKey({
      columns: [table.pollId, table.optionIndex, table.accountId],
    }),
    foreignKey({
      columns: [table.pollId, table.optionIndex],
      foreignColumns: [pollOptions.pollId, pollOptions.index],
    }),
    index().on(table.pollId, table.accountId),
  ],
);

export type PollVote = typeof pollVotes.$inferSelect;
export type NewPollVote = typeof pollVotes.$inferInsert;

export const pollVoteRelations = relations(pollVotes, ({ one }) => ({
  poll: one(polls, {
    fields: [pollVotes.pollId],
    references: [polls.id],
  }),
  option: one(pollOptions, {
    fields: [pollVotes.pollId, pollVotes.optionIndex],
    references: [pollOptions.pollId, pollOptions.index],
  }),
  account: one(accounts, {
    fields: [pollVotes.accountId],
    references: [accounts.id],
  }),
}));

export const mentions = pgTable(
  "mentions",
  {
    postId: uuid("post_id")
      .$type<Uuid>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.accountId] }),
    index().on(table.postId, table.accountId),
  ],
);

export type Mention = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;

export const mentionRelations = relations(mentions, ({ one }) => ({
  post: one(posts, {
    fields: [mentions.postId],
    references: [posts.id],
  }),
  account: one(accounts, {
    fields: [mentions.accountId],
    references: [accounts.id],
  }),
}));

export const pinnedPosts = pgTable(
  "pinned_posts",
  {
    index: bigserial("index", { mode: "number" }).notNull().primaryKey(),
    postId: uuid("post_id").$type<Uuid>().notNull(),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    unique().on(table.postId, table.accountId),
    foreignKey({
      columns: [table.postId, table.accountId],
      foreignColumns: [posts.id, posts.accountId],
    }).onDelete("cascade"),
    index().on(table.accountId, table.postId),
  ],
);

export const pinnedPostRelations = relations(pinnedPosts, ({ one }) => ({
  post: one(posts, {
    fields: [pinnedPosts.postId, pinnedPosts.accountId],
    references: [posts.id, posts.accountId],
  }),
  account: one(accounts, {
    fields: [pinnedPosts.accountId],
    references: [accounts.id],
  }),
}));

export type PinnedPost = typeof pinnedPosts.$inferSelect;
export type NewPinnedPost = typeof pinnedPosts.$inferInsert;

export const likes = pgTable(
  "likes",
  {
    postId: uuid("post_id")
      .$type<Uuid>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.accountId] }),
    index().on(table.accountId, table.postId),
  ],
);

export type Like = typeof likes.$inferSelect;
export type NewLike = typeof likes.$inferInsert;

export const likeRelations = relations(likes, ({ one }) => ({
  post: one(posts, {
    fields: [likes.postId],
    references: [posts.id],
  }),
  account: one(accounts, {
    fields: [likes.accountId],
    references: [accounts.id],
  }),
}));


export const bookmarks = pgTable(
  "bookmarks",
  {
    postId: uuid("post_id")
      .$type<Uuid>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.accountId] }),
    index().on(table.postId, table.accountId),
  ],
);

export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const bookmarkRelations = relations(bookmarks, ({ one }) => ({
  post: one(posts, {
    fields: [bookmarks.postId],
    references: [posts.id],
  }),
  accounts: one(accounts, {
    fields: [bookmarks.accountId],
    references: [accounts.id],
  }),
}));

export const markerTypeEnum = pgEnum("marker_type", ["notifications", "home"]);

export type MarkerType = (typeof markerTypeEnum.enumValues)[number];

export const markers = pgTable(
  "markers",
  {
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: markerTypeEnum("type").notNull(),
    lastReadId: text("last_read_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    updated: timestamp("updated", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.type] })],
);

export type Marker = typeof markers.$inferSelect;
export type NewMarker = typeof markers.$inferInsert;

export const markerRelations = relations(markers, ({ one }) => ({
  account: one(accounts, {
    fields: [markers.accountId],
    references: [accounts.id],
  }),
}));

export const featuredTags = pgTable(
  "featured_tags",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    created: timestamp("created", { withTimezone: true }),
  },
  (table) => [unique().on(table.accountId, table.name)],
);

export type FeaturedTag = typeof featuredTags.$inferSelect;
export type NewFeaturedTag = typeof featuredTags.$inferInsert;

export const featuredTagRelations = relations(featuredTags, ({ one }) => ({
  account: one(accounts, {
    fields: [featuredTags.accountId],
    references: [accounts.id],
  }),
}));

export const listRepliesPolicyEnum = pgEnum("list_replies_policy", [
  "followed",
  "list",
  "none",
]);

export type ListRepliesPolicy =
  (typeof listRepliesPolicyEnum.enumValues)[number];

export const lists = pgTable("lists", {
  id: uuid("id").$type<Uuid>().primaryKey(),
  accountId: uuid("account_id")
    .$type<Uuid>()
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  repliesPolicy: listRepliesPolicyEnum("replies_policy")
    .notNull()
    .default("list"),
  exclusive: boolean("exclusive").notNull().default(false),
  created: timestamp("created", { withTimezone: true })
    .notNull()
    .default(currentTimestamp),
});

export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;

export const listRelations = relations(lists, ({ one, many }) => ({
  account: one(accounts, {
    fields: [lists.accountId],
    references: [accounts.id],
  }),
  members: many(listMembers),
}));

export const listMembers = pgTable(
  "list_members",
  {
    listId: uuid("list_id")
      .$type<Uuid>()
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [primaryKey({ columns: [table.listId, table.accountId] })],
);

export type ListMember = typeof listMembers.$inferSelect;
export type NewListMember = typeof listMembers.$inferInsert;

export const listMemberRelations = relations(listMembers, ({ one }) => ({
  list: one(lists, {
    fields: [listMembers.listId],
    references: [lists.id],
  }),
  account: one(accounts, {
    fields: [listMembers.accountId],
    references: [accounts.id],
  }),
}));

export const mutes = pgTable(
  "mutes",
  {
    id: uuid("id").$type<Uuid>().primaryKey(),
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mutedAccountId: uuid("muted_account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    notifications: boolean("notifications").notNull().default(true),
    duration: interval("duration"),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    unique("mutes_account_id_muted_account_id_unique").on(
      table.accountId,
      table.mutedAccountId,
    ),
  ],
);

export type Mute = typeof mutes.$inferSelect;
export type NewMute = typeof mutes.$inferInsert;

export const muteRelations = relations(mutes, ({ one }) => ({
  account: one(accounts, {
    fields: [mutes.accountId],
    references: [accounts.id],
    relationName: "muter",
  }),
  targetAccount: one(accounts, {
    fields: [mutes.mutedAccountId],
    references: [accounts.id],
    relationName: "muted",
  }),
}));

export const blocks = pgTable(
  "blocks",
  {
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    blockedAccountId: uuid("blocked_account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    created: timestamp("created", { withTimezone: true })
      .notNull()
      .default(currentTimestamp),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.blockedAccountId] }),
    index().on(table.accountId),
    index().on(table.blockedAccountId),
  ],
);

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;

export const blockRelations = relations(blocks, ({ one }) => ({
  account: one(accounts, {
    fields: [blocks.accountId],
    references: [accounts.id],
    relationName: "blocker",
  }),
  blockedAccount: one(accounts, {
    fields: [blocks.blockedAccountId],
    references: [accounts.id],
    relationName: "blocked",
  }),
}));


export const reports = pgTable("reports", {
  id: uuid("id").$type<Uuid>().primaryKey(),
  uri: text("uri").notNull().unique(),
  accountId: uuid("account_id")
    .$type<Uuid>()
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  targetAccountId: uuid("target_account_id")
    .$type<Uuid>()
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  created: timestamp("created", { withTimezone: true })
    .notNull()
    .default(currentTimestamp),
  comment: text("comment").notNull(),
  // No relationship, we're just storing a set of Post IDs in here:
  posts: uuid("posts")
    .array()
    .$type<Uuid[]>()
    .notNull()
    .default(sql`'{}'::uuid[]`),
});

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export const reportRelations = relations(reports, ({ one }) => ({
  account: one(accounts, {
    fields: [reports.accountId],
    references: [accounts.id],
  }),
  targetAccount: one(accounts, {
    fields: [reports.targetAccountId],
    references: [accounts.id],
  }),
}));

export const timelinePosts = pgTable(
  "timeline_posts",
  {
    accountId: uuid("account_id")
      .$type<Uuid>()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .$type<Uuid>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.postId] }),
    index().on(table.accountId, table.postId),
  ],
);

export type TimelinePost = typeof timelinePosts.$inferSelect;
export type NewTimelinePost = typeof timelinePosts.$inferInsert;

export const timelinePostRelations = relations(timelinePosts, ({ one }) => ({
  account: one(accounts, {
    fields: [timelinePosts.accountId],
    references: [accounts.id],
  }),
  post: one(posts, {
    fields: [timelinePosts.postId],
    references: [posts.id],
  }),
}));

export const listPosts = pgTable(
  "list_posts",
  {
    listId: uuid("list_id")
      .$type<Uuid>()
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .$type<Uuid>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.listId, table.postId] }),
    index().on(table.listId, table.postId),
  ],
);

export type ListPost = typeof listPosts.$inferSelect;
export type NewListPost = typeof listPosts.$inferInsert;

export const listPostRelations = relations(listPosts, ({ one }) => ({
  list: one(lists, {
    fields: [listPosts.listId],
    references: [lists.id],
  }),
  post: one(posts, {
    fields: [listPosts.postId],
    references: [posts.id],
  }),
}));

export const scopeEnum = pgEnum("scope", [
  "read",
  "read:accounts",
  "read:blocks",
  "read:bookmarks",
  "read:favourites",
  "read:filters",
  "read:follows",
  "read:lists",
  "read:mutes",
  "read:notifications",
  "read:search",
  "read:statuses",
  "write",
  "write:accounts",
  "write:blocks",
  "write:bookmarks",
  "write:conversations",
  "write:favourites",
  "write:filters",
  "write:follows",
  "write:lists",
  "write:media",
  "write:mutes",
  "write:notifications",
  "write:reports",
  "write:statuses",
  "follow",
  "push",
]);

export type Scope = (typeof scopeEnum.enumValues)[number];

export const applications = pgTable("applications", {
  id: uuid("id").$type<Uuid>().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  scopes: scopeEnum("scopes").array().notNull(),
  website: text("website"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret").notNull(),
  created: timestamp("created")
    .notNull()
    .default(currentTimestamp),
});

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export const applicationRelations = relations(applications, ({ many }) => ({
  accessTokens: many(accessTokens),
}));

export const accessTokens = pgTable("access_tokens", {
  code: text("code").primaryKey(),
  applicationId: uuid("application_id")
    .$type<Uuid>()
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .$type<Uuid>()
    .references(() => users.id, { onDelete: "cascade" }),
  scopes: scopeEnum("scopes").array().notNull(),
  created: timestamp("created", { withTimezone: true })
    .notNull()
    .default(currentTimestamp),
})

export type AccessToken = typeof accessTokens.$inferSelect;
export type NewAccessToken = typeof accessTokens.$inferInsert;

export const accessTokenRelations = relations(accessTokens, ({ one }) => ({
  application: one(applications, {
    fields: [accessTokens.applicationId],
    references: [applications.id],
  }),
  user: one(users, {
    fields: [accessTokens.userId],
    references: [users.id],
  }),
}));
