import { zValidator } from "@hono/zod-validator";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/db";
import { getPostRelations, serializePost } from "../../entities/status";
import {
  TIMELINE_INBOXES,
  TIMELINE_INBOX_LIMIT,
} from "../../federation/timeline";
import { type Variables, scopeRequired, tokenRequired } from "../../middlewares/oauth";
import {
  users,
  blocks,
  follows,
  listMembers,
  listPosts,
  lists,
  mentions,
  mutes,
  posts,
  timelinePosts,
} from "../../db/schema";
import { isUuid, uuid } from "../../utils/uuid";

const app = new Hono<{ Variables: Variables }>();

app.use(tokenRequired);

export const timelineQuerySchema = z.object({
  max_id: uuid.optional(),
  since_id: uuid.optional(),
  min_id: uuid.optional(),
  limit: z
    .string()
    .default("20")
    .transform((v) => Number.parseInt(v)),
});

export const publicTimelineQuerySchema = timelineQuerySchema.merge(
  z.object({
    local: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    remote: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  }),
);

app.get(
  "/public",
  zValidator("query", publicTimelineQuerySchema),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const query = c.req.valid("query");
    const timeline = await db.query.posts.findMany({
      where: and(
        eq(posts.visibility, "public"),
        query.local
          ? inArray(
            posts.accountId,
            db.select({ id: users.id }).from(users),
          )
          : undefined,
        query.remote
          ? notInArray(
            posts.accountId,
            db.select({ id: users.id }).from(users),
          )
          : undefined,
        // Hide the posts from the muted accounts:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: mutes.mutedAccountId })
            .from(mutes)
            .where(
              and(
                eq(mutes.accountId, user.account.id),
                or(
                  isNull(mutes.duration),
                  gt(
                    sql`${mutes.created} + ${mutes.duration}`,
                    sql`CURRENT_TIMESTAMP`,
                  ),
                ),
              ),
            ),
        ),
        // Hide the posts from the blocked accounts:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: blocks.blockedAccountId })
            .from(blocks)
            .where(eq(blocks.accountId, user.account.id)),
        ),
        // Hide the posts from the accounts who blocked the owner:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: blocks.accountId })
            .from(blocks)
            .where(eq(blocks.blockedAccountId, user.account.id)),
        ),
        // Hide the shared posts from the muted accounts:
        or(
          isNull(posts.sharingId),
          notInArray(
            posts.sharingId,
            db
              .select({ id: posts.id })
              .from(posts)
              .innerJoin(mutes, eq(mutes.mutedAccountId, posts.accountId))
              .where(
                and(
                  eq(mutes.accountId, user.account.id),
                  or(
                    isNull(mutes.duration),
                    gt(
                      sql`${mutes.created} + ${mutes.duration}`,
                      sql`CURRENT_TIMESTAMP`,
                    ),
                  ),
                ),
              ),
          ),
        ),
        // Hide the shared posts from the blocked accounts:
        or(
          isNull(posts.sharingId),
          notInArray(
            posts.sharingId,
            db
              .select({ id: posts.id })
              .from(posts)
              .innerJoin(blocks, eq(blocks.blockedAccountId, posts.accountId))
              .where(eq(blocks.accountId, user.account.id)),
          ),
        ),
        // Hide the shared posts from the accounts who blocked the owner:
        or(
          isNull(posts.sharingId),
          notInArray(
            posts.sharingId,
            db
              .select({ id: posts.id })
              .from(posts)
              .innerJoin(blocks, eq(blocks.accountId, posts.accountId))
              .where(eq(blocks.blockedAccountId, user.account.id)),
          ),
        ),
        query.max_id == null ? undefined : lt(posts.id, query.max_id),
        query.min_id == null ? undefined : gt(posts.id, query.min_id),
      ),
      with: getPostRelations(user.account.id),
      orderBy: [desc(posts.id)],
      limit: query.limit,
    });
    const nextMaxId =
      timeline.length >= query.limit ? timeline[timeline.length - 1].id : null;
    const nextLink = nextMaxId == null ? undefined : new URL(c.req.url);
    nextLink?.searchParams.set("max_id", nextMaxId ?? "");
    return c.json(
      timeline.map((p) => serializePost(p, user, c.req.url)),
      200,
      nextLink == null ? undefined : { Link: `<${nextLink.href}>; rel="next"` },
    );
  },
);

