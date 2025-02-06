import {
  Endpoints,
  Image,
  Like,
  Person,
  PropertyValue,
  importJwk,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { and, count, desc, eq, ilike, inArray, isNotNull } from "drizzle-orm";
// import { uniq } from "es-toolkit";
import { db } from "../db/db";
import {
  users,
  accounts,
  follows,
  likes,
  pinnedPosts,
  pollOptions,
  posts,
} from "../db/schema";
import { federation } from "./federation";
import { toAnnounce, toCreate, toObject } from "./post";

federation
  .setActorDispatcher("/@{identifier}", async (ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: { with: { successor: true } } },
    });
    if (user == null) return null;
    const account = user.account;
    // const cls = getActorClassByTypeName(account.type);
    return new Person({
      id: new URL(account.uri),
      name: account.name,
      preferredUsername: identifier,
      summary: account.bio,
      url: account.url ? new URL(account.url) : null,
      manuallyApprovesFollowers: account.protected,
      icon: account.avatarurl
        ? new Image({ url: new URL(account.avatarurl) })
        : null,
      image: account.coverurl
        ? new Image({ url: new URL(account.coverurl) })
        : null,
      publicKey: (await ctx.getActorKeyPairs(identifier))[0].cryptographicKey,
      assertionMethods: (await ctx.getActorKeyPairs(identifier)).map(
        (pair) => pair.multikey,
      ),
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      liked: ctx.getLikedUri(identifier),
      featured: ctx.getFeaturedUri(identifier),
      featuredTags: ctx.getFeaturedTagsUri(identifier),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      successor:
        account.successor == null ? null : new URL(account.successor.uri),
      aliases: [...new Set(account.aliases)].map((a) => new URL(a)),
      attachments: Object.entries(account.fieldHtmls).map(
        ([name, value]) =>
          new PropertyValue({
            name,
            value,
          }),
      ),
      discoverable: user.discoverable,
    });
  })
  .mapHandle((_, handle) => handle)
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: true }
    });
    if (user == null) return [];
    const account = user.account;
    if (account.ed25519PrivateKey == null || account.rsaPrivateKey == null) return [];
    if (account.ed25519PublicKey == null || account.rsaPublicKey == null) return [];
    return [
      {
        privateKey: await importJwk(account.rsaPrivateKey, "private"),
        publicKey: await importJwk(account.rsaPublicKey, "public"),
      },
      {
        privateKey: await importJwk(account.ed25519PrivateKey, "private"),
        publicKey: await importJwk(account.rsaPublicKey, "public"),
      }
    ];
  });

const followersLogger = getLogger(["hollo", "federation", "followers"]);

federation
  .setFollowersDispatcher(
    "/@{identifier}/followers",
    async (_ctx, identifier, cursor, filter) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
      });
      if (user == null) return null;
      followersLogger.debug(
        "Gathering followers for {identifier} with cursor {cursor} and filter {filter}...",
        { identifier, cursor, filter },
      );
      const offset = cursor == null ? undefined : Number.parseInt(cursor);
      if (offset != null && !Number.isInteger(offset)) return null;
      const followers = await db.query.accounts.findMany({
        where: and(
          inArray(
            accounts.id,
            db
              .select({ id: follows.followerId })
              .from(follows)
              .where(
                and(
                  eq(follows.followingId, user.id),
                  isNotNull(follows.approved),
                ),
              ),
          ),
          filter == null
            ? undefined
            : ilike(accounts.uri, `${filter.origin}/%`),
        ),
        offset,
        orderBy: accounts.id,
        limit: offset == null ? undefined : 41,
      });
      const items = offset == null ? followers : followers.slice(0, 40);
      const result = {
        items: items.map((f) => ({
          id: new URL(f.uri),
          inboxId: new URL(f.inboxUrl),
          endpoints: {
            sharedInbox: f.sharedInboxUrl ? new URL(f.sharedInboxUrl) : null,
          },
        })),
        nextCursor:
          offset != null && followers.length > 40 ? `${offset + 40}` : null,
      };
      followersLogger.debug(
        "Gathered {followers} followers for {identifier} with cursor {cursor} and filter {filter}.",
        { followers: result.items.length, identifier, cursor, filter },
      );
      return result;
    },
  )
  .setFirstCursor(async (_ctx, _identifier) => "0")
  .setCounter(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: true },
    });
    return user == null ? 0 : user.account.followersCount;
  });

