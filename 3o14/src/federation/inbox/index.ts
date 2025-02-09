import {
  Accept,
  type Add,
  Announce,
  Article,
  Block,
  ChatMessage,
  type Create,
  type Delete,
  Follow,
  type InboxContext,
  Like,
  type Move,
  Note,
  Question,
  type Reject,
  type Remove,
  type Undo,
  type Update,
  isActor,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/db";
import {
  type NewLike,
  type NewPinnedPost,
  users,
  accounts,
  blocks,
  follows,
  likes,
  pinnedPosts,
  pollOptions,
  posts,
} from "../../db/schema";
import { isUuid } from "../../utils/uuid";
import {
  persistAccount,
  removeFollower,
  unfollowAccount,
  updateAccountStats,
} from "../account";
import {
  isPost,
  persistPollVote,
  persistPost,
  persistSharingPost,
  toUpdate,
  updatePostStats,
} from "../post";

const inboxLogger = getLogger(["3o14", "inbox"]);

export async function onAccountUpdated(
  ctx: InboxContext<void>,
  update: Update,
): Promise<void> {
  const object = await update.getObject();
  if (!isActor(object)) return;
  await persistAccount(db, object, ctx.origin, ctx);
}

export async function onAccountDeleted(
  _ctx: InboxContext<void>,
  del: Delete,
): Promise<void> {
  const actorId = del.actorId;
  const objectId = del.objectId;
  if (actorId == null || objectId == null) return;
  if (objectId.href !== actorId.href) return;
  await db.delete(accounts).where(eq(accounts.uri, actorId.href));
}

export async function onFollowed(
  ctx: InboxContext<void>,
  follow: Follow,
): Promise<void> {
  if (follow.id == null) return;
  const actor = await follow.getActor();
  if (!isActor(actor) || actor.id == null) {
    inboxLogger.debug("Invalid actor: {actor}", { actor });
    return;
  }
  const object = await follow.getObject();
  if (!isActor(object) || object.id == null) {
    inboxLogger.debug("Invalid object: {object}", { object });
    return;
  }
  const following = await db.query.accounts.findFirst({
    where: eq(accounts.uri, object.id.href),
    with: { user: true },
  });
  if (following?.user == null) {
    inboxLogger.debug("Invalid following: {following}", { following });
    return;
  }
  const follower = await persistAccount(db, actor, ctx.origin, ctx);
  if (follower == null) return;
  let approves = !following.protected;
  if (approves) {
    const block = await db.query.blocks.findFirst({
      where: and(
        eq(blocks.accountId, following.id),
        eq(blocks.blockedAccountId, follower.id),
      ),
    });
    approves = block == null;
  }
  await db
    .insert(follows)
    .values({
      uri: follow.id.href,
      followingId: following.id,
      followerId: follower.id,
      approved: approves ? new Date() : null,
    })
    .onConflictDoNothing();
  if (approves) {
    await ctx.sendActivity(
      { username: following.user.username },
      actor,
      new Accept({
        id: new URL(
          `#accepts/${follower.uri}`,
          ctx.getActorUri(following.user.username),
        ),
        actor: object.id,
        object: follow,
      }),
      { excludeBaseUris: [new URL(ctx.origin)] },
    );
    await updateAccountStats(db, { id: following.id });
  }
}

export async function onUnfollowed(
  ctx: InboxContext<void>,
  undo: Undo,
): Promise<void> {
  const object = await undo.getObject();
  if (!(object instanceof Follow)) return;
  if (object.actorId?.href !== undo.actorId?.href || object.id == null) return;
  const actor = await undo.getActor();
  if (!isActor(actor) || actor.id == null) {
    inboxLogger.debug("Invalid actor: {actor}", { actor });
    return;
  }
  const account = await persistAccount(db, actor, ctx.origin, ctx);
  if (account == null) return;
  const deleted = await db
    .delete(follows)
    .where(
      and(eq(follows.uri, object.id.href), eq(follows.followerId, account.id)),
    )
    .returning({ followingId: follows.followingId });
  if (deleted.length > 0) {
    await updateAccountStats(db, { id: deleted[0].followingId });
  }
}

export async function onFollowAccepted(
  ctx: InboxContext<void>,
  accept: Accept,
): Promise<void> {
  const actor = await accept.getActor();
  if (!isActor(actor) || actor.id == null) {
    inboxLogger.debug("Invalid actor: {actor}", { actor });
    return;
  }
  const account = await persistAccount(db, actor, ctx.origin, ctx);
  if (account == null) return;
  if (accept.objectId != null) {
    const updated = await db
      .update(follows)
      .set({ approved: new Date() })
      .where(
        and(
          eq(follows.uri, accept.objectId.href),
          eq(follows.followingId, account.id),
        ),
      )
      .returning();
    if (updated.length > 0) {
      await updateAccountStats(db, { id: updated[0].followerId });
      return;
    }
  }
  const object = await accept.getObject();
  if (object instanceof Follow) {
    if (object.actorId == null) return;
    await db
      .update(follows)
      .set({ approved: new Date() })
      .where(
        and(
          eq(
            follows.followerId,
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.uri, object.actorId.href)),
          ),
          eq(follows.followingId, account.id),
        ),
      );
    await updateAccountStats(db, { uri: object.actorId.href });
  }
}

