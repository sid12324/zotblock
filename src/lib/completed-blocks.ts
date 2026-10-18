import { z } from "zod";

const completionKey = z.string().min(1).max(500);
export const completedBlocksSchema = z.array(completionKey).max(2_000);

/** A regenerated block with a new start time is a different session. */
export function studyBlockCompletionKey(block: { id: string; start: { dateTime: string } }) {
  return `${block.id}@${block.start.dateTime}`;
}

export function toggleCompletedBlock(keys: readonly string[], key: string) {
  const next = keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key];
  return completedBlocksSchema.parse(next);
}
