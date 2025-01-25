import "./actor";

import { federation } from "./federation";
export { federation } from "./federation";

federation
  .setInboxListeners("/@{identifier}/inbox", "/inbox")

export default federation;
