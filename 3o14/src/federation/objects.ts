import { Flag, Note } from "@fedify/fedify";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../db/db";
import {
  users,
  accounts,
  follows,
  pollOptions,
  posts,
  reports,
} from "../db/schema";
import { isUuid } from "../utils/uuid";
import { federation } from "./federation";
import { toObject } from "./post";

federation.setObjectDispatcher(
  Note,
  "/@{username}/{id}",
  async (ctx, values) => {
    if (!values.id?.match(/^[-a-f0-9]+$/)) return null;
    const user = await db.query.users.findFirst({
      where: like(users.username, values.username),
      with: { account: true },
    });
    if (user == null) return null;
    if (!isUuid(values.id)) return null;
    const post = await db.query.posts.findFirst({
      where: and(
        eq(posts.id, values.id),
        eq(posts.accountId, user.account.id),
      ),
      with: {
        account: { with: { user: true } },
        replyTarget: true,
        quoteTarget: true,
        media: true,
        poll: { with: { options: { orderBy: pollOptions.index } } },
        mentions: { with: { account: true } },
        replies: true,
      },
    });
    if (post == null) return null;
    if (post.visibility === "private") {
      const keyOwner = await ctx.getSignedKeyOwner();
      if (keyOwner?.id == null) return null;
      const found = await db.query.follows.findFirst({
        where: and(
          inArray(
            follows.followerId,
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.uri, keyOwner.id.href)),
          ),
          eq(follows.followingId, users.id),
        ),
      });
      if (found == null) return null;
    } else if (post.visibility === "direct") {
      const keyOwner = await ctx.getSignedKeyOwner();
      const keyOwnerId = keyOwner?.id;
      if (keyOwnerId == null) return null;
      const found = post.mentions.some(
        (m) => m.account.uri === keyOwnerId.href,
      );
      if (!found) return null;
    }
    return toObject(post, ctx);
  },
);


federation.setObjectDispatcher(Flag, "/reports/{id}", async (ctx, { id }) => {
  if (!isUuid(id)) return null;
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, id),
    with: {
      account: {
        columns: { uri: true },
      },
      targetAccount: {
        columns: {
          uri: true,
        },
      },
    },
  });

  if (report == null) return null;

  // Perform some access control on fetching a Flag activity
  const keyOwner = await ctx.getSignedKeyOwner();
  const keyOwnerId = keyOwner?.id;
  if (keyOwnerId == null) return null;

  // compare the keyOwner who signed the request with the targetAccount
  // Note: this won't work if it's the instance actor doing the fetch and not the targetAccount:
  if (keyOwnerId.href !== report.targetAccount.uri) {
    return null;
  }

  // Fetch the posts for the Flag activity:
  let targetPosts: { uri: string }[] = [];
  if (report.posts.length > 0) {
    targetPosts = await db.query.posts.findMany({
      where: and(
        inArray(posts.id, report.posts),
        eq(posts.accountId, report.targetAccountId),
      ),
      columns: {
        uri: true,
      },
    });
  }

  return new Flag({
    id: new URL(report.uri),
    actor: new URL(report.account.uri),
    // For Mastodon compatibility, objects must include the target account IRI along with the posts:
    objects: targetPosts
      .map((post) => new URL(post.uri))
      .concat(new URL(report.targetAccount.uri)),
    content: report.comment,
  });
});
