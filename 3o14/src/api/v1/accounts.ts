import { Block, isActor, lookupObject, Undo } from "@fedify/fedify";
import * as vocab from "@fedify/fedify/vocab";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import mime from "mime";
import { z } from "zod";
import { db } from "../../db/db";
import {
  serializeAccount,
  serializeRelationship,
  serializeUser,
} from "../../entities/accounts";
import { serializeList } from "../../entities/list";
import { getPostRelations, serializePost } from "../../entities/status";
import { federation } from "../../federation";
import {
  blockAccount,
  followAccount,
  persistAccount,
  persistAccountPosts,
  REMOTE_ACTOR_FETCH_POSTS,
  unfollowAccount,
} from "../../federation/account";
import {
  scopeRequired,
  tokenRequired,
  type Variables,
} from "../../middlewares/oauth";
import {
  type Account,
  accounts,
  blocks,
  follows,
  listMembers,
  lists,
  media,
  mentions,
  mutes,
  type NewMute,
  pinnedPosts,
  posts,
  type User,
  users,
} from "../../db/schema";
import { disk, getAssetUrl } from "../../utils/storage";
import { isUuid, type Uuid, uuid } from "../../utils/uuid";
import { timelineQuerySchema } from "./timelines";

const app = new Hono<{ Variables: Variables }>();
const allowedImageMimeTypes = ["image/gif", "image/jpeg", "image/png"];

app.get(
  "/verify_credentials",
  tokenRequired,
  scopeRequired(["read:accounts"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    return c.json(serializeUser(user, c.req.url));
  },
);

app.patch(
  "/update_credentials",
  tokenRequired,
  scopeRequired(["write:accounts"]),
  zValidator(
    "form",
    z.object({
      display_name: z.string().optional(),
      note: z.string().optional(),
      avatar: z.any().optional(),
      header: z.any().optional(),
      locked: z.enum(["true", "false"]).optional(),
      discoverable: z.enum(["true", "false"]).optional(),
      hide_collections: z.enum(["true", "false"]).optional(),
      indexable: z.enum(["true", "false"]).optional(),
      "source[privacy]": z.enum(["public", "unlisted", "private"]).optional(),
      "source[sensitive]": z.enum(["true", "false"]).optional(),
    }),
  ),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const account = user.account;
    const form = c.req.valid("form");
    let avatarurl = undefined;
    if (form.avatar instanceof File) {
      if (!allowedImageMimeTypes.includes(form.avatar.type)) {
        return c.json({ error: "Invalid avatar file type." }, 400);
      }
      const extension = mime.getExtension(form.avatar.type);
      if (!extension) {
        return c.json({ error: "Unsupported media type" }, 400);
      }
      const sanitizedExt = extension.replace(/[/\\]/g, "");
      const path = `avatars/${account.id}.${sanitizedExt}`;
      const content = await form.avatar.arrayBuffer();
      await disk.put(path, new Uint8Array(content), {
        contentType: form.avatar.type,
        contentLength: content.byteLength,
        visibility: "public",
      });
      avatarurl = getAssetUrl(`${path}?${Date.now()}`, c.req.url);
    }
    let coverurl = undefined;
    if (form.header instanceof File) {
      if (!allowedImageMimeTypes.includes(form.header.type)) {
        return c.json({ error: "Invalid header file type." }, 400);
      }
      const extension = mime.getExtension(form.header.type);
      if (!extension) {
        return c.json({ error: "Unsupported media type" }, 400);
      }
      const sanitizedExt = extension.replace(/[/\\]/g, "");
      const path = `covers/${account.id}.${sanitizedExt}`;
      const content = await form.header.arrayBuffer();
      try {
        await disk.put(path, new Uint8Array(content), {
          contentType: form.header.type,
          contentLength: content.byteLength,
          visibility: "public",
        });
      } catch (error) {
        return c.json({ error: "Failed to upload header image." }, 500);
      }
      coverurl = getAssetUrl(`${path}?${Date.now()}`, c.req.url);
    }
    const fedCtx = federation.createContext(c.req.raw, undefined);
    const name = form.display_name ?? account.name;
    const updatedAccounts = await db
      .update(accounts)
      .set({
        name,
        avatarurl,
        coverurl,
        protected: form.locked == null
          ? account.protected
          : form.locked === "true",
        sensitive: form["source[sensitive]"] == null
          ? account.sensitive
          : form["source[sensitive]"] === "true",
      })
      .where(eq(accounts.id, user.id))
      .returning();
    const updatedUsers = await db
      .update(users)
      .set({
        visibility: form["source[privacy]"] ?? user.visibility,
      })
      .where(eq(users.id, user.id))
      .returning();
    await fedCtx.sendActivity(
      { handle: updatedUsers[0].username },
      "followers",
      new vocab.Update({
        actor: fedCtx.getActorUri(updatedUsers[0].username),
        object: await fedCtx.getActor(updatedUsers[0].username),
      }),
      { preferSharedInbox: true, excludeBaseUris: [new URL(fedCtx.url)] },
    );
    const successor = updatedAccounts[0].successorId == null
      ? null
      : ((await db.query.accounts.findFirst({
        where: eq(accounts.id, updatedAccounts[0].successorId),
      })) ?? null);
    return c.json(
      serializeUser(
        {
          ...updatedUsers[0],
          account: { ...updatedAccounts[0], successor },
        },
        c.req.url,
      ),
    );
  },
);

