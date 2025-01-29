import type { Account, User } from "../db/schema";


export function serializeAccount(
  account: Account,
  baseUrl: URL | string,
): Record<string, unknown> {
  // biome-ignore lint/style/noParameterAssign: make sure the URL is a URL
  baseUrl = new URL(baseUrl);
  const username = account.handle.replaceAll(/(?:^@)|(?:@[^@]+$)/g, "");
  // const defaultAvatarUrl = new URL(
  //   "/image/avatars/original/missing.png",
  //   baseUrl,
  // ).href;
  // const defaultHeaderUrl = new URL(
  //   "/image/headers/original/missing.png",
  //   baseUrl,
  // ).href;
  let acct = account.handle.replace(/^@/, "");
  if (acct.endsWith(`@${baseUrl.host}`)) {
    acct = acct.replace(/@[^@]+$/, "");
  }
  return {
    id: account.id,
    username,
    acct,
    display_name: account.preferredName,
    // locked: account.protected,
    // bot: account.type === "Application" || account.type === "Service",
    created_at: account.createdAt ?? account.updatedAt,
    note: account.bio ?? "",
    url: account.url ?? account.uri,
    // avatar: account.avatarUrl ?? defaultAvatarUrl,
    // avatar_static: account.avatarUrl ?? defaultAvatarUrl,
    // header: account.coverUrl ?? defaultHeaderUrl,
    // header_static: account.coverUrl ?? defaultHeaderUrl,
    followers_count: account.followersCount,
    following_count: account.followingCount,
    statuses_count: account.postsCount,
    // moved:
    //   account.successor == null
    //     ? null
    //     : serializeAccount({ ...account.successor, successor: null }, baseUrl),
    last_status_at: null,
    // emojis: serializeEmojis(account.emojis),
    // fields: Object.entries(account.fe).map(([name, value]) => ({
    //   name,
    //   value,
    //   verified_at: null,
    // })),
  };
}

export function serializeUser(
  user: User & {
    account: Account;
  },
  baseUrl: URL | string,
): Record<string, unknown> {
  return {
    ...serializeAccount(user.account, baseUrl),
    discoverable: true, // TODO discoverable field in db
    source: user && {
      note: user.account.bio ?? "",
      privacy: user.visibility,
      // sensitive: accountOwner.account.sensitive,
      // language: accountOwner.language,
      follow_requests_count: 0,
      // fields: Object.entries(accountOwner.fields).map(([name, value]) => ({
      //   name,
      //   value,
      //   verified_at: null,
      // })),
    },
  };
}