export async function onFollowRejected(
  ctx: InboxContext<void>,
  reject: Reject,
): Promise<void> {
  const actor = await reject.getActor();
  if (!isActor(actor) || actor.id == null) {
    inboxLogger.debug("Invalid actor: {actor}", { actor });
    return;
  }
  const account = await persistAccount(db, actor, ctx.origin, ctx);
  if (account == null) return;
  if (reject.objectId != null) {
    const deleted = await db
      .delete(follows)
      .where(
        and(
          eq(follows.uri, reject.objectId.href),
          eq(follows.followingId, account.id),
        ),
      )
      .returning();
    if (deleted.length > 0) {
      await updateAccountStats(db, { id: deleted[0].followerId });
      return;
    }
  }
  const object = await reject.getObject();
  if (object instanceof Follow) {
    if (object.actorId == null) return;
    await db
      .delete(follows)
      .where(
        and(
          eq(
            follows.followerId,
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.uri, object.actorId.href)),
          ),
          eq(follows.followingId, account.id),
        ),
      );
    await updateAccountStats(db, { uri: object.actorId.href });
  }
}

export async function onBlocked(
  ctx: InboxContext<void>,
  block: Block,
): Promise<void> {
  const blocker = await block.getActor();
  if (blocker == null) return;
  const object = ctx.parseUri(block.objectId);
  if (block.objectId == null || object?.type !== "actor") return;
  const blocked = await db.query.users.findFirst({
    with: { account: true },
    where: eq(users.username, object.identifier),
  });
  if (blocked == null) return;
  const blockerAccount = await persistAccount(db, blocker, ctx.origin, ctx);
  if (blockerAccount == null) return;
  const result = await db
    .insert(blocks)
    .values({
      accountId: blockerAccount.id,
      blockedAccountId: blocked.account.id,
    })
    .onConflictDoNothing()
    .returning();
  if (result.length < 1) return;
  await unfollowAccount(
    db,
    ctx,
    { ...blocked.account, user: blocked },
    blockerAccount,
  );
  await removeFollower(
    db,
    ctx,
    { ...blocked.account, user: blocked },
    blockerAccount,
  );
}