app.get(
  "/relationships",
  tokenRequired,
  scopeRequired(["read:follows"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const ids = (c.req.queries("id[]") ?? []).filter(isUuid);
    const accountList = ids.length > 0
      ? await db.query.accounts.findMany({
        where: inArray(accounts.id, ids),
        with: {
          following: {
            where: eq(follows.followingId, user.id),
          },
          followers: {
            where: eq(follows.followerId, user.id),
          },
          mutedBy: {
            where: eq(mutes.accountId, user.id),
          },
          blocks: {
            where: eq(blocks.blockedAccountId, user.id),
          },
          blockedBy: {
            where: eq(blocks.accountId, user.id),
          },
        },
      })
      : [];
    accountList.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return c.json(
      accountList.map((account) => serializeRelationship(account, user)),
    );
  },
);

app.get(
  "/lookup",
  zValidator(
    "query",
    z.object({
      acct: z.string(),
      skip_webfinger: z.enum(["true", "false"]).default("true"),
    }),
  ),
  async (c) => {
    const user = c.get("token")?.user;
    const query = c.req.valid("query");
    const acct = query.acct;
    let account:
      | (Account & {
        user: User | null;
        successor: Account | null;
      })
      | null = (await db.query.accounts.findFirst({
        where: eq(
          accounts.handle,
          acct.includes("@")
            ? `@${acct}`
            : `@${acct}@${new URL(c.req.url).host}`,
        ),
        with: { user: true, successor: true },
      })) ?? null;
    if (account == null) {
      if (query.skip_webfinger !== "false") {
        return c.json({ error: "Record not found" }, 404);
      }
      const fedCtx = federation.createContext(c.req.raw, undefined);
      const options = user == null ? fedCtx : {
        contextLoader: fedCtx.contextLoader,
        documentLoader: await fedCtx.getDocumentLoader({
          username: user.username,
        }),
      };
      const actor = await lookupObject(acct, options);
      if (!isActor(actor)) return c.json({ error: "Record not found" }, 404);
      const loaded = await persistAccount(db, actor, c.req.url, options);
      if (loaded != null) {
        account = {
          ...loaded,
          user: null,
          successor: (await db.query.accounts.findFirst({
            where: eq(accounts.successorId, loaded.id),
          })) ?? null,
        };
      }
    }
    if (account == null) {
      return c.json({ error: "Record not found" }, 404);
    }
    if (account.user == null) {
      return c.json(serializeAccount(account, c.req.url));
    }
    return c.json(
      serializeUser({ ...account.user, account }, c.req.url),
    );
  },
);

const HANDLE_PATTERN =
  /^@?[\p{L}\p{N}._-]+@(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+[\p{L}\p{N}]{2,}$/giu;

app.get(
  "/search",
  tokenRequired,
  scopeRequired(["read:accounts"]),
  zValidator(
    "query",
    z.object({
      q: z.string().min(1),
      limit: z
        .string()
        .default("40")
        .transform((v) => Number.parseInt(v)),
      offset: z
        .string()
        .default("0")
        .transform((v) => Number.parseInt(v)),
      resolve: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
      following: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query");
    if (query.resolve && HANDLE_PATTERN.test(query.q) && query.offset < 1) {
      const exactMatch = await db.query.accounts.findFirst({
        where: ilike(accounts.handle, `@${query.q.replace(/^@/, "")}`),
      });
      if (exactMatch != null) {
        const fedCtx = federation.createContext(c.req.raw, undefined);
        const options = {
          contextLoader: fedCtx.contextLoader,
          documentLoader: await fedCtx.getDocumentLoader({
            username: exactMatch.handle,
          }),
        };
        const actor = await lookupObject(query.q, options);
        if (isActor(actor)) await persistAccount(db, actor, c.req.url, options);
      }
    }
    const accountList = await db.query.accounts.findMany({
      where: or(
        ilike(accounts.handle, `%${query.q}%`),
        ilike(accounts.name, `%${query.q}%`),
      ),
      with: { user: true, successor: true },
      orderBy: [
        desc(ilike(accounts.handle, `@${query.q.replace(/^@/, "")}`)),
        desc(ilike(accounts.name, query.q)),
        desc(ilike(accounts.handle, `@${query.q.replace(/^@/, "")}%`)),
        desc(ilike(accounts.name, `${query.q}%`)),
      ],
      offset: query.offset,
      limit: query.limit,
    });
    return c.json(
      accountList.map((a) =>
        a.user == null
          ? serializeAccount(a, c.req.url)
          : serializeUser({ ...a.user, account: a }, c.req.url)
      ),
    );
  },
);

app.get(
  "/familiar_followers",
  tokenRequired,
  scopeRequired(["read:follows"]),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const ids: Uuid[] = (c.req.queries("id[]") ?? []).filter(isUuid);
    const result: {
      id: string;
      accounts: ReturnType<typeof serializeAccount>[];
    }[] = [];
    for (const id of ids) {
      const accountList = await db.query.accounts.findMany({
        where: and(
          inArray(
            accounts.id,
            db
              .select({ id: follows.followerId })
              .from(follows)
              .where(eq(follows.followingId, id)),
          ),
          inArray(
            accounts.id,
            db
              .select({ id: follows.followingId })
              .from(follows)
              .where(eq(follows.followerId, user.account.id)),
          ),
        ),
        with: { user: true, successor: true },
      });
      result.push({
        id,
        accounts: accountList.map((a) =>
          a.user == null
            ? serializeAccount(a, c.req.url)
            : serializeUser({ ...a.user, account: a }, c.req.url)
        ),
      });
    }
    return c.json(result);
  },
);

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, id),
    with: { user: true, successor: true },
  });
  if (account == null) return c.json({ error: "Record not found" }, 404);
  if (account.user != null) {
    return c.json(
      serializeUser({ ...account.user, account }, c.req.url),
    );
  }
  return c.json(serializeAccount(account, c.req.url));
});