app.get(
  "/home",
  scopeRequired(["read:statuses"]),
  zValidator("query", timelineQuerySchema),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const query = c.req.valid("query");
    let timeline: Parameters<typeof serializePost>[0][];
    if (TIMELINE_INBOXES) {
      timeline = await db.query.posts.findMany({
        where: inArray(
          posts.id,
          db
            .select({ id: timelinePosts.postId })
            .from(timelinePosts)
            .where(
              and(
                eq(timelinePosts.accountId, user.account.id),
                query.max_id == null
                  ? undefined
                  : lt(timelinePosts.postId, query.max_id),
                query.min_id == null
                  ? undefined
                  : gt(timelinePosts.postId, query.min_id),
              ),
            )
            .orderBy(desc(timelinePosts.postId))
            .limit(Math.min(TIMELINE_INBOX_LIMIT, query.limit)),
        ),
        with: getPostRelations(user.account.id),
        orderBy: [desc(posts.id)],
        limit: query.limit,
      });
    } else {
      timeline = await db.query.posts.findMany({
        where: and(
          or(
            eq(posts.accountId, user.account.id),
            and(
              ne(posts.visibility, "direct"),
              inArray(
                posts.accountId,
                db
                  .select({ id: follows.followingId })
                  .from(follows)
                  .where(eq(follows.followerId, user.account.id)),
              ),
              notInArray(
                posts.accountId,
                db
                  .select({ id: listMembers.accountId })
                  .from(listMembers)
                  .leftJoin(lists, eq(listMembers.listId, lists.id))
                  .where(eq(lists.exclusive, true)),
              ),
            ),
            and(
              ne(posts.visibility, "private"),
              inArray(
                posts.id,
                db
                  .select({ id: mentions.postId })
                  .from(mentions)
                  .where(eq(mentions.accountId, user.account.id)),
              ),
            ),
          ),
          or(
            isNull(posts.replyTargetId),
            inArray(
              posts.replyTargetId,
              db
                .select({ id: posts.id })
                .from(posts)
                .where(
                  or(
                    eq(posts.accountId, user.account.id),
                    inArray(
                      posts.accountId,
                      db
                        .select({ id: follows.followingId })
                        .from(follows)
                        .where(eq(follows.followerId, user.account.id)),
                    ),
                  ),
                ),
            ),
          ),
          // Hide the posts from the muted accounts:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: mutes.mutedAccountId })
              .from(mutes)
              .where(
                and(
                  eq(mutes.accountId, user.account.id),
                  or(
                    isNull(mutes.duration),
                    gt(
                      sql`${mutes.created} + ${mutes.duration}`,
                      sql`CURRENT_TIMESTAMP`,
                    ),
                  ),
                ),
              ),
          ),
          // Hide the posts from the blocked accounts:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.blockedAccountId })
              .from(blocks)
              .where(eq(blocks.accountId, user.account.id)),
          ),
          // Hide the posts from the accounts who blocked the owner:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.accountId })
              .from(blocks)
              .where(eq(blocks.blockedAccountId, user.account.id)),
          ),
          // Hide the shared posts from the muted accounts:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(mutes, eq(mutes.mutedAccountId, posts.accountId))
                .where(
                  and(
                    eq(mutes.accountId, user.account.id),
                    or(
                      isNull(mutes.duration),
                      gt(
                        sql`${mutes.created} + ${mutes.duration}`,
                        sql`CURRENT_TIMESTAMP`,
                      ),
                    ),
                  ),
                ),
            ),
          ),
          // Hide the shared posts from the blocked accounts:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(blocks, eq(blocks.blockedAccountId, posts.accountId))
                .where(eq(blocks.accountId, user.account.id)),
            ),
          ),
          // Hide the shared posts from the accounts who blocked the owner:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(blocks, eq(blocks.accountId, posts.accountId))
                .where(eq(blocks.blockedAccountId, user.account.id)),
            ),
          ),
          query.max_id == null ? undefined : lt(posts.id, query.max_id),
          query.min_id == null ? undefined : gt(posts.id, query.min_id),
        ),
        with: getPostRelations(user.account.id),
        orderBy: [desc(posts.id)],
        limit: query.limit,
      });
    }
    const nextMaxId =
      timeline.length >= query.limit ? timeline[timeline.length - 1].id : null;
    const nextLink = nextMaxId == null ? undefined : new URL(c.req.url);
    nextLink?.searchParams.set("max_id", nextMaxId ?? "");
    return c.json(
      timeline.map((p) => serializePost(p, user, c.req.url)),
      200,
      nextLink == null ? undefined : { Link: `<${nextLink.href}>; rel="next"` },
    );
  },
);

