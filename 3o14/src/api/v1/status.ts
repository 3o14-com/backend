import {
  Add,
  Note,
  Remove,
  Undo,
} from "@fedify/fedify";
import * as vocab from "@fedify/fedify/vocab";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  eq,
  gt,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/db";
import {
  serializeAccount,
  serializeUser,
} from "../../entities/accounts";
import { getPostRelations, serializePost } from "../../entities/status";
import federation from "../../federation";
import { updateAccountStats } from "../../federation/account";
import {
  getRecipients,
  toAnnounce,
  toCreate,
  toDelete,
  toUpdate,
} from "../../federation/post";
import { appendPostToTimelines } from "../../federation/timeline";
import { type Variables, scopeRequired, tokenRequired } from "../../middlewares/oauth";
import {
  type Like,
  type Mention,
  type NewBookmark,
  type NewLike,
  type NewPinnedPost,
  type NewPollOption,
  type NewPost,
  type Poll,
  blocks,
  bookmarks,
  likes,
  media,
  mentions,
  mutes,
  pinnedPosts,
  pollOptions,
  polls,
  posts,
} from "../../db/schema";
import { isUuid, uuid, uuidv7 } from "../../utils/uuid";

const app = new Hono<{ Variables: Variables }>();

const statusSchema = z.object({
  status: z.string().min(1).optional(),
  media_ids: z.array(uuid).optional(),
  poll: z
    .object({
      options: z.array(z.string()),
      expires_in: z.union([
        z.number().int(),
        z
          .string()
          .regex(/^\d+$/)
          .transform((v) => Number.parseInt(v)),
      ]),
      multiple: z.boolean().default(false),
      hide_totals: z.boolean().default(false),
    })
    .optional(),
  sensitive: z.boolean().default(false),
});

app.post(
  "/",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  zValidator(
    "json",
    statusSchema.merge(
      z.object({
        in_reply_to_id: uuid.optional(),
        quote_id: uuid.optional(),
        visibility: z
          .enum(["public", "unlisted", "private", "direct"])
          .optional(),
        scheduled_at: z.string().datetime().optional(),
      }),
    ),
  ),

  async (c) => {
    const token = c.get("token");
    const user = token.user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey != null) {
      const post = await db.query.posts.findFirst({
        where: and(
          eq(posts.accountId, user.account.id),
          eq(posts.idempotenceKey, idempotencyKey),
          gt(posts.published, sql`CURRENT_TIMESTAMP - INTERVAL '1 hour'`),
        ),
        with: getPostRelations(user.account.id),
      });
      if (post != null) return c.json(serializePost(post, user, c.req.url));
    }
    const fedCtx = federation.createContext(c.req.raw, undefined);
    const data = c.req.valid("json");
    const handle = user.username;
    const id = uuidv7();
    const url = fedCtx.getObjectUri(Note, { username: handle, id });
    // TODO
    // data.status == null
    //   ? null
    //   : await formatPostContent(db, data.status, data.language, fmtOpts);
    // const mentionedIds = content?.mentions ?? [];
    // const hashtags = content?.hashtags ?? [];
    // const tags = Object.fromEntries(
    //   hashtags.map((tag) => [
    //     tag.toLowerCase(),
    //     new URL(`/tags/${encodeURIComponent(tag.substring(1))}`, c.req.url)
    //       .href,
    //   ]),
    // );
    await db.transaction(async (tx) => {
      let poll: Poll | null = null;
      if (data.poll != null) {
        const expires = new Date(
          new Date().getTime() + data.poll.expires_in * 1000,
        );
        [poll] = await tx
          .insert(polls)
          .values({
            id: uuidv7(),
            multiple: data.poll.multiple,
            expires,
          })
          .returning();
        await tx.insert(pollOptions).values(
          data.poll.options.map(
            (title, index) =>
              ({
                pollId: poll!.id,
                index,
                title,
              }) satisfies NewPollOption,
          ),
        );
      }

      const insertedRows = await tx
        .insert(posts)
        .values({
          id,
          uri: url.href,
          type: poll == null ? "Note" : "Question",
          accountId: user.account.id,
          applicationId: token.applicationId,
          replyTargetId: data.in_reply_to_id,
          sharingId: null,
          visibility: data.visibility ?? user.visibility,
          content: data.status,
          pollId: poll == null ? null : poll.id,
          tags: {},
          sensitive: data.sensitive,
          url: url.href,
          idempotenceKey: idempotencyKey,
          published: sql`CURRENT_TIMESTAMP`,
        })
        .returning();
      if (data.media_ids != null && data.media_ids.length > 0) {
        for (const mediaId of data.media_ids) {
          const result = await tx
            .update(media)
            .set({ postId: id })
            .where(and(eq(media.id, mediaId), isNull(media.postId)))
            .returning();
          if (result.length < 1) {
            tx.rollback();
            return c.json({ error: "Media not found" }, 422);
          }
        }
      }
      // TODO mentions
      let mentionObjects: Mention[] = [];
      await updateAccountStats(tx, user.account);
      await appendPostToTimelines(tx, {
        ...insertedRows[0],
        sharing: null,
        mentions: mentionObjects,
        replyTarget:
          insertedRows[0].replyTargetId == null
            ? null
            : ((await db.query.posts.findFirst({
              where: eq(posts.id, insertedRows[0].replyTargetId),
            })) ?? null),
      });
    });
    const post = (await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: getPostRelations(user.account.id),
    }))!;
    const activity = toCreate(post, fedCtx);
    await fedCtx.sendActivity({ username: user.username }, getRecipients(post), activity, {
      excludeBaseUris: [new URL(c.req.url)],
    });
    if (post.visibility !== "direct") {
      await fedCtx.sendActivity({ username: handle }, "followers", activity, {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      });
    }
    return c.json(serializePost(post, user, c.req.url));
  },
);