export async function onUnblocked(
  ctx: InboxContext<void>,
  undo: Undo,
): Promise<void> {
  const object = await undo.getObject();
  if (
    !(object instanceof Block) ||
    undo.actorId?.href !== object.actorId?.href
  ) {
    return;
  }
  const actor = await undo.getActor();
  if (actor == null) return;
  const blocker = await persistAccount(db, actor, ctx.origin, ctx);
  if (blocker == null) return;
  const target = ctx.parseUri(object.objectId);
  if (target?.type !== "actor") return;
  await db
    .delete(blocks)
    .where(
      and(
        eq(blocks.accountId, blocker.id),
        eq(
          blocks.blockedAccountId,
          db
            .select({ accountId: accounts.id })
            .from(accounts)
            .innerJoin(users, eq(accounts.userId, users.id))
            .where(eq(users.username, target.identifier)),
        ),
      ),
    );
}

export async function onPostCreated(
  ctx: InboxContext<void>,
  create: Create,
): Promise<void> {
  const object = await create.getObject();
  if (!isPost(object)) return;
  const post = await db.transaction(async (tx) => {
    const post = await persistPost(tx, object, ctx.origin, ctx);
    if (post?.replyTargetId != null) {
      await updatePostStats(tx, { id: post.replyTargetId });
    }
    return post;
  });
  if (post?.replyTargetId != null) {
    const replyTarget = await db.query.posts.findFirst({
      where: eq(posts.id, post.replyTargetId),
      with: {
        account: { with: { user: true } },
        replyTarget: true,
        quoteTarget: true,
        media: true,
        poll: { with: { options: true } },
        mentions: { with: { account: true } },
        replies: true,
      },
    });
    if (replyTarget?.account.user != null) {
      await ctx.forwardActivity(
        { username: replyTarget.account.user.username },
        "followers",
        {
          skipIfUnsigned: true,
          preferSharedInbox: true,
          excludeBaseUris: [new URL(ctx.origin)],
        },
      );
      await ctx.sendActivity(
        { username: replyTarget.account.user.username },
        "followers",
        toUpdate(replyTarget, ctx),
        { preferSharedInbox: true, excludeBaseUris: [new URL(ctx.origin)] },
      );
    }
  }
}

export async function onPostUpdated(
  ctx: InboxContext<void>,
  update: Update,
): Promise<void> {
  const object = await update.getObject();
  if (!isPost(object)) return;
  await persistPost(db, object, ctx.origin, ctx);
}

export async function onPostDeleted(
  _ctx: InboxContext<void>,
  del: Delete,
): Promise<void> {
  const actorId = del.actorId;
  const objectId = del.objectId;
  if (actorId == null || objectId == null) return;
  await db.transaction(async (tx) => {
    const deletedPosts = await tx
      .delete(posts)
      .where(eq(posts.uri, objectId.href))
      .returning();
    if (deletedPosts.length > 0) {
      const deletedPost = deletedPosts[0];
      if (deletedPost.replyTargetId != null) {
        await updatePostStats(tx, { id: deletedPost.replyTargetId });
      }
      if (deletedPost.sharingId != null) {
        await updatePostStats(tx, { id: deletedPost.sharingId });
      }
    }
  });
}

export async function onPostShared(
  ctx: InboxContext<void>,
  announce: Announce,
): Promise<void> {
  const object = await announce.getObject();
  if (!isPost(object)) return;
  const post = await db.transaction(async (tx) => {
    const post = await persistSharingPost(
      tx,
      announce,
      object,
      ctx.origin,
      ctx,
    );
    if (post?.sharingId != null) {
      await updatePostStats(tx, { id: post.sharingId });
    }
    return post;
  });
  if (post?.sharing?.account?.user != null) {
    await ctx.forwardActivity(
      { username: post.sharing.account.user.username },
      "followers",
      { skipIfUnsigned: true },
    );
  }
}

