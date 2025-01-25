import { eq } from "drizzle-orm";
import db from "../db/db";
import federation from "./federation";
import { users } from "../db/schema";
import { Endpoints, importJwk, Person } from "@fedify/fedify";

federation.setActorDispatcher("/users/@{identifier}", async (ctx, identifier) => {
  const user = await db.query.users.findFirst({
    where: eq(users.username, identifier),
    with: { account: true }
  });
  if (user == null) return null;
  const account = user.account;
  return new Person({
    id: ctx.getActorUri(identifier),
    name: account.preferredName,
    preferredUsername: identifier,
    summary: account.bio,
    url: account.url ? new URL(account.url) : null,
    publicKey: (await ctx.getActorKeyPairs(identifier))[0].cryptographicKey,
    assertionMethods: (await ctx.getActorKeyPairs(identifier)).map(
      (pair) => pair.multikey,
    ),
    followers: ctx.getFollowersUri(identifier),
    following: ctx.getFollowingUri(identifier),
    // outbox: ctx.getOutboxUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(),
    }),
  })
})
  .mapHandle((_, handle) => handle)
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = await db.query.users.findFirst({
      where: eq(users.username, identifier),
      with: { account: true }
    });
    if (user == null) return [];
    const account = user.account;
    if (account.ed25519PrivateKey == null || account.rsaPrivateKey == null) return [];
    return [
      {
        privateKey: await importJwk(account.rsaPrivateKey, "private"),
        publicKey: await importJwk(account.rsaPublicKey, "public"),
      },
      {
        privateKey: await importJwk(account.ed25519PrivateKey, "private"),
        publicKey: await importJwk(account.rsaPublicKey, "public"),
      }
    ];
  });

federation
  .setFollowersDispatcher("/users/@{identifier}/followers", async (_ctx, _identifier) => {
    return null
  })

federation
  .setFollowingDispatcher("/users/@{identifier}/following", async (_ctx, _identifier) => {
    return null
  })
