import { Hono } from "hono";
import metadata from "../../../package.json" with { type: "json" };
import { db } from "../../db/db";
import { users } from "../../db/schema";

const app = new Hono();

app.get("/", async (c) => {
  const url = new URL(c.req.url);
  const user = await db.query.users.findFirst({
    with: { account: { with: { successor: true } } },
    orderBy: users.id,
  });
  if (user == null) return c.notFound();
  return c.json({
    uri: url.host,
    title: url.host,
    short_description: `A 3o14 instance at ${url.host}`,
    description: `A 3o14 instance at ${url.host}`,
    // email: user.email,
    version: metadata.version,
    urls: {}, // TODO
    stats: {
      user_count: 0, // TODO
      status_count: 0, // TODO
      domain_count: 0, // TODO
    },
    thumbnail: null, // TODO
    registrations: true,
    approval_required: false,
    invites_enabled: false,
    configuration: {
      statuses: {
        // TODO
        max_characters: 4096,
        max_media_attachments: 8,
        characters_reserved_per_url: 256,
      },
      media_attachments: {
        supported_mime_types: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "video/mp4",
          "video/webm",
        ],
        image_size_limit: 1024 * 1024 * 32, // 32MiB
        image_matrix_limit: 16_777_216,
        // TODO
        video_size_limit: 1024 * 1024 * 128, // 128MiB
        video_frame_rate_limit: 120,
        video_matrix_limit: 16_777_216,
      },
      polls: {
        max_options: 10,
        max_characters_per_option: 100,
        min_expiration: 60 * 5,
        max_expiration: 60 * 60 * 24 * 14,
      },
    },
    // contact_account: serializeUser(user, c.req.url), // TODO
    rules: [],
    feature_quote: true,
    fedibird_capabilities: [
      "emoji_reaction",
      "enable_wide_emoji",
      "enable_wide_emoji_reaction",
    ],
  });
});

export default app;