app.put(
  "/:id",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  zValidator("json", statusSchema),
  async (c) => {
    const token = c.get("token");
    const user = token.user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const data = c.req.valid("json");
    const fedCtx = federation.createContext(c.req.raw, undefined);
    // const content =
    //   data.status == null
    //     ? null
    //     : await formatPostContent(db, data.status, data.language, fmtOpts);
    // const summary =
    //   data.spoiler_text == null || data.spoiler_text.trim() === ""
    //     ? null
    //     : data.spoiler_text;
    await db.transaction(async (tx) => {
      const result = await tx
        .update(posts)
        .set({
          content: data.status,
          sensitive: data.sensitive,
          tags: {},
          updated: new Date(),
        })
        .where(eq(posts.id, id))
        .returning();
      if (result.length < 1) return c.json({ error: "Record not found" }, 404);
      await tx.delete(mentions).where(eq(mentions.postId, id));
    });
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: getPostRelations(user.account.id),
    });
    const activity = toUpdate(post!, fedCtx);
    await fedCtx.sendActivity(
      { username: user.username },
      getRecipients(post!), activity, {
      excludeBaseUris: [new URL(c.req.url)],
    });
    await fedCtx.sendActivity({ username: user.username }, "followers", activity, {
      preferSharedInbox: true,
      excludeBaseUris: [new URL(c.req.url)],
    });
    return c.json(serializePost(post!, user, c.req.url));
  },
);

app.get("/:id", tokenRequired, scopeRequired(["read:statuses"]), async (c) => {
  const user = c.get("token").user;
  if (user == null) {
    return c.json({ error: "This method requires an authenticated user" }, 422);
  }
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, id),
    with: getPostRelations(user.account.id),
  });
  if (post == null) return c.json({ error: "Record not found" }, 404);
  return c.json(serializePost(post, user, c.req.url));
});

