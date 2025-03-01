import {
  Delete,
  PUBLIC_COLLECTION,
  type Recipient,
  Update,
  exportJwk,
  generateCryptoKeyPair,
} from "@fedify/fedify";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { AccountForm } from "../components/AccountForm.tsx";
import { AccountList } from "../components/AccountList.tsx";
import { DashboardLayout } from "../components/DashboardLayout.tsx";
import {
  NewAccountPage,
  type NewAccountPageProps,
} from "../components/NewAccountPage.tsx";
import db from "../db.ts";
import federation from "../federation";
import { loginRequired } from "../login.ts";
import {
  type Account,
  type AccountOwner,
  type PostVisibility,
  accountOwners,
  accounts as accountsTable,
  follows,
  instances,
} from "../schema.ts";
import { formatText } from "../text.ts";
import { isUuid } from "../uuid.ts";



const accounts = new Hono();

accounts.use(loginRequired);

accounts.get("/", async (c) => {
  const owners = await db.query.accountOwners.findMany({
    with: { account: true },
  });
  return c.html(<AccountListPage accountOwners={owners} />);
});

accounts.post("/", async (c) => {
  const form = await c.req.formData();
  const username = form.get("username")?.toString()?.trim();
  const name = form.get("name")?.toString()?.trim();
  const bio = form.get("bio")?.toString()?.trim();
  const protected_ = form.get("protected") != null;
  const discoverable = form.get("discoverable") != null;
  const language = form.get("language")?.toString()?.trim();
  const visibility = form
    .get("visibility")
    ?.toString()
    ?.trim() as PostVisibility;
  const news = form.get("news") != null;
  if (username == null || username === "" || name == null || name === "") {
    return c.html(
      <NewAccountPage
        values={{
          username,
          name,
          bio,
          protected: protected_,
          discoverable,
          language,
          visibility,
          news,
        }}
        errors={{
          username:
            username == null || username === ""
              ? "Username is required."
              : undefined,
          name:
            name == null || name === ""
              ? "Display name is required."
              : undefined,
        }}
      />,
      400,
    );
  }
  const fedCtx = federation.createContext(c.req.raw, undefined);
  const bioResult = await formatText(db, bio ?? "", fedCtx);
  await db.transaction(async (tx) => {
    await tx
      .insert(instances)
      .values({
        host: fedCtx.host,
        software: "3o14",
        softwareVersion: null,
      })
      .onConflictDoNothing();
    const account = await tx
      .insert(accountsTable)
      .values({
        id: crypto.randomUUID(),
        iri: fedCtx.getActorUri(username).href,
        instanceHost: fedCtx.host,
        type: "Person",
        name,
        handle: `@${username}@${fedCtx.host}`,
        bioHtml: bioResult.html,
        url: fedCtx.getActorUri(username).href,
        protected: protected_,
        inboxUrl: fedCtx.getInboxUri(username).href,
        followersUrl: fedCtx.getFollowersUri(username).href,
        sharedInboxUrl: fedCtx.getInboxUri().href,
        featuredUrl: fedCtx.getFeaturedUri(username).href,
        published: new Date(),
      })
      .returning();
    const rsaKeyPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const ed25519KeyPair = await generateCryptoKeyPair("Ed25519");
    await tx
      .insert(accountOwners)
      .values({
        id: account[0].id,
        handle: username,
        rsaPrivateKeyJwk: await exportJwk(rsaKeyPair.privateKey),
        rsaPublicKeyJwk: await exportJwk(rsaKeyPair.publicKey),
        ed25519PrivateKeyJwk: await exportJwk(ed25519KeyPair.privateKey),
        ed25519PublicKeyJwk: await exportJwk(ed25519KeyPair.publicKey),
        bio: bio ?? "",
        language: language ?? "en",
        visibility: visibility ?? "public",
        discoverable,
      })
  });
  const owners = await db.query.accountOwners.findMany({
    with: { account: true },
  });
  return c.html(<AccountListPage accountOwners={owners} />);
});

interface AccountListPageProps {
  accountOwners: (AccountOwner & { account: Account })[];
}

function AccountListPage({ accountOwners }: AccountListPageProps) {
  return (
    <DashboardLayout title="3o14: Accounts" selectedMenu="accounts">
      <hgroup>
        <h1>Accounts</h1>
        <p>
          You can have more than one account. Each account have its own handle,
          settings, and data, and you can switch between them at any time.
        </p>
      </hgroup>
      <AccountList accountOwners={accountOwners} />
      <a role="button" href="/accounts/new">
        Create a new account
      </a>
    </DashboardLayout>
  );
}

accounts.get("/new", (c) => {
  return c.html(
    <NewAccountPage
      values={{ language: "en", news: true }}
    />,
  );
});

accounts.get("/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!isUuid(accountId)) return c.notFound();
  const accountOwner = await db.query.accountOwners.findFirst({
    where: eq(accountOwners.id, accountId),
    with: { account: true },
  });
  if (accountOwner == null) return c.notFound();
  return c.html(
    <AccountPage
      accountOwner={accountOwner}
    />,
  );
});