app.get(
  "/:id/statuses",
  tokenRequired,
  scopeRequired(["read:statuses"]),
  zValidator(
    "query",
    timelineQuerySchema.merge(
      z.object({
        only_media: z.enum(["true", "false"]).optional(),
        exclude_replies: z.enum(["true", "false"]).optional(),
        exclude_reblogs: z.enum(["true", "false"]).optional(),
        pinned: z.enum(["true", "false"]).optional(),
        tagged: z.string().optional(),
      }),
    ),
  ),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const tokenUser = c.get("token").user;
    if (tokenUser == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        user: true,
        blocks: {
          where: eq(blocks.blockedAccountId, tokenUser.account.id),
        },
      },
    });
    if (account == null) return c.json({ error: "Record not found" }, 404);
    if (
      account.blocks.some((b) => b.blockedAccountId === tokenUser.account.id)
    ) {
      return c.json([]);
    }
    const [{ cnt }] = await db
      .select({ cnt: count() })
      .from(posts)
      .where(eq(posts.accountId, account.id));
    if (cnt < REMOTE_ACTOR_FETCH_POSTS) {
      const fedCtx = federation.createContext(c.req.raw, undefined);
      await persistAccountPosts(
        db,
        account,
        REMOTE_ACTOR_FETCH_POSTS,
        c.req.url,
        {
          documentLoader: await fedCtx.getDocumentLoader({
            username: tokenUser.username,
          }),
          contextLoader: fedCtx.contextLoader,
          suppressError: true,
        },
      );
    }
    const query = c.req.valid("query");
    const limit = query.limit ?? 20;
    const following = await db
      .select({ id: follows.followingId })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, tokenUser.account.id),
          eq(follows.followingId, id),
        ),
      );
    const postList = await db.query.posts.findMany({
      where: and(
        eq(posts.accountId, id),
        or(
          eq(posts.accountId, tokenUser.account.id),
          eq(posts.visibility, "public"),
          eq(posts.visibility, "unlisted"),
          following.length > 0 ? eq(posts.visibility, "private") : undefined,
          and(
            eq(posts.visibility, "direct"),
            inArray(
              posts.id,
              db
                .select({ id: mentions.postId })
                .from(mentions)
                .where(eq(mentions.accountId, tokenUser.account.id)),
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
                eq(mutes.accountId, tokenUser.account.id),
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
            .where(eq(blocks.accountId, tokenUser.account.id)),
        ),
        // Hide the posts from the accounts who blocked the owner:
        notInArray(
          posts.accountId,
          db
            .select({ accountId: blocks.accountId })
            .from(blocks)
            .where(eq(blocks.blockedAccountId, tokenUser.account.id)),
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
                  eq(mutes.accountId, tokenUser.account.id),
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
        query.pinned === "true"
          ? inArray(
            posts.id,
            db
              .select({ id: pinnedPosts.postId })
              .from(pinnedPosts)
              .where(eq(pinnedPosts.accountId, id)),
          )
          : undefined,
        query.exclude_replies === "true"
          ? isNull(posts.replyTargetId)
          : undefined,
        query.only_media === "true"
          ? inArray(posts.id, db.select({ id: media.postId }).from(media))
          : undefined,
        query.max_id == null ? undefined : lt(posts.id, query.max_id),
        query.min_id == null ? undefined : gt(posts.id, query.min_id),
      ),
      with: getPostRelations(tokenUser.account.id),
      orderBy: [desc(posts.published), desc(posts.id)],
      limit: limit + 1,
    });
    let next: URL | undefined;
    if (postList.length > limit) {
      next = new URL(c.req.url);
      next.searchParams.set("max_id", postList[limit].id);
    }
    return c.json(
      postList
        .slice(0, limit)
        .map((p) => serializePost(p, tokenUser, c.req.url)),
      {
        headers: next == null ? undefined : { Link: `<${next}>; rel="next"` },
      },
    );
  },
);

app.post(
  "/:id/follow",
  tokenRequired,
  scopeRequired(["write:follows"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const following = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: { user: true },
    });
    if (following == null) return c.json({ error: "Record not found" }, 404);
    const fedCtx = federation.createContext(c.req.raw, undefined);
    const follow = await followAccount(
      db,
      fedCtx,
      { ...user.account, user },
      following,
    );
    if (follow == null) {
      return c.json({ error: "The action is not allowed" }, 403);
    }
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, following.id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (account == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(account, user));
  },
);