app.delete(
  "/:id",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: getPostRelations(user.account.id),
    });
    if (post == null) return c.json({ error: "Record not found" }, 404);
    await db.transaction(async (tx) => {
      await tx.delete(posts).where(eq(posts.id, id));
      await updateAccountStats(tx, user);
    });
    const fedCtx = federation.createContext(c.req.raw, undefined);
    const activity = toDelete(post, fedCtx);
    await fedCtx.sendActivity(
      { username: user.username },
      getRecipients(post),
      activity,
      {
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    if (post.visibility !== "direct") {
      await fedCtx.sendActivity(
        { username: user.username },
        "followers",
        activity,
        {
          preferSharedInbox: true,
          excludeBaseUris: [new URL(c.req.url)],
        },
      );
    }
    return c.json({
      ...serializePost(post, user, c.req.url),
      text: post.content ?? "",
      spoiler_text: post.summary ?? "",
    });
  },
);

app.get(
  "/:id/source",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
    });
    if (post == null) return c.json({ error: "Record not found" }, 404);
    return c.json({
      id: post.id,
      text: post.content ?? "",
      spoiler_text: post.summary ?? "",
    });
  },
);

app.get(
  "/:id/context",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: getPostRelations(user.account.id),
    });
    if (post == null) return c.json({ error: "Record not found" }, 404);
    const ancestors: (typeof post)[] = [];
    let p: typeof post | undefined = post;
    while (p.replyTargetId != null) {
      p = await db.query.posts.findFirst({
        where: and(
          eq(posts.id, p.replyTargetId),
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
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.blockedAccountId })
              .from(blocks)
              .where(eq(blocks.accountId, user.account.id)),
          ),
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.accountId })
              .from(blocks)
              .where(eq(blocks.blockedAccountId, user.account.id)),
          ),
        ),
        with: getPostRelations(user.account.id),
      });
      if (p == null) break;
      ancestors.unshift(p);
    }
    const descendants: (typeof post)[] = [];
    const ps: (typeof post)[] = [post];
    while (true) {
      const p = ps.shift();
      if (p == null) break;
      const replies = await db.query.posts.findMany({
        where: and(
          eq(posts.replyTargetId, p.id),
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
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.blockedAccountId })
              .from(blocks)
              .where(eq(blocks.accountId, user.account.id)),
          ),
          notInArray(
            posts.accountId,
            db
              .select({ accountId: blocks.accountId })
              .from(blocks)
              .where(eq(blocks.blockedAccountId, user.account.id)),
          ),
        ),
        with: getPostRelations(user.account.id),
      });
      descendants.push(...replies);
      ps.push(...replies);
    }
    return c.json({
      ancestors: ancestors.map((p) => serializePost(p, user, c.req.url)),
      descendants: descendants.map((p) => serializePost(p, user, c.req.url)),
    });
  },
);

