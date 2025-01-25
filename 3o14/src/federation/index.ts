import { Follow } from "@fedify/fedify";
import "./actor";

import { federation } from "./federation";
import { onFollow } from "./inbox/follow";
export { federation } from "./federation";

federation
  .setInboxListeners("/@{identifier}/inbox", "/inbox")
  .on(Follow, onFollow);

export default federation;
