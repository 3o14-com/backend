import { eq } from "drizzle-orm";
import {
  type Account,
  type Application,
  type Bookmark,
  bookmarks,
  type Like,
  likes,
  type Medium,
  type Mention,
  type PinnedPost,
  type Poll,
  type PollOption,
  pollOptions,
  type PollVote,
  pollVotes,
  type Post,
  posts,
  type User,
} from "../db/schema";
import type { Uuid } from "../utils/uuid";
import { serializeAccount } from "./accounts";
import { serializeMedium } from "./medium";
import { serializePoll } from "./poll";

export function getPostRelations(userId: Uuid) {
  return {
    account: { with: { user: true, successor: true } },
    application: true,
    replyTarget: true,
    sharing: {
      with: {
        account: { with: { successor: true } },
        application: true,
        replyTarget: true,
        quoteTarget: {
          with: {
            account: { with: { successor: true } },
            application: true,
            replyTarget: true,
            media: true,
            poll: {
              with: {
                options: { orderBy: pollOptions.index },
                votes: { where: eq(pollVotes.accountId, userId) },
              },
            },
            mentions: {
              with: { account: { with: { user: true, successor: true } } },
            },
            likes: { where: eq(likes.accountId, userId) },
            shares: { where: eq(posts.accountId, userId) },
            bookmarks: { where: eq(bookmarks.accountId, userId) },
            pin: true,
          },
        },
        media: true,
        poll: {
          with: {
            options: { orderBy: pollOptions.index },
            votes: { where: eq(pollVotes.accountId, userId) },
          },
        },
        mentions: {
          with: { account: { with: { user: true, successor: true } } },
        },
        likes: { where: eq(likes.accountId, userId) },
        shares: { where: eq(posts.accountId, userId) },
        bookmarks: { where: eq(bookmarks.accountId, userId) },
        pin: true,
      },
    },
    quoteTarget: {
      with: {
        account: { with: { successor: true } },
        application: true,
        replyTarget: true,
        media: true,
        poll: {
          with: {
            options: { orderBy: pollOptions.index },
            votes: { where: eq(pollVotes.accountId, userId) },
          },
        },
        mentions: {
          with: { account: { with: { user: true, successor: true } } },
        },
        likes: { where: eq(likes.accountId, userId) },
        shares: { where: eq(posts.accountId, userId) },
        bookmarks: { where: eq(bookmarks.accountId, userId) },
        pin: true,
      },
    },
    media: true,
    poll: {
      with: {
        options: { orderBy: pollOptions.index },
        votes: { where: eq(pollVotes.accountId, userId) },
      },
    },
    mentions: { with: { account: { with: { user: true, successor: true } } } },
    likes: { where: eq(likes.accountId, userId) },
    shares: { where: eq(posts.accountId, userId) },
    bookmarks: { where: eq(bookmarks.accountId, userId) },
    pin: true,
    replies: true,
  } as const;
}

export function serializePost(
  post: Post & {
    account: Account & { successor: Account | null };
    application: Application | null;
    replyTarget: Post | null;
    sharing:
    | (Post & {
      account: Account & { successor: Account | null };
      application: Application | null;
      replyTarget: Post | null;
      quoteTarget:
      | (Post & {
        account: Account & { successor: Account | null };
        application: Application | null;
        replyTarget: Post | null;
        media: Medium[];
        poll:
        | (Poll & { options: PollOption[]; votes: PollVote[] })
        | null;
        mentions: (Mention & {
          account: Account & {
            user: User | null;
            successor: Account | null;
          };
        })[];
        likes: Like[];
        shares: Post[];
        bookmarks: Bookmark[];
        pin: PinnedPost | null;
      })
      | null;
      media: Medium[];
      poll: (Poll & { options: PollOption[]; votes: PollVote[] }) | null;
      mentions: (Mention & {
        account: Account & {
          user: User | null;
          successor: Account | null;
        };
      })[];
      likes: Like[];
      shares: Post[];
      bookmarks: Bookmark[];
      pin: PinnedPost | null;
    })
    | null;
    quoteTarget:
    | (Post & {
      account: Account & { successor: Account | null };
      application: Application | null;
      replyTarget: Post | null;
      media: Medium[];
      poll: (Poll & { options: PollOption[]; votes: PollVote[] }) | null;
      mentions: (Mention & {
        account: Account & {
          user: User | null;
          successor: Account | null;
        };
      })[];
      likes: Like[];
      shares: Post[];
      bookmarks: Bookmark[];
      pin: PinnedPost | null;
    })
    | null;
    media: Medium[];
    poll: (Poll & { options: PollOption[]; votes: PollVote[] }) | null;
    mentions: (Mention & {
      account: Account & {
        user: User | null;
        successor: Account | null;
      };
    })[];
    likes: Like[];
    shares: Post[];
    bookmarks: Bookmark[];
    pin: PinnedPost | null;
  },
  currentUser: { id: string },
  baseUrl: URL | string,
  // biome-ignore lint/suspicious/noExplicitAny: JSON
): Record<string, any> {
  return {
    id: post.id,
    created_at: post.published ?? post.updated,
    in_reply_to_id: post.replyTargetId,
    in_reply_to_account_id: post.replyTarget?.accountId,
    sensitive: post.sensitive,
    spoiler_text: post.summary ?? "",
    visibility: post.visibility,
    language: post.language,
    uri: post.uri,
    url: post.url ?? post.uri,
    replies_count: post.repliesCount ?? 0,
    reblogs_count: post.sharesCount ?? 0,
    favourites_count: post.likesCount ?? 0,
    favourited: post.likes.some(
      (like) => like.accountId === currentUser.id,
    ),
    reblogged: post.shares.some(
      (share) => share.accountId === currentUser.id,
    ),
    muted: false, // TODO
    bookmarked: post.bookmarks.some(
      (bookmark) => bookmark.accountId === currentUser.id,
    ),
    pinned: post.pin != null && post.pin.accountId === currentUser.id,
    content: post.content ?? "",
    reblog: post.sharing == null ? null : serializePost(
      { ...post.sharing, sharing: null },
      currentUser,
      baseUrl,
    ),
    quote_id: post.quoteTargetId,
    quote: post.quoteTarget == null ? null : serializePost(
      { ...post.quoteTarget, quoteTarget: null, sharing: null },
      currentUser,
      baseUrl,
    ),
    application: post.application == null ? null : {
      name: post.application.name,
      website: post.application.website,
    },
    account: serializeAccount(post.account, baseUrl),
    media_attachments: post.media.map(serializeMedium),
    mentions: post.mentions.map((mention) => ({
      id: mention.accountId,
      username: mention.account.handle.replaceAll(/(?:^@)|(?:@[^@]+$)/g, ""),
      url: mention.account.url,
      acct: mention.account.user == null
        ? mention.account.handle.replace(/^@/, "")
        : mention.account.handle.replaceAll(/(?:^@)|(?:@[^@]+$)/g, ""),
    })),
    tags: Object.entries(post.tags).map(([name, url]) => ({
      name: name.toLowerCase().replace(/^#/, ""),
      url,
    })),
    poll: post.poll == null ? null : serializePoll(post.poll, currentUser),
    filtered: null,
  };
}
