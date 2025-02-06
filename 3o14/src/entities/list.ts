import type { List } from "../db/schema";

export function serializeList(list: List) {
  return {
    id: list.id,
    title: list.title,
    replies_policy: list.repliesPolicy,
    exclusive: list.exclusive,
  };
}
