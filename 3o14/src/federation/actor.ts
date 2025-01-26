import { and, eq, ilike, inArray } from "drizzle-orm";
import db from "../db/db";
import federation from "./federation";
import { accounts, follows, users } from "../db/schema";
import { Endpoints, importJwk, Person } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["3o14", "fedi", "actor"]);

federation.setActorDispatcher("/users/@{identifier}", async (ctx, identifier) => {
  const user = await db.query.users.findFirst({
    where: eq(users.username, identifier),
    with: { account: true }
  });
  if (user == null) return null;
  const account = user.account;
  return new Person({
    id: ctx.getActorUri(identifier),
    name: account.preferredName,
    preferredUsername: identifier,
    summary: account.bio,
    url: account.url ? new URL(account.url) : null,
    publicKey: (await ctx.getActorKeyPairs(identifier))[0].cryptographicKey,
    assertionMethods: (await ctx.getActorKeyPairs(identifier)).map(
      (pair) => pair.multikey,
    ),
    followers: ctx.getFollowersUri(identifier),
    following: ctx.getFollowingUri(identifier),
    // outbox: ctx.getOutboxUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(),
    }),
    discoverable: true,
    indexable: true,
  })
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

federation
  .setFollowersDispatcher(
    "/users/@{identifier}/followers",
    async (_ctx, identifier, cursor, filter) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
        with: { account: true },
      });
      if (user == null) return null;
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
                eq(follows.followingId, user.account.id),
              )
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
      logger.debug(
        "Gathered {followers} followers for {identifier} with cursor {cursor} and filter {filter}.",
        { followers: result.items.length, identifier, cursor, filter },
      );
      return result
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
    "/users/@{identifier}/following",
    async (_ctx, identifier, cursor) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
        with: { account: true },
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
              eq(follows.followerId, user.account.id),
            )
        ),
        offset,
        orderBy: accounts.id,
        limit: offset == null ? undefined : 41,
      });

      const result = {
        items: following.slice(0, 40).map((f) => new URL(f.uri)),
        nextCursor: following.length > 40 ? `${offset + 40}` : null,
      };
      logger.debug(
        "Gathered {following} following for {identifier} with cursor {cursor}.",
        { following: result.items.length, identifier, cursor },
      );
      return result
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