app.get(
  "/list/:list_id",
  tokenRequired,
  scopeRequired(["read:lists"]),
  zValidator("query", publicTimelineQuerySchema),
  async (c) => {
    const listId = c.req.param("list_id");
    if (!isUuid(listId)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const query = c.req.valid("query");
    const list = await db.query.lists.findFirst({
      where: and(eq(lists.id, listId), eq(lists.accountId, user.account.id)),
    });
    if (list == null) return c.json({ error: "Record not found" }, 404);
    let timeline: Parameters<typeof serializePost>[0][];
    if (TIMELINE_INBOXES) {
      timeline = await db.query.posts.findMany({
        where: inArray(
          posts.id,
          db
            .select({ id: listPosts.postId })
            .from(listPosts)
            .where(
              and(
                eq(listPosts.listId, list.id),
                query.max_id == null
                  ? undefined
                  : lt(listPosts.postId, query.max_id),
                query.min_id == null
                  ? undefined
                  : gt(listPosts.postId, query.min_id),
              ),
            )
            .orderBy(desc(listPosts.postId))
            .limit(Math.min(TIMELINE_INBOX_LIMIT, query.limit)),
        ),
        with: getPostRelations(user.account.id),
        orderBy: [desc(posts.id)],
        limit: query.limit,
      });
    } else {
      timeline = await db.query.posts.findMany({
        where: and(
          ne(posts.visibility, "direct"),
          inArray(
            posts.accountId,
            db
              .select({ id: listMembers.accountId })
              .from(listMembers)
              .where(eq(listMembers.listId, list.id)),
          ),
          or(
            isNull(posts.replyTargetId),
            list.repliesPolicy === "none"
              ? undefined
              : inArray(
                posts.replyTargetId,
                db
                  .select({ id: posts.id })
                  .from(posts)
                  .where(
                    or(
                      eq(posts.accountId, user.account.id),
                      list.repliesPolicy === "followed"
                        ? inArray(
                          posts.accountId,
                          db
                            .select({ id: follows.followingId })
                            .from(follows)
                            .where(eq(follows.followerId, user.account.id)),
                        )
                        : inArray(
                          posts.accountId,
                          db
                            .select({ id: listMembers.accountId })
                            .from(listMembers)
                            .where(eq(listMembers.listId, list.id)),
                        ),
                    ),
                  ),
              ),
          ),
          // Hide the posts from the muted accounts:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: mutes.mutedAccountId })
              .from(mutes)
              .where(
                and(
                  eq(mutes.accountId, user.account.id),
                  or(
                    isNull(mutes.duration),
                    gt(
                      sql`${mutes.created} + ${mutes.duration}`,
                      sql`CURRENT_TIMESTAMP`,
                    ),
                  ),
                ),
              ),
          ),
          // Hide the posts from the blocked accounts:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.blockedAccountId })
              .from(blocks)
              .where(eq(blocks.accountId, user.account.id)),
          ),
          // Hide the posts from the accounts who blocked the owner:
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.accountId })
              .from(blocks)
              .where(eq(blocks.blockedAccountId, user.account.id)),
          ),
          // Hide the shared posts from the muted accounts:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(mutes, eq(mutes.mutedAccountId, posts.accountId))
                .where(
                  and(
                    eq(mutes.accountId, user.account.id),
                    or(
                      isNull(mutes.duration),
                      gt(
                        sql`${mutes.created} + ${mutes.duration}`,
                        sql`CURRENT_TIMESTAMP`,
                      ),
                    ),
                  ),
                ),
            ),
          ),
          // Hide the shared posts from the blocked accounts:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(blocks, eq(blocks.blockedAccountId, posts.accountId))
                .where(eq(blocks.accountId, user.account.id)),
            ),
          ),
          // Hide the shared posts from the accounts who blocked the owner:
          or(
            isNull(posts.sharingId),
            notInArray(
              posts.sharingId,
              db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(blocks, eq(blocks.accountId, posts.accountId))
                .where(eq(blocks.blockedAccountId, user.account.id)),
            ),
          ),
          query.max_id == null ? undefined : lt(posts.id, query.max_id),
          query.min_id == null ? undefined : gt(posts.id, query.min_id),
        ),
        with: getPostRelations(user.account.id),
        orderBy: [desc(posts.id)],
        limit: query.limit,
      });
    }
    const nextMaxId =
      timeline.length >= query.limit ? timeline[timeline.length - 1].id : null;
    const nextLink = nextMaxId == null ? undefined : new URL(c.req.url);
    nextLink?.searchParams.set("max_id", nextMaxId ?? "");
    return c.json(
      timeline.map((p) => serializePost(p, user, c.req.url)),
      200,
      nextLink == null ? undefined : { Link: `<${nextLink.href}>; rel="next"` },
    );
  },
);

