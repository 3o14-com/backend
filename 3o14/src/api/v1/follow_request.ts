import { Accept, Follow, Reject } from "@fedify/fedify";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import db from "../../db/db";
import {
  serializeAccount,
  serializeUser,
  serializeRelationship,
} from "../../entities/accounts";
import { federation } from "../../federation";
import { updateAccountStats } from "../../federation/account";
import { type Variables, scopeRequired, tokenRequired } from "../../middlewares/oauth";
import { accounts, blocks, follows, mutes } from "../../db/schema";
import { isUuid } from "../../utils/uuid";

const app = new Hono<{ Variables: Variables }>();

app.get("/", tokenRequired, scopeRequired(["read:follows"]), async (c) => {
  const user = c.get("token").user;
  if (user == null) {
    return c.json({ error: "This method requires an authenticated user" }, 422);
  }
  const followers = await db.query.follows.findMany({
    where: and(eq(follows.followingId, user.id), isNull(follows.approved)),
    with: { follower: { with: { user: true, successor: true } } },
  });
  return c.json(
    followers.map((f) =>
      f.follower.user == null
        ? serializeAccount(f.follower, c.req.url)
        : serializeUser(
          { ...f.follower.user, account: f.follower },
          c.req.url,
        ),
    ),
  );
});

app.post(
  "/:account_id/authorize",
  tokenRequired,
  scopeRequired(["write:follows"]),
  async (c) => {
    const followerId = c.req.param("account_id");
    if (!isUuid(followerId)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const follower = await db.query.accounts.findFirst({
      where: eq(accounts.id, followerId),
      with: { user: true },
    });
    if (follower == null) return c.json({ error: "Record not found" }, 404);
    const result = await db
      .update(follows)
      .set({ approved: new Date() })
      .where(
        and(
          eq(follows.followingId, user.id),
          eq(follows.followerId, followerId),
          isNull(follows.approved),
        ),
      )
      .returning({ uri: follows.uri });
    if (result.length < 1) return c.json({ error: "Record not found" }, 404);
    if (follower.user == null) {
      const fedCtx = federation.createContext(c.req.raw, undefined);
      await fedCtx.sendActivity(
        user,
        { id: new URL(follower.uri), inboxId: new URL(follower.inboxUrl) },
        new Accept({
          id: new URL(`#accepts/${follower.uri}`, user.account.uri),
          actor: new URL(user.account.uri),
          object: new Follow({
            id: new URL(result[0].uri),
            actor: new URL(follower.uri),
            object: new URL(user.account.uri),
          }),
        }),
        { excludeBaseUris: [new URL(c.req.url)] },
      );
    }
    await updateAccountStats(db, { id: user.id });
    const follower2 = await db.query.accounts.findFirst({
      where: eq(accounts.id, followerId),
      with: {
        followers: {
          where: eq(follows.followerId, user.id),
        },
        following: {
          where: eq(follows.followingId, user.id),
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
    });
    if (follower2 == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(follower2, user));
  },
);

app.post(
  "/:account_id/reject",
  tokenRequired,
  scopeRequired(["write:follows"]),
  async (c) => {
    const followerId = c.req.param("account_id");
    if (!isUuid(followerId)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticated user" },
        422,
      );
    }
    const follower = await db.query.accounts.findFirst({
      where: eq(accounts.id, followerId),
      with: { user: true },
    });
    if (follower == null) return c.json({ error: "Record not found" }, 404);
    const result = await db
      .delete(follows)
      .where(
        and(
          eq(follows.followingId, user.id),
          eq(follows.followerId, followerId),
          isNull(follows.approved),
        ),
      )
      .returning({ uri: follows.uri });
    if (result.length < 1) return c.json({ error: "Record not found" }, 404);
    if (follower.user == null) {
      const fedCtx = federation.createContext(c.req.raw, undefined);
      await fedCtx.sendActivity(
        user,
        { id: new URL(follower.uri), inboxId: new URL(follower.inboxUrl) },
        new Reject({
          id: new URL(`#rejects/${follower.uri}`, user.account.uri),
          actor: new URL(user.account.uri),
          object: new Follow({
            id: new URL(result[0].uri),
            actor: new URL(follower.uri),
            object: new URL(user.account.uri),
          }),
        }),
        { excludeBaseUris: [new URL(c.req.url)] },
      );
    }
    const follower2 = await db.query.accounts.findFirst({
      where: eq(accounts.id, followerId),
      with: {
        followers: {
          where: eq(follows.followerId, user.id),
        },
        following: {
          where: eq(follows.followingId, user.id),
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
    });
    if (follower2 == null) return c.json({ error: "Record not found" }, 404);
    return c.json(serializeRelationship(follower2, user));
  },
);

export default app;