app.post(
  "/:id/favourite",
  tokenRequired,
  scopeRequired(["write:favourites"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    let like: Like;
    try {
      const result = await db
        .insert(likes)
        .values({
          postId,
          accountId: user.account.id,
        } as NewLike)
        .returning();
      like = result[0];
    } catch (_) {
      return c.json({ error: "Record not found" }, 404);
    }
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    if (post == null) {
      return c.json({ error: "Record not found" }, 404);
    }
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await fedCtx.sendActivity(
      { username: user.username },
      {
        id: new URL(post.account.uri),
        inboxId: new URL(post.account.inboxUrl),
      },
      new vocab.Like({
        id: new URL(`#likes/${like.created.toISOString()}`, user.account.uri),
        actor: new URL(user.account.uri),
        object: new URL(post.uri),
      }),
      {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    return c.json(serializePost(post, user, c.req.url));
  },
);

app.post(
  "/:id/unfavourite",
  tokenRequired,
  scopeRequired(["write:favourites"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    const result = await db
      .delete(likes)
      .where(and(eq(likes.postId, postId), eq(likes.accountId, user.account.id)))
      .returning();
    if (result.length < 1) return c.json({ error: "Record not found" }, 404);
    const like = result[0];
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    if (post == null) {
      return c.json({ error: "Record not found" }, 404);
    }
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await fedCtx.sendActivity(
      { username: user.username },
      {
        id: new URL(post.account.uri),
        inboxId: new URL(post.account.inboxUrl),
      },
      new vocab.Undo({
        actor: new URL(user.account.uri),
        object: new vocab.Like({
          id: new URL(
            `#likes/${like.created.toISOString()}`,
            user.account.uri,
          ),
          actor: new URL(user.account.uri),
          object: new URL(post.uri),
        }),
      }),
      {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    return c.json(serializePost(post, user, c.req.url));
  },
);

app.get(
  "/:id/favourited_by",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const likeList = await db.query.likes.findMany({
      where: eq(likes.postId, id),
      with: { account: { with: { user: true, successor: true } } },
    });
    return c.json(
      likeList.map((l) =>
        l.account.user == null
          ? serializeAccount(l.account, c.req.url)
          : serializeUser(
            { ...l.account.user, account: l.account },
            c.req.url,
          ),
      ),
    );
  },
);

const reblogSchema = z.object({
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
});

app.post(
  "/:id/reblog",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  async (c) => {
    const token = c.get("token");
    const user = token.user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const originalPostId = c.req.param("id");
    if (!isUuid(originalPostId)) {
      return c.json({ error: "Record not found" }, 404);
    }
    const contentType = c.req.header("Content-Type");
    let data: z.infer<typeof reblogSchema>;
    if (contentType?.match(/^application\/json(\s*;|$)/)) {
      data = reblogSchema.parse(await c.req.json());
    } else if (contentType === "application/x-www-form-urlencoded") {
      data = reblogSchema.parse(await c.req.formData());
    } else if (contentType == null) {
      data = { visibility: "public" };
    } else {
      return c.json({ error: "Unsupported Media Type" }, 415);
    }
    const visibility = data.visibility;
    const originalPost = await db.query.posts.findFirst({
      where: eq(posts.id, originalPostId),
      with: { account: true, mentions: true },
    });
    if (
      originalPost == null ||
      originalPost.visibility === "private" ||
      originalPost.visibility === "direct"
    ) {
      return c.json({ error: "Record not found" }, 404);
    }
    const fedCtx = federation.createContext(c.req.raw, undefined);
    const id = uuidv7();
    const url = fedCtx.getObjectUri(Note, { username: user.username, id });
    const published = new Date();
    await db.transaction(async (tx) => {
      const insertedRows = await tx
        .insert(posts)
        .values({
          ...originalPost,
          id,
          uri: url.href,
          accountId: user.account.id,
          applicationId: token.applicationId,
          replyTargetId: null,
          sharingId: originalPostId,
          visibility,
          url: url.href,
          published,
          updated: published,
        } satisfies NewPost)
        .returning();
      await tx
        .update(posts)
        .set({ sharesCount: sql`coalesce(${posts.sharesCount}, 0) + 1` })
        .where(eq(posts.id, originalPostId));
      await appendPostToTimelines(tx, {
        ...insertedRows[0],
        sharing: originalPost,
        mentions: [],
        replyTarget: null,
      });
    });
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: getPostRelations(user.account.id),
    });
    await fedCtx.sendActivity(
      { username: user.username },
      "followers",
      toAnnounce(post!, fedCtx),
      {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    return c.json(serializePost(post!, user, c.req.url));
  },
);

app.post(
  "/:id/unreblog",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const originalPostId = c.req.param("id");
    if (!isUuid(originalPostId)) {
      return c.json({ error: "Record not found" }, 404);
    }
    const postList = await db.query.posts.findMany({
      where: and(
        eq(posts.accountId, user.account.id),
        eq(posts.sharingId, originalPostId),
      ),
      with: {
        account: true,
        sharing: {
          with: { account: true },
        },
      },
    });
    if (postList.length < 1) return c.json({ error: "Record not found" }, 404);
    await db
      .delete(posts)
      .where(
        and(eq(posts.accountId, user.account.id), eq(posts.sharingId, originalPostId)),
      );
    await db
      .update(posts)
      .set({
        sharesCount: sql`coalesce(${posts.sharesCount} - ${postList.length}, 0)`,
      })
      .where(eq(posts.id, originalPostId));
    const fedCtx = federation.createContext(c.req.raw, undefined);
    for (const post of postList) {
      await fedCtx.sendActivity(
        { username: user.username },
        "followers",
        new Undo({
          actor: new URL(user.account.uri),
          object: toAnnounce(post, fedCtx),
        }),
        {
          preferSharedInbox: true,
          excludeBaseUris: [new URL(c.req.url)],
        },
      );
    }
    const originalPost = await db.query.posts.findFirst({
      where: eq(posts.id, originalPostId),
      with: getPostRelations(user.account.id),
    });
    return c.json(serializePost(originalPost!, user, c.req.url));
  },
);

app.get(
  "/:id/reblogged_by",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const post = await db.query.posts.findFirst({
      with: {
        shares: {
          with: {
            account: {
              with: {
                user: true,
                successor: true,
              },
            },
          },
        },
      },
      where: eq(posts.id, id),
    });
    if (post == null) return c.json({ error: "Record not found" }, 404);
    return c.json(
      post.shares.map((s) =>
        s.account.user == null
          ? serializeAccount(s.account, c.req.url)
          : serializeUser(
            { ...s.account.user, account: s.account },
            c.req.url,
          ),
      ),
    );
  },
);

app.post(
  "/:id/bookmark",
  tokenRequired,
  scopeRequired(["write:bookmarks"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    try {
      await db.insert(bookmarks).values({
        postId,
        accountId: user.account.id,
      } satisfies NewBookmark);
    } catch (_) {
      return c.json({ error: "Record not found" }, 404);
    }
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    return c.json(serializePost(post!, user, c.req.url));
  },
);

app.post(
  "/:id/unbookmark",
  tokenRequired,
  scopeRequired(["write:bookmarks"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    const result = await db
      .delete(bookmarks)
      .where(
        and(
          eq(bookmarks.postId, postId),
          eq(bookmarks.accountId, user.account.id),
        ),
      )
      .returning();
    if (result.length < 1) {
      return c.json({ error: "Record not found" }, 404);
    }
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    return c.json(serializePost(post!, user, c.req.url));
  },
);

app.post(
  "/:id/pin",
  tokenRequired,
  scopeRequired(["write:accounts"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });
    if (post == null) {
      return c.json({ error: "Record not found" }, 404);
    }
    if (post.accountId !== user.account.id) {
      return c.json(
        { error: "Validation failed: Someone else's post cannot be pinned" },
        422,
      );
    }
    const result = await db
      .insert(pinnedPosts)
      .values({
        postId,
        accountId: user.account.id,
      } satisfies NewPinnedPost)
      .returning();
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await fedCtx.sendActivity(
      user,
      "followers",
      new Add({
        id: new URL(
          `#add/${result[0].index}`,
          fedCtx.getFeaturedUri(user.username),
        ),
        actor: new URL(user.account.uri),
        object: new URL(post.uri),
        target: fedCtx.getFeaturedUri(user.username),
      }),
      {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    const resultPost = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    return c.json(serializePost(resultPost!, user, c.req.url));
  },
);

app.post(
  "/:id/unpin",
  tokenRequired,
  scopeRequired(["write:accounts"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const postId = c.req.param("id");
    if (!isUuid(postId)) return c.json({ error: "Record not found" }, 404);
    const result = await db
      .delete(pinnedPosts)
      .where(
        and(
          eq(pinnedPosts.postId, postId),
          eq(pinnedPosts.accountId, user.account.id),
        ),
      )
      .returning();
    if (result.length < 1) {
      return c.json({ error: "Record not found" }, 404);
    }
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: getPostRelations(user.account.id),
    });
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await fedCtx.sendActivity(
      user,
      "followers",
      new Remove({
        id: new URL(
          `#remove/${result[0].index}`,
          fedCtx.getFeaturedUri(user.username),
        ),
        actor: new URL(user.account.uri),
        object: new URL(post!.uri),
        target: fedCtx.getFeaturedUri(user.username),
      }),
      {
        preferSharedInbox: true,
        excludeBaseUris: [new URL(c.req.url)],
      },
    );
    return c.json(serializePost(post!, user, c.req.url));
  },
);


export default app;
