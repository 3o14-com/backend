import { Accept, isActor, type Follow, type InboxContext } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import db from "../../db/db";
import { accounts, follows } from "../../db/schema";
import { eq } from "drizzle-orm";
import { persistAccount, updateAccountStats } from "../account";

const logger = getLogger(["3o14", "fedi", "inbox", "follow"]);

export async function onFollow(
  ctx: InboxContext<void>,
  follow: Follow
): Promise<void> {
  if (follow.id == null) return;
  const actor = await follow.getActor();
  if (!isActor(actor) || actor.id == null) {
    logger.debug("Invalid actor: {actor}", { actor });
    return;
  }
  const object = await follow.getObject();
  if (!isActor(object) || object.id == null) {
    logger.debug("Invalid object: {object}", { object });
    return;
  }
  const sender = ctx.parseUri(follow.objectId);
  if (sender == null || sender.type !== "actor") {
    logger.debug("The Follow object is not an actor: {follow}", { follow });
    return;
  }
  const following = await db.query.accounts.findFirst({
    where: eq(accounts.uri, object.id.href),
    with: { user: true },
  });

  if (following?.user == null) {
    logger.debug("invalid following: {following}", { following });
    return;
  }

  const follower = await persistAccount(actor);
  if (follower == null) return;

  await db
    .insert(follows)
    .values({
      uri: follow.id.href,
      followerId: follower.id,
      followingId: following.id,
    });

  const accept = new Accept({
    actor: object.id,
    to: follow.actorId,
    object: follow,
    id: new URL(
      `#accepts/${follower.uri}`,
      ctx.getActorUri(following.handle),
    ),
  });
  await ctx.sendActivity(sender, actor, accept);
  await updateAccountStats({ id: following.id });
}