app.post(
  "/:id/unfollow",
  tokenRequired,
  scopeRequired(["write:follows"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const following = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: { user: true },
    });
    if (following == null) return c.json({ error: "Record not found" }, 404);
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await unfollowAccount(db, fedCtx, { ...user.account, user }, following);
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (account == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(account, user));
  },
);

app.get("/:id/followers", async (c) => {
  const accountId = c.req.param("id");
  if (!isUuid(accountId)) return c.json({ error: "Record not found" }, 404);
  const followers = await db.query.follows.findMany({
    where: and(eq(follows.followingId, accountId), isNotNull(follows.approved)),
    orderBy: desc(follows.approved),
    with: { follower: { with: { user: true, successor: true } } },
  });
  return c.json(
    followers.map((f) =>
      f.follower.user == null
        ? serializeAccount(f.follower, c.req.url)
        : serializeUser(
          { ...f.follower.user, account: f.follower },
          c.req.url,
        )
    ),
  );
});

app.get("/:id/following", async (c) => {
  const accountId = c.req.param("id");
  if (!isUuid(accountId)) return c.json({ error: "Record not found" }, 404);
  const followers = await db.query.follows.findMany({
    where: and(eq(follows.followerId, accountId), isNotNull(follows.approved)),
    orderBy: desc(follows.approved),
    with: { following: { with: { user: true, successor: true } } },
  });
  return c.json(
    followers.map((f) =>
      f.following.user == null
        ? serializeAccount(f.following, c.req.url)
        : serializeUser(
          { ...f.following.user, account: f.following },
          c.req.url,
        )
    ),
  );
});