export async function onPostUnshared(
  ctx: InboxContext<void>,
  undo: Undo,
): Promise<void> {
  const object = await undo.getObject();
  if (!(object instanceof Announce)) return;
  if (object.actorId?.href !== undo.actorId?.href) return;
  const sharer = object.actorId;
  const originalPost = object.objectId;
  if (sharer == null || originalPost == null) return;
  const original = await db.transaction(async (tx) => {
    const original = await tx.query.posts.findFirst({
      with: {
        account: { with: { user: true } },
      },
      where: eq(posts.uri, originalPost.href),
    });
    if (original == null) return null;
    const deleted = await tx
      .delete(posts)
      .where(
        and(
          eq(
            posts.accountId,
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.uri, sharer.href)),
          ),
          eq(posts.sharingId, original.id),
        ),
      )
      .returning();
    if (deleted.length > 0 && deleted[0].sharingId != null) {
      await updatePostStats(tx, { id: deleted[0].sharingId });
    }
    return original;
  });
  if (original?.account.user != null) {
    await ctx.forwardActivity(
      { username: original.account.user.username },
      "followers",
      { skipIfUnsigned: true },
    );
  }
}

export async function onPostPinned(
  ctx: InboxContext<void>,
  add: Add,
): Promise<void> {
  if (add.targetId == null) return;
  const object = await add.getObject();
  if (!isPost(object)) return;
  const accountList = await db.query.accounts.findMany({
    where: eq(accounts.featuredUrl, add.targetId.href),
  });
  await db.transaction(async (tx) => {
    const post = await persistPost(tx, object, ctx.origin, ctx);
    if (post == null) return;
    for (const account of accountList) {
      await tx.insert(pinnedPosts).values({
        postId: post.id,
        accountId: account.id,
      } satisfies NewPinnedPost);
    }
  });
}

export async function onPostUnpinned(
  ctx: InboxContext<void>,
  remove: Remove,
): Promise<void> {
  if (remove.targetId == null) return;
  const object = await remove.getObject();
  if (!isPost(object)) return;
  const accountList = await db.query.accounts.findMany({
    where: eq(accounts.featuredUrl, remove.targetId.href),
  });
  await db.transaction(async (tx) => {
    const post = await persistPost(tx, object, ctx.origin, ctx);
    if (post == null) return;
    for (const account of accountList) {
      await tx
        .delete(pinnedPosts)
        .where(
          and(
            eq(pinnedPosts.postId, post.id),
            eq(pinnedPosts.accountId, account.id),
          ),
        );
    }
  });
}

export async function onLiked(
  ctx: InboxContext<void>,
  like: Like,
): Promise<void> {
  if (like.content != null) {
    return;
  }
  if (like.objectId == null) return;
  const parsed = ctx.parseUri(like.objectId);
  if (parsed == null) return;
  const { type } = parsed;
  if (
    type === "object" &&
    (parsed.class === Note ||
      parsed.class === Article ||
      parsed.class === Question ||
      parsed.class === ChatMessage)
  ) {
    const actor = await like.getActor();
    if (actor == null) return;
    const account = await persistAccount(db, actor, ctx.origin, ctx);
    if (account == null) return;
    // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
    const postId = parsed.values["id"];
    if (!isUuid(postId)) return;
    await db.transaction(async (tx) => {
      await tx
        .insert(likes)
        .values({ postId, accountId: account.id } satisfies NewLike);
      await updatePostStats(tx, { id: postId });
    });
    await ctx.forwardActivity(
      // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
      { username: parsed.values["username"] },
      "followers",
      { skipIfUnsigned: true },
    );
  } else {
    inboxLogger.debug("Unsupported object on Like: {objectId}", {
      objectId: like.objectId?.href,
    });
  }
}

