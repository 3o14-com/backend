import { Create, Note } from "@fedify/fedify";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/db";
import { serializePoll } from "../../entities/poll";
import { federation } from "../../federation";
import { toUpdate } from "../../federation/post";
import { type Variables, scopeRequired, tokenRequired } from "../../middlewares/oauth";
import { pollOptions, pollVotes, polls } from "../../db/schema";
import { isUuid } from "../../utils/uuid";

const app = new Hono<{ Variables: Variables }>();

app.get("/:id", tokenRequired, scopeRequired(["read:statuses"]), async (c) => {
  const pollId = c.req.param("id");
  if (!isUuid(pollId)) return c.json({ error: "Record not found" }, 404);
  const user = c.get("token").user;
  if (user == null) return c.json({ error: "Unauthorized" }, 401);
  const poll = await db.query.polls.findFirst({
    with: {
      options: { orderBy: pollOptions.index },
      votes: { where: eq(pollVotes.accountId, user.account.id) },
    },
    where: eq(polls.id, pollId),
  });
  if (poll == null) return c.json({ error: "Record not found" }, 404);
  return c.json(serializePoll(poll, user));
});

app.post(
  "/:id/votes",
  tokenRequired,
  scopeRequired(["write:statuses"]),
  zValidator(
    "json",
    z.object({
      choices: z.array(
        z.union([
          z.number().int(),
          z
            .string()
            .regex(/^\d+$/)
            .transform((s) => Number.parseInt(s)),
        ]),
      ),
    }),
  ),
  async (c) => {
    const pollId = c.req.param("id");
    if (!isUuid(pollId)) return c.json({ error: "Record not found" }, 404);
    const user = c.get("token").user;
    if (user == null) {
      return c.json({ error: "The access token is invalid" }, 401);
    }
    const choices = c.req.valid("json").choices;
    let poll = await db.query.polls.findFirst({
      with: {
        options: true,
        votes: {
          with: { account: true },
          where: eq(pollVotes.accountId, user.account.id),
        },
        post: {
          with: {
            account: { with: { user: true } },
            replyTarget: true,
            quoteTarget: true,
            media: true,
            mentions: { with: { account: true } },
            replies: true,
          },
        },
      },
      where: eq(polls.id, pollId),
    });
    if (poll == null) return c.json({ error: "Record not found" }, 404);
    if (poll.expires <= new Date()) {
      return c.json(
        { error: "Validation failed: The poll has already ended" },
        422,
      );
    }
    if (poll.votes.length > 0) {
      return c.json(
        { error: "Validation failed: You have already voted on this poll" },
        422,
      );
    }
    if (!poll.multiple && choices.length > 1) {
      return c.json(
        { error: "Validation failed: This poll does not allow multiple votes" },
        422,
      );
    }
    if (choices.length < 1) {
      return c.json(
        { error: "Validation failed: You must select at least one option" },
        422,
      );
    }
    await db.transaction(async (tx) => {
      await tx.insert(pollVotes).values(
        choices.map((choice) => ({
          accountId: user.account.id,
          pollId: poll!.id,
          optionIndex: choice,
        })),
      );
      await tx
        .update(pollOptions)
        .set({
          votesCount: sql`${pollOptions.votesCount} + 1`,
        })
        .where(
          and(
            eq(pollOptions.pollId, poll!.id),
            inArray(pollOptions.index, choices),
          ),
        );
      await tx
        .update(polls)
        .set({
          votersCount: sql`${polls.votersCount} + 1`,
        })
        .where(eq(polls.id, poll!.id));
    });
    poll = await db.query.polls.findFirst({
      with: {
        options: true,
        votes: {
          with: { account: true },
          where: eq(pollVotes.accountId, user.account.id),
        },
        post: {
          with: {
            account: { with: { user: true } },
            replyTarget: true,
            quoteTarget: true,
            media: true,
            mentions: { with: { account: true } },
            replies: true,
          },
        },
      },
      where: eq(polls.id, pollId),
    });
    if (poll == null) throw new Error("Record not found");
    const fedCtx = federation.createContext(c.req.raw, undefined);
    if (poll.post.account.user == null) {
      for (const choice of choices) {
        await fedCtx.sendActivity(
          user,
          [
            {
              id: new URL(poll.post.account.uri),
              inboxId: new URL(poll.post.account.inboxUrl),
            },
          ],
          new Create({
            id: new URL(
              `#votes/${poll.id}/${choice}/activity`,
              user.account.uri,
            ),
            actor: new URL(user.account.uri),
            to: new URL(poll.post.account.uri),
            object: new Note({
              id: new URL(`#votes/${poll.id}/${choice}`, user.account.uri),
              name: poll.options[choice].title,
              attribution: new URL(user.account.uri),
              replyTarget: new URL(poll.post.uri),
              to: new URL(poll.post.account.uri),
            }),
          }),
          {
            excludeBaseUris: [new URL(c.req.url)],
          },
        );
      }
    } else {
      await fedCtx.sendActivity(
        poll.post.account.user,
        poll.votes.map((v) => ({
          id: new URL(v.account.uri),
          inboxId: new URL(v.account.inboxUrl),
          endpoints:
            v.account.sharedInboxUrl == null
              ? null
              : {
                sharedInbox: new URL(v.account.sharedInboxUrl),
              },
        })),
        toUpdate({ ...poll.post, poll }, fedCtx),
        { excludeBaseUris: [new URL(c.req.url)] },
      );
    }
    return c.json(serializePoll(poll, user));
  },
);

export default app;