app.get(
  "/:id/lists",
  tokenRequired,
  scopeRequired(["read:lists"]),
  async (c) => {
    const accountId = c.req.param("id");
    if (!isUuid(accountId)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const listList = await db.query.lists.findMany({
      where: and(
        eq(lists.accountId, user.account.id),
        inArray(
          lists.id,
          db
            .select({ id: listMembers.listId })
            .from(listMembers)
            .where(eq(listMembers.accountId, accountId)),
        ),
      ),
    });
    return c.json(listList.map(serializeList));
  },
);

app.get(
  "/mutes",
  tokenRequired,
  scopeRequired(["read:mutes"]),
  zValidator(
    "query",
    z.object({
      max_id: uuid.optional(),
      since_id: uuid.optional(),
      limit: z
        .string()
        .default("40")
        .transform((v) => {
          const parsed = Number.parseInt(v);
          return Math.min(parsed, 80);
        }),
    }),
  ),
  async (c) => {
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }

    const muteList = await db.query.mutes.findMany({
      where: eq(mutes.accountId, user.account.id),
    });

    if (muteList.length < 1) return c.json([]);

    const query = c.req.valid("query");

    const mutedAccounts = await db.query.accounts.findMany({
      where: and(
        inArray(
          accounts.id,
          muteList.map((m) => m.mutedAccountId),
        ),
        query.max_id == null ? undefined : lte(accounts.id, query.max_id),
        query.since_id == null ? undefined : gte(accounts.id, query.since_id),
      ),
      with: { user: true, successor: true },
      orderBy: [desc(accounts.id)],
      limit: query.limit ?? 40,
    });

    return c.json(mutedAccounts.map((a) => serializeAccount(a, c.req.url)));
  },
);

app.post(
  "/:id/mute",
  tokenRequired,
  scopeRequired(["write:mutes"]),
  zValidator(
    "json",
    z.object({
      notifications: z.boolean().default(true),
      duration: z.number().default(0),
    }),
  ),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const { notifications, duration } = c.req.valid("json");
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        user: true,
        mutes: { where: eq(mutes.accountId, user.account.id) },
        following: { where: eq(follows.followingId, user.account.id) },
      },
    });
    if (account == null) return c.json({ error: "Record not found" }, 404);
    const durationStr = duration <= 0 ? null : new Date(duration * 1000)
      .toISOString()
      .replace(/^[^T]+T|\.[^Z]+Z?$/g, "");
    await db
      .insert(mutes)
      .values(
        {
          id: crypto.randomUUID(),
          accountId: user.account.id,
          mutedAccountId: account.id,
          notifications,
          duration: durationStr,
        } satisfies NewMute,
      )
      .onConflictDoUpdate({
        target: [mutes.accountId, mutes.mutedAccountId],
        set: {
          notifications,
          duration: durationStr,
          created: new Date(),
        },
      });
    const result = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (result == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(result, user));
  },
);

app.post(
  "/:id/unmute",
  tokenRequired,
  scopeRequired(["write:mutes"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    await db
      .delete(mutes)
      .where(
        and(eq(mutes.accountId, user.account.id), eq(mutes.mutedAccountId, id)),
      );
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (account == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(account, user));
  },
);

app.post(
  "/:id/block",
  tokenRequired,
  scopeRequired(["read:blocks"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const acct = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: { user: true },
    });
    if (acct == null) return c.json({ error: "Record not found" }, 404);
    const fedCtx = federation.createContext(c.req.raw, undefined);
    await blockAccount(db, fedCtx, user, acct);
    const result = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (result == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(result, user));
  },
);

app.post(
  "/:id/unblock",
  tokenRequired,
  scopeRequired(["read:blocks"]),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const acct = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: { user: true },
    });
    if (acct == null) return c.json({ error: "Record not found" }, 404);
    await db
      .delete(blocks)
      .where(
        and(
          eq(blocks.accountId, user.account.id),
          eq(blocks.blockedAccountId, id),
        ),
      );
    if (acct.user == null) {
      const fedCtx = federation.createContext(c.req.raw, undefined);
      await fedCtx.sendActivity(
        { username: user.username },
        {
          id: new URL(acct.uri),
          inboxId: new URL(acct.inboxUrl),
        },
        new Undo({
          id: new URL(`#unblock/${crypto.randomUUID()}`, user.account.uri),
          actor: new URL(user.account.uri),
          object: new Block({
            id: new URL(`#block/${acct.id}`, user.account.uri),
            actor: new URL(user.account.uri),
            object: new URL(acct.uri),
          }),
        }),
        { excludeBaseUris: [new URL(fedCtx.url)] },
      );
    }
    const result = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      with: {
        following: {
          where: eq(follows.followingId, user.account.id),
        },
        followers: {
          where: eq(follows.followerId, user.account.id),
        },
        mutedBy: {
          where: eq(mutes.accountId, user.account.id),
        },
        blocks: {
          where: eq(blocks.blockedAccountId, user.account.id),
        },
        blockedBy: {
          where: eq(blocks.accountId, user.account.id),
        },
      },
    });
    if (result == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(result, user));
  },
);

export default app;
