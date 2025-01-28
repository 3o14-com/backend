import { createMiddleware } from "hono/factory";
import { accessTokens, type AccessToken, type Account, type Application, type Scope, type User } from "../db/schema"
import { base64 } from "@hexagon/base64";
import db from "../db/db";
import { eq } from "drizzle-orm";

export type Variables = {
  token: AccessToken & {
    application: Application;
    user:
    | (User & { account: Account })
    | null;
  };
};

export const SECRET_KEY = Bun.env['SECRET_KEY'];
if (SECRET_KEY == null) throw new Error("SECRET_KEY is required");

export const tokenRequired = createMiddleware(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (authorization == null) return c.json({ error: "unauthorized" }, 401);
  const match = /^(?:bearer|token)\s+(.+)$/i.exec(authorization);
  if (match == null) return c.json({ error: "unauthorized" }, 401);
  const token = match[1];
  let tokenCode: string;
  if (token.includes("^")) {
    // authorization code
    const values = token.split("^");
    if (values.length !== 3) return c.json({ error: "invalid_token" }, 401);
    const [signature, created, code] = values;
    const textEncoder = new TextEncoder();
    const sig = base64.toArrayBuffer(signature, true);
    const secretKey = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(SECRET_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "HMAC", hash: "SHA-256" },
      secretKey,
      sig,
      textEncoder.encode(`${created}^${code}`),
    );
    if (!verified) return c.json({ error: "invalid_token" }, 401);
    tokenCode = code;
  } else {
    // client credentials
    tokenCode = token;
  }
  const accessToken = await db.query.accessTokens.findFirst({
    where: eq(accessTokens.code, tokenCode),
    with: {
      user: { with: { account: true } },
      application: true,
    },
  });
  if (accessToken == null) return c.json({ error: "invalid_token" }, 401);
  c.set("token", accessToken);
  await next();
});

export function scopeRequired(scopes: Scope[]) {
  return createMiddleware(async (c, next) => {
    const token = c.get("token");
    if (
      !scopes.some(
        (s) =>
          token.scopes.includes(s) ||
          token.scopes.includes(s.replace(/:[^:]+$/, "")) ||
          ([
            "read:blocks",
            "write:blocks",
            "read:follows",
            "write:follows",
            "read:mutes",
            "write:mutes",
          ].includes(s) &&
            token.scopes.includes("follow")),
      )
    ) {
      return c.json({ error: "insufficient_scope" }, 403);
    }
    await next();
  });
}