federation
  .setFollowingDispatcher(
    "/@{identifier}/following",
    async (_ctx, identifier, cursor) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
      });
      if (user == null || cursor == null) return null;
      const offset = Number.parseInt(cursor);
      if (!Number.isInteger(offset)) return null;
      const following = await db.query.accounts.findMany({
        where: inArray(
          accounts.id,
          db
            .select({ id: follows.followingId })
            .from(follows)
            .where(
              and(
                eq(follows.followerId, user.id),
                isNotNull(follows.approved),
              ),
            ),
        ),
        offset,
        orderBy: accounts.id,
        limit: 41,
      });
      return {
        items: following.slice(0, 40).map((f) => new URL(f.uri)),
        nextCursor: following.length > 40 ? `${offset + 40}` : null,
      };
    },
  )
  .setFirstCursor(async (_ctx, _identifier) => "0")
  .setCounter(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: true },
    });
    return user == null ? 0 : user.account.followingCount;
  });

federation
  .setOutboxDispatcher(
    "/@{identifier}/outbox",
    async (ctx, identifier, cursor) => {
      if (cursor == null) return null;
      const owner = await db.query.users.findFirst({
        where: eq(users.username, identifier),
      });
      if (owner == null) return null;
      const items = await db.query.posts.findMany({
        where: eq(posts.accountId, owner.id),
        orderBy: desc(posts.published),
        offset: Number.parseInt(cursor),
        limit: 41,
        with: {
          account: { with: { user: true } },
          replyTarget: true,
          quoteTarget: true,
          media: true,
          poll: { with: { options: true } },
          mentions: { with: { account: true } },
          sharing: { with: { account: true } },
          replies: true,
        },
      });
      return {
        items: items
          .slice(0, 40)
          .map((p) =>
            p.sharing == null ? toCreate(p, ctx) : toAnnounce(p, ctx),
          ),
        nextCursor:
          items.length > 40 ? `${Number.parseInt(cursor) + 40}` : null,
      };
    },
  )
  .setFirstCursor(async (_ctx, _identifier) => "0")
  .setCounter(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
    });
    if (user == null) return null;
    const result = await db
      .select({ cnt: count() })
      .from(posts)
      .where(eq(posts.accountId, user.id));
    if (result.length < 1) return 0;
    return result[0].cnt;
  });

federation
  .setLikedDispatcher(
    "/@{identifier}/liked",
    async (_ctx, identifier, cursor) => {
      if (cursor == null) return null;
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
        with: { account: true },
      });
      if (user == null) return null;
      const items = await db.query.likes.findMany({
        where: eq(likes.accountId, user.id),
        orderBy: desc(likes.created),
        offset: Number.parseInt(cursor),
        limit: 41,
        with: { post: true },
      });
      return {
        items: items.slice(0, 40).map(
          (like) =>
            new Like({
              id: new URL(
                `#likes/${like.created.toISOString()}`,
                user.account.uri,
              ),
              actor: new URL(user.account.uri),
              object: new URL(like.post.uri),
            }),
        ),
        nextCursor:
          items.length > 40 ? `${Number.parseInt(cursor) + 40}` : null,
      };
    },
  )
  .setFirstCursor(async (_ctx, _identifier) => "0")
  .setCounter(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
    });
    if (user == null) return null;
    const result = await db
      .select({ cnt: count() })
      .from(likes)
      .where(eq(likes.accountId, user.id));
    if (result.length < 1) return 0;
    return result[0].cnt;
  });

federation.setFeaturedDispatcher(
  "/@{identifier}/pinned",
  async (ctx, identifier) => {
    const owner = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: true },
    });
    if (owner == null) return null;
    const items = await db.query.pinnedPosts.findMany({
      where: eq(pinnedPosts.accountId, owner.id),
      orderBy: desc(pinnedPosts.index),
      with: {
        post: {
          with: {
            account: { with: { user: true } },
            replyTarget: true,
            quoteTarget: true,
            media: true,
            poll: { with: { options: { orderBy: pollOptions.index } } },
            mentions: { with: { account: true } },
            replies: true,
          },
        },
      },
    });
    return {
      items: items
        .map((p) => p.post)
        .filter((p) => p.visibility === "public" || p.visibility === "unlisted")
        .map((p) => toObject(p, ctx)),
    };
  },
);
