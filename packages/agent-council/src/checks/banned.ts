import { issue, type CheckInput } from "./types";

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function containsPhrase(haystack: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(trimmed)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

/** Account Brain `voice.forbiddenLanguage`: phrases that must never appear. */
export const bannedPhrasesCheck = (input: CheckInput) => {
  const haystack = `${input.text}\n${input.hashtags.join(" ")}`;
  return (input.brain.voice?.forbiddenLanguage ?? [])
    .filter((phrase) => containsPhrase(haystack, phrase))
    .map((phrase) => issue("banned_phrase", `Forbidden language used: "${phrase}"`));
};

/** Account Brain `content.forbiddenTopics`: topics the account never posts about. */
export const forbiddenTopicsCheck = (input: CheckInput) => {
  const haystack = `${input.text}\n${input.hashtags.join(" ")}`;
  return (input.brain.content?.forbiddenTopics ?? [])
    .filter((topic) => containsPhrase(haystack, topic))
    .map((topic) => issue("forbidden_topic", `Forbidden topic mentioned: "${topic}"`));
};
