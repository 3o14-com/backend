import { createFederation, Person } from "@fedify/fedify";
// import { getLogger } from "@logtape/logtape";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";

// const logger = getLogger("3o14");

const db_url = Bun.env["DATABASE_URL"];
if (db_url == undefined) throw new Error("DATABASE_URL must be defined");

const federation = createFederation({
  kv: new PostgresKvStore(postgres(db_url)),
  queue: new PostgresMessageQueue(postgres(db_url)),
});

federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: identifier,
    });
  },
);

export default federation;