app.get(
  "/tag/:hashtag",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  zValidator("query", publicTimelineQuerySchema),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const query = c.req.valid("query");
    const hashtag = `#${c.req.param("hashtag")}`;
    const timeline = await db.query.posts.findMany({
      where: and(
        or(
          eq(posts.accountId, user.account.id),
          and(
            ne(posts.visibility, "direct"),
            inArray(
              posts.accountId,
              db
                .select({ id: follows.followingId })
                .from(follows)
                .where(eq(follows.followerId, user.account.id)),
            ),
          ),
          and(
            ne(posts.visibility, "private"),
            inArray(
              posts.id,
              db
                .select({ id: mentions.postId })
                .from(mentions)
                .where(eq(mentions.accountId, user.account.id)),
            ),
          ),
        ),
        sql`${posts.tags} ? ${hashtag.toLowerCase()}`,
        // TODO seperate local and remote posts based on query.local
        // Hide the posts from the muted accounts:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: mutes.mutedAccountId })
            .from(mutes)
            .where(
              and(
                eq(mutes.accountId, user.account.id),
                or(
                  isNull(mutes.duration),
                  gt(
                    sql`${mutes.created} + ${mutes.duration}`,
                    sql`CURRENT_TIMESTAMP`,
                  ),
                ),
              ),
            ),
        ),
        // Hide the posts from the blocked accounts:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: blocks.blockedAccountId })
            .from(blocks)
            .where(eq(blocks.accountId, user.account.id)),
        ),
        // Hide the posts from the accounts who blocked the owner:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: blocks.accountId })
            .from(blocks)
            .where(eq(blocks.blockedAccountId, user.account.id)),
        ),
        query.max_id == null ? undefined : lt(posts.id, query.max_id),
        query.min_id == null ? undefined : gt(posts.id, query.min_id),
      ),
      with: getPostRelations(user.account.id),
      orderBy: [desc(posts.id)],
      limit: query.limit,
    });
    const nextMaxId =
      timeline.length >= query.limit ? timeline[timeline.length - 1].id : null;
    const nextLink = nextMaxId == null ? undefined : new URL(c.req.url);
    nextLink?.searchParams.set("max_id", nextMaxId ?? "");
    return c.json(
      timeline.map((p) => serializePost(p, user, c.req.url)),
      200,
      nextLink == null ? undefined : { Link: `<${nextLink.href}>; rel="next"` },
    );
  },
);

export default app;