interface AccountPageProps extends NewAccountPageProps {
  accountOwner: AccountOwner & { account: Account };
}

function AccountPage(props: AccountPageProps) {
  const username = `@${props.accountOwner.handle}`;
  return (
    <DashboardLayout title={`3o14: Edit ${username}`} selectedMenu="accounts">
      <hgroup>
        <h1>Edit {username}</h1>
        <p>You can edit your account by filling out the form below.</p>
      </hgroup>
      <AccountForm
        action={`/accounts/${props.accountOwner.account.id}`}
        readOnly={{ username: true }}
        values={{
          username: username.replace(/^@/, ""),
          name: props.values?.name ?? props.accountOwner.account.name,
          bio: props.values?.bio ?? props.accountOwner.bio ?? undefined,
          protected:
            props.values?.protected ?? props.accountOwner.account.protected,
          discoverable:
            props.values?.discoverable ?? props.accountOwner.discoverable,
          language: props.values?.language ?? props.accountOwner.language,
          visibility: props.values?.visibility ?? props.accountOwner.visibility,
        }}
        errors={props.errors}
        submitLabel="Save changes"
      />
    </DashboardLayout>
  );
}

accounts.post("/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!isUuid(accountId)) return c.notFound();
  const accountOwner = await db.query.accountOwners.findFirst({
    where: eq(accountOwners.id, accountId),
    with: { account: true },
  });
  if (accountOwner == null) return c.notFound();
  const form = await c.req.formData();
  const name = form.get("name")?.toString()?.trim();
  const bio = form.get("bio")?.toString()?.trim();
  const protected_ = form.get("protected") != null;
  const discoverable = form.get("discoverable") != null;
  const language = form.get("language")?.toString()?.trim();
  const visibility = form
    .get("visibility")
    ?.toString()
    ?.trim() as PostVisibility;
  const news = form.get("news") != null;
  if (name == null || name === "") {
    return c.html(
      <AccountPage
        accountOwner={accountOwner}
        values={{
          name,
          bio,
          language,
          visibility,
          news,
        }}
        errors={{
          name: name == null || name === "" ? "Display name is required." : "",
        }}
      />,
      400,
    );
  }
  const fedCtx = federation.createContext(c.req.raw, undefined);
  const fmtOpts = {
    url: fedCtx.url,
    contextLoader: fedCtx.contextLoader,
    documentLoader: await fedCtx.getDocumentLoader({
      username: accountOwner.handle,
    }),
  };
  const bioResult = await formatText(db, bio ?? "", fmtOpts);
  await db.transaction(async (tx) => {
    await tx
      .update(accountsTable)
      .set({
        name,
        bioHtml: bioResult.html,
        protected: protected_,
      })
      .where(eq(accountsTable.id, accountId));
    await tx
      .update(accountOwners)
      .set({ bio, language, visibility, discoverable })
      .where(eq(accountOwners.id, accountId));
  });
  await fedCtx.sendActivity(
    { username: accountOwner.handle },
    "followers",
    new Update({
      actor: fedCtx.getActorUri(accountOwner.handle),
      object: await fedCtx.getActor(accountOwner.handle),
    }),
    { preferSharedInbox: true, excludeBaseUris: [fedCtx.url] },
  );
  return c.redirect("/accounts");
});

accounts.post("/:id/delete", async (c) => {
  const accountId = c.req.param("id");
  if (!isUuid(accountId)) return c.notFound();
  const accountOwner = await db.query.accountOwners.findFirst({
    where: eq(accountOwners.id, accountId),
  });
  if (accountOwner == null) return c.notFound();
  const fedCtx = federation.createContext(c.req.raw, undefined);
  const activity = new Delete({
    actor: fedCtx.getActorUri(accountOwner.handle),
    to: PUBLIC_COLLECTION,
    object: await fedCtx.getActor(accountOwner.handle),
  });
  await fedCtx.sendActivity(
    { username: accountOwner.handle },
    "followers",
    activity,
    { preferSharedInbox: true, excludeBaseUris: [fedCtx.url] },
  );
  const following = await db.query.follows.findMany({
    with: { following: true },
    where: eq(follows.followerId, accountId),
  });
  await fedCtx.sendActivity(
    { username: accountOwner.handle },
    following.map(
      (f) =>
        ({
          id: new URL(f.following.iri),
          inboxId: new URL(f.following.inboxUrl),
          endpoints:
            f.following.sharedInboxUrl == null
              ? null
              : { sharedInbox: new URL(f.following.sharedInboxUrl) },
        }) satisfies Recipient,
    ),
    activity,
    { preferSharedInbox: true, excludeBaseUris: [fedCtx.url] },
  );
  await db.transaction(async (tx) => {
    await tx.delete(accountOwners).where(eq(accountOwners.id, accountId));
    await tx.delete(accountsTable).where(eq(accountsTable.id, accountId));
  });
  return c.redirect("/accounts");
});


export default accounts;
