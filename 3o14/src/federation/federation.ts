
import { ParallelMessageQueue, createFederation } from "@fedify/fedify";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import { postgres } from "../db/db";
import metadata from "../../package.json" with { type: "json" };
// const logger = getLogger("3o14");

const db_url = Bun.env["DATABASE_URL"];
if (db_url == undefined) throw new Error("DATABASE_URL must be defined");

export const federation = createFederation<void>({
  kv: new PostgresKvStore(postgres),
  queue: new ParallelMessageQueue(new PostgresMessageQueue(postgres), 10),
  userAgent: {
    software: `3o14/${metadata.version}`,
  },
});

export default federation;
