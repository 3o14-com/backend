import { getActorHandle, Link, type Actor } from "@fedify/fedify";
import * as schema from "../db/schema";
import db from "../db/db";
import { count, eq, sql } from "drizzle-orm";
import { uuidv7, type Uuid } from "../utils/uuid";

export async function persistAccount(
  actor: Actor,
): Promise<(schema.Account & { user: schema.User | null }) | null> {
  if (
    actor.id == null ||
    actor.inboxId == null ||
    (actor.name == null || actor.preferredUsername == null)
  ) {
    return null;
  }

  const existingAccount = await db.query.accounts.findFirst({
    where: eq(schema.accounts.uri, actor.id.href),
    with: { user: true },
  });
  if (existingAccount != null) return existingAccount;

  let handle: string;
  try {
    handle = await getActorHandle(actor);
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
  const followers = await actor.getFollowers();
  const followings = await actor.getFollowing();
  await db
    .insert(schema.accounts)
    .values({
      id: uuidv7(),
      uri: actor.id.href,
      preferredName: actor?.name?.toString() ?? actor?.preferredUsername?.toString() ?? "",
      bio: actor.summary?.toString(),
      url: actor.url instanceof Link ? actor.url.href?.href : actor.url?.href,
      inboxUrl: actor.inboxId.href,
      sharedInboxUrl: actor.endpoints?.sharedInbox?.href,
      followersUrl: (followers?.id ?? actor?.followersId)?.href,
      followingUrl: (followings?.id ?? actor?.followingId)?.href,
      followersCount: followers?.totalItems ?? 0,
      followingCount: followings?.totalItems ?? 0,
      postsCount: (await actor.getOutbox())?.totalItems ?? 0,
      handle,
    });
  const account = await db.query.accounts.findFirst({
    with: { user: true },
    where: eq(schema.accounts.uri, actor.id.href),
  });
  if (account == null) return null;

  return account;
}


export async function updateAccountStats(
  account: { id: Uuid } | { uri: string }
): Promise<void> {
  const id =
    "id" in account
      ? account.id
      : db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.uri, account.uri));

  const followingCount = db
    .select({ cnt: count() })
    .from(schema.follows)
    .where(
      eq(schema.follows.followerId, id),
    );

  const followerCount = db
    .select({ cnt: count() })
    .from(schema.follows)
    .where(
      eq(schema.follows.followerId, id),
    );

  // TODO post count updates
  await db
    .update(schema.accounts)
    .set({
      followersCount: sql`${followerCount}`,
      followingCount: sql`${followingCount}`,
    })
    .where(
      eq(schema.accounts.id, id),
    )
}