export async function onUnliked(
  ctx: InboxContext<void>,
  undo: Undo,
): Promise<void> {
  const object = await undo.getObject();
  if (
    !(object instanceof Like) ||
    object.actorId?.href !== undo.actorId?.href
  ) {
    return;
  }
  const like = object;
  if (like.content != null) {
    return;
  }
  if (like.objectId == null) return;
  const parsed = ctx.parseUri(like.objectId);
  if (parsed == null) return;
  const { type } = parsed;
  if (
    type === "object" &&
    (parsed.class === Note ||
      parsed.class === Article ||
      parsed.class === Question ||
      parsed.class === ChatMessage)
  ) {
    const actor = await like.getActor();
    if (actor == null) return;
    const account = await persistAccount(db, actor, ctx.origin, ctx);
    if (account == null) return;
    // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
    const postId = parsed.values["id"];
    if (!isUuid(postId)) return;
    await db.transaction(async (tx) => {
      await tx
        .delete(likes)
        .where(and(eq(likes.postId, postId), eq(likes.accountId, account.id)));
      await updatePostStats(tx, { id: postId });
    });
    await ctx.forwardActivity(
      // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
      { username: parsed.values["username"] },
      "followers",
      { skipIfUnsigned: true },
    );
  } else {
    inboxLogger.debug("Unsupported object on Undo<Like>: {objectId}", {
      objectId: like.objectId?.href,
    });
  }
}



export async function onVoted(
  ctx: InboxContext<void>,
  create: Create,
): Promise<void> {
  const object = await create.getObject();
  if (
    !(object instanceof Note) ||
    object.replyTargetId == null ||
    object.attributionId == null ||
    object.name == null
  ) {
    return;
  }
  const vote = await db.transaction((tx) =>
    persistPollVote(tx, object, ctx.origin, ctx),
  );
  if (vote == null) return;
  const post = await db.query.posts.findFirst({
    with: {
      account: { with: { user: true } },
      replyTarget: true,
      quoteTarget: true,
      media: true,
      poll: {
        with: {
          options: { orderBy: pollOptions.index },
          votes: { with: { account: true } },
        },
      },
      mentions: { with: { account: true } },
      replies: true,
    },
    where: eq(posts.pollId, vote.pollId),
  });
  if (post?.account.user == null || post.poll == null) return;
  await ctx.sendActivity(
    { username: post.account.user.username },
    post.poll.votes.map((v) => ({
      id: new URL(v.account.uri),
      inboxId: new URL(v.account.inboxUrl),
      endpoints:
        v.account.sharedInboxUrl == null
          ? null
          : {
            sharedInbox: new URL(v.account.sharedInboxUrl),
          },
    })),
    toUpdate(post, ctx),
    { preferSharedInbox: true, excludeBaseUris: [new URL(ctx.origin)] },
  );
}

export async function onAccountMoved(
  ctx: InboxContext<void>,
  move: Move,
): Promise<void> {
  if (
    move.objectId == null ||
    move.targetId == null ||
    move.actorId?.href !== move.objectId.href
  ) {
    return;
  }
  const object = await move.getObject();
  if (!isActor(object)) return;
  const obj = await persistAccount(db, object, ctx.origin, ctx);
  if (obj == null) return;
  const target = await move.getTarget();
  if (
    !isActor(target) ||
    target.aliasIds.every((a) => a.href !== object.id?.href)
  ) {
    return;
  }
  const tgt = await persistAccount(db, target, ctx.origin, ctx);
  if (tgt == null) return;
  const followers = await db.query.follows.findMany({
    with: { follower: { with: { user: true } } },
    where: eq(follows.followingId, obj.id),
  });
  for (const follower of followers) {
    if (follower.follower.user == null) continue;
    const result = await db
      .insert(follows)
      .values({
        uri: new URL(`#follows/${crypto.randomUUID()}`, follower.follower.uri)
          .href,
        followingId: tgt.id,
        followerId: follower.followerId,
        shares: follower.shares,
        notify: follower.notify,
        approved: tgt.user == null || tgt.protected ? null : new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (tgt.user != null || result.length < 1) continue;
    await ctx.sendActivity(
      { username: follower.follower.user.username },
      target,
      new Follow({
        id: new URL(result[0].uri),
        actor: new URL(follower.follower.uri),
        object: new URL(tgt.uri),
      }),
      { excludeBaseUris: [new URL(ctx.origin)] },
    );
  }
}
