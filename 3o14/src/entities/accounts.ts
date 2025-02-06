import type { Account, User, Block, Follow, Mute } from "../db/schema";
import type { Uuid } from "../utils/uuid";

export function serializeAccount(
  account: Account & { successor: Account | null },
  baseUrl: URL | string,
): Record<string, unknown> {
  // biome-ignore lint/style/noParameterAssign: make sure the URL is a URL
  baseUrl = new URL(baseUrl);
  const username = account.handle.replaceAll(/(?:^@)|(?:@[^@]+$)/g, "");
  const defaultAvatarUrl = new URL(
    "/image/avatars/original/missing.png",
    baseUrl,
  ).href;
  const defaultHeaderUrl = new URL(
    "/image/headers/original/missing.png",
    baseUrl,
  ).href;
  let acct = account.handle.replace(/^@/, "");
  if (acct.endsWith(`@${baseUrl.host}`)) {
    acct = acct.replace(/@[^@]+$/, "");
  }
  return {
    id: account.id,
    username,
    acct,
    display_name: account.name,
    locked: account.protected,
    bot: false, //account.type === "Application" || account.type === "Service",
    created_at: account.createdAt,
    note: account.bio,
    url: account.url ?? account.uri,
    avatar: account.avatarurl ?? defaultAvatarUrl,
    avatar_static: account.avatarurl ?? defaultAvatarUrl,
    header: account.coverurl ?? defaultHeaderUrl,
    header_static: account.coverurl ?? defaultHeaderUrl,
    followers_count: account.followersCount,
    following_count: account.followingCount,
    statuses_count: account.postsCount,
    moved:
      account.successor == null
        ? null
        : serializeAccount({ ...account.successor, successor: null }, baseUrl),
    last_status_at: null,
    fields: Object.entries(account.fieldHtmls).map(([name, value]) => ({
      name,
      value,
      verified_at: null,
    })),
  };
}

export function serializeUser(
  user: User & {
    account: Account & { successor: Account | null };
  },
  baseUrl: URL | string,
): Record<string, unknown> {
  return {
    ...serializeAccount(user.account, baseUrl),
    discoverable: user.discoverable,
    source: user && {
      note: user.account.bio,
      privacy: user.visibility,
      sensitive: user.account.sensitive,
      follow_requests_count: 0,
    },
  };
}

export function serializeRelationship(
  account: Account & {
    followers: Follow[];
    following: Follow[];
    mutedBy: Mute[];
    blocks: Block[];
    blockedBy: Block[];
  },
  currentAccountOwner: { id: Uuid },
): Record<string, unknown> {
  const following = account.followers.find(
    (f) => f.followerId === currentAccountOwner.id,
  );
  const followedBy = account.following.find(
    (f) => f.followingId === currentAccountOwner.id,
  );
  const now = Date.now();
  const muting = account.mutedBy.find((m) => {
    if (m.accountId !== currentAccountOwner.id) return false;
    if (m.duration == null) return true;
    let d = +new Date(`1970-01-01T${m.duration.replace(/^-/, "")}Z`);
    if (m.duration.startsWith("-")) d = -d;
    return d <= 0 || now < m.created.getTime() + d;
  });
  return {
    id: account.id,
    following: following?.approved != null,
    showing_reblogs: following?.shares === true,
    notifying: following?.notify === true,
    followed_by: followedBy?.approved != null,
    blocking: account.blockedBy.some(
      (b) => b.accountId === currentAccountOwner.id,
    ),
    blocked_by: account.blocks.some(
      (b) => b.blockedAccountId === currentAccountOwner.id,
    ),
    muting: muting != null,
    muting_notifications: muting?.notifications === true,
    requested: following != null && following.approved == null,
    requested_by: followedBy != null && followedBy.approved == null,
    domain_blocking: false, // TODO
    endorsed: false, // TODO
    note: "", // TODO
  };
}
