import { Activity, Follow, Undo } from "@fedify/fedify";
import "./actor";

import { getLogger } from "@logtape/logtape";
import { federation } from "./federation";
import { onFollow, onUnFollow } from "./inbox/follow";
export { federation } from "./federation";


const logger = getLogger(["3o14", "fedi", "inbox"]);

federation
  .setInboxListeners("/@{identifier}/inbox", "/inbox")
  .on(Follow, onFollow)
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    if (
      object instanceof Activity &&
      object.actorId?.href != undo.actorId?.href
    ) {
      return;
    }

    if (object instanceof Follow) {
      await onUnFollow(ctx, undo);
    } else {
      logger.debug("Unsupported object on Undo: {object}", { object });
    }
  })

export default federation;
