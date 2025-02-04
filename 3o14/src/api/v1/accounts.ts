import { Hono } from "hono";
import { scopeRequired, tokenRequired, type Variables } from "../../middlewares/oauth";
import { serializeAccount, serializeUser } from "../../entities/accounts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { accounts, type Account, type User } from "../../db/schema";
import db from "../../db/db";
import { eq } from "drizzle-orm";
import federation from "../../federation";
import { isActor, lookupObject } from "@fedify/fedify";
import { persistAccount } from "../../federation/account";

const app = new Hono<{ Variables: Variables }>();

app.get(
  "/verify_credentials",
  tokenRequired,
  scopeRequired(["read:accounts"]),
  async (c) => {
    const user = c.get('token').user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticed user" },
        422,
      );
    }
    c.res.headers.set('Content-Type', 'application/json')
    return c.json(serializeUser(user, c.req.url))
  }
)


app.get(
  "/lookup",
  zValidator(
    "query",
    z.object({
      acct: z.string(),
      skip_webfinger: z.enum(["true", "false"]).default("true"),
    }),
  ),
  async (c) => {
    const user = c.get("token")?.user;
    const query = c.req.valid("query");
    const acct = query.acct;
    let account:
      | (Account & {
        user: User | null;
      })
      | null =
      await (db.query.accounts.findFirst({
        where: eq(
          accounts.handle,
          acct.includes("@")
            ? `@${acct}`
            // : `@${acct}@${new URL(c.req.url).host}`,
            : `@${acct}@3o14.com`, // TODO WARN
        ),
        with: { user: true },
      })) ?? null;
    console.log(`acct: ${acct}`);
    if (account == null) {
      if (query.skip_webfinger !== "false") {
        console.log("test");
        return c.json({ error: "Record not found" }, 404);
      }
      const fedCtx = federation.createContext(c.req.raw, undefined);
      const options =
        user == null
          ? fedCtx
          : {
            contextLoader: fedCtx.contextLoader,
            documentLoader: await fedCtx.getDocumentLoader({
              username: user.username,
            }),
          };
      const actor = await lookupObject(acct, options);
      if (!isActor(actor)) return c.json({ error: "Record not found" }, 404);
      const loaded = await persistAccount(actor);
      if (loaded != null) {
        account = {
          ...loaded,
          user: null,
        };
      }
    }
    if (account == null) {
      return c.json({ error: "Record not found" }, 404);
    }
    if (account.user == null) {
      return c.json(serializeAccount(account, c.req.url));
    }
    return c.json(
      serializeUser({ ...account.user, account }, c.req.url),
    );
  },
)


export default app;
