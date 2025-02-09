import { Accept, Activity, Add, Announce, Block, Create, Delete, Follow, isActor, Like, Move, Note, Reject, Remove, Undo, Update } from "@fedify/fedify";
import "./actor";
import "./nodeinfo";
import "./objects";

import { getLogger } from "@logtape/logtape";
import { federation } from "./federation";
export { federation } from "./federation";

import {
  onAccountDeleted,
  onAccountMoved,
  onAccountUpdated,
  onBlocked,
  onFollowAccepted,
  onFollowRejected,
  onFollowed,
  onLiked,
  onPostCreated,
  onPostDeleted,
  onPostPinned,
  onPostShared,
  onPostUnpinned,
  onPostUnshared,
  onPostUpdated,
  onUnblocked,
  onUnfollowed,
  onUnliked,
  onVoted,
} from "./inbox";
import { isPost } from "./post";
import db from "../db/db";

const logger = getLogger(["3o14", "fedi", "inbox"]);


federation
  .setInboxListeners("/@{identifier}/inbox", "/inbox")
  .setSharedKeyDispatcher(async (_) => {
    const anyUser = await db.query.accounts.findFirst({
      with: { user: true },
    });
    return anyUser ?? null;
  })
  .on(Follow, onFollowed)
  .on(Accept, onFollowAccepted)
  .on(Reject, onFollowRejected)
  .on(Create, async (ctx, create) => {
    const object = await create.getObject();
    if (
      object instanceof Note &&
      object.replyTargetId != null &&
      object.attributionId != null &&
      object.name != null
    ) {
      await onVoted(ctx, create);
    } else if (isPost(object)) {
      await onPostCreated(ctx, create);
    } else {
      logger.debug("Unsupported object on Create: {object}", { object });
    }
  })
  .on(Like, onLiked)
  .on(Announce, async (ctx, announce) => {
    const object = await announce.getObject();
    if (isPost(object)) {
      await onPostShared(ctx, announce);
    } else {
      logger.debug("Unsupported object on Announce: {object}", { object });
    }
  })
  .on(Update, async (ctx, update) => {
    const object = await update.getObject();
    if (isActor(object)) {
      await onAccountUpdated(ctx, update);
    } else if (isPost(object)) {
      await onPostUpdated(ctx, update);
    } else {
      logger.debug("Unsupported object on Update: {object}", { object });
    }
  })
  .on(Delete, async (ctx, del) => {
    const actorId = del.actorId;
    const objectId = del.objectId;
    if (actorId == null || objectId == null) return;
    if (objectId.href === actorId.href) {
      await onAccountDeleted(ctx, del);
    } else {
      await onPostDeleted(ctx, del);
    }
  })
  .on(Add, onPostPinned)
  .on(Remove, onPostUnpinned)
  .on(Block, onBlocked)
  .on(Move, onAccountMoved)
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    if (
      object instanceof Activity &&
      object.actorId?.href !== undo.actorId?.href
    ) {
      return;
    }
    if (object instanceof Follow) {
      await onUnfollowed(ctx, undo);
    } else if (object instanceof Block) {
      await onUnblocked(ctx, undo);
    } else if (object instanceof Like) {
      await onUnliked(ctx, undo);
    } else if (object instanceof Announce) {
      await onPostUnshared(ctx, undo);
    } else {
      logger.debug("Unsupported object on Undo: {object}", { object });
    }
  });

export default federation;
