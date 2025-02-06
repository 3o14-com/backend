import {
  count,
  countDistinct,
  eq,
  gt,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { parse } from "semver";
import metadata from "../../package.json" with { type: "json" };
import { db } from "../db/db";
import { users, posts } from "../db/schema";
import { federation } from "./federation";

federation.setNodeInfoDispatcher("/nodeinfo/2.1", async (_ctx) => {
  const version = parse(metadata.version)!;
  const [{ total }] = await db.select({ total: count() }).from(users);
  const [{ activeMonth }] = await db
    .select({ activeMonth: countDistinct(users.id) })
    .from(users)
    .rightJoin(posts, eq(users.id, posts.accountId))
    .where(gt(posts.updated, sql`CURRENT_TIMESTAMP - INTERVAL '1 month'`));
  const [{ activeHalfyear }] = await db
    .select({ activeHalfyear: countDistinct(users.id) })
    .from(users)
    .rightJoin(posts, eq(users.id, posts.accountId))
    .where(gt(posts.updated, sql`CURRENT_TIMESTAMP - INTERVAL '6 months'`));
  const [{ localPosts }] = await db
    .select({ localPosts: countDistinct(posts.id) })
    .from(posts)
    .rightJoin(users, eq(posts.accountId, users.id))
    .where(isNull(posts.replyTargetId));
  const [{ localComments }] = await db
    .select({ localComments: countDistinct(posts.id) })
    .from(posts)
    .rightJoin(users, eq(posts.accountId, users.id))
    .where(isNotNull(posts.replyTargetId));
  return {
    software: {
      name: "3o14",
      version: {
        major: version.major,
        minor: version.minor,
        patch: version.patch,
        build: version.build == null ? undefined : [...version.build],
        prerelease:
          version.prerelease == null ? undefined : [...version.prerelease],
      },
      homepage: new URL("https://github.com/3o14-com/backend"),
      repository: new URL("https://github.com/3o14-com/backend"),
    },
    protocols: ["activitypub"],
    services: {
      outbound: ["atom1.0"],
    },
    usage: {
      users: {
        total,
        activeMonth,
        activeHalfyear,
      },
      localComments,
      localPosts,
    },
  };
});

// cSpell: ignore halfyear
