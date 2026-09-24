/**
 * Topic prompt construction and output validation.
 *
 * The prompt carries only the user messages the naming decision already used:
 * tool output, assistant text, and every other session entry stay out of it.
 * Generated text is normalized and validated before it can become a name, so an
 * unusable response leaves the session unnamed instead of storing junk.
 */
/** Upper bound for an accepted topic, in code points. */
export const TOPIC_MAX_LENGTH = 30;
/** Relevant user messages sent to the topic model: the first and the second. */
export const MAX_CONTEXT_MESSAGES = 2;
/** Per-message bound, in code points, so a pasted blob cannot dominate the prompt. */
export const MAX_CONTEXT_CHARS = 500;

const INSTRUCTIONS = [
  // biome-ignore lint/security/noSecrets: prompt prose, not a credential
  "你是会话命名助手。阅读下面的用户消息，概括这次会话的主题。",
  "",
  "要求：",
  // biome-ignore lint/security/noSecrets: prompt prose, not a credential
  "- 只输出主题本身：简体中文，不超过 20 个字",
  "- 不要解释、不要引号、不要 Markdown、不要换行、不要序号",
  "- 不要复述消息原文",
].join("\n");

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const MARKDOWN = /[*#`]/;
const LIST_PREFIX = /^[-+]\s|^\d+[.)、]/;
const WRAPPING = /^[\s"'“”‘’「」`*#]+|[\s"'“”‘’「」`*#]+$/g;

/**
 * Only the first `MAX_CONTEXT_MESSAGES` completed user messages are relevant:
 * naming is decided on the first turn, or on the second when the first was
 * trivial, so later turns never change the topic.
 */
export function buildTopicPrompt(userTexts: readonly string[]): string {
  const relevant = userTexts
    .slice(0, MAX_CONTEXT_MESSAGES)
    .map(boundContext)
    .filter((text) => text.length > 0);
  if (relevant.length === 0) {
    return INSTRUCTIONS;
  }
  const numbered = relevant.map((text, index) => `${index + 1}. ${text}`).join("\n");
  return `${INSTRUCTIONS}\n\n用户消息：\n${numbered}`;
}

/** Valid topic, or `undefined` when the response cannot be used as a name. */
export function normalizeTopic(raw: string): string | undefined {
  const stripped = raw.replace(WRAPPING, "").trim();
  if (stripped.length === 0) {
    return undefined;
  }
  if (stripped.includes("\n") || stripped.includes("\r")) {
    return undefined;
  }
  if (
    [
      ...stripped,
    ].length > TOPIC_MAX_LENGTH
  ) {
    return undefined;
  }
  // A model answering in another language, or refusing, is not a topic.
  if (!CJK.test(stripped)) {
    return undefined;
  }
  if (MARKDOWN.test(stripped) || LIST_PREFIX.test(stripped)) {
    return undefined;
  }
  return stripped;
}

function boundContext(text: string): string {
  return [
    ...text.replace(/\s+/g, " ").trim(),
  ]
    .slice(0, MAX_CONTEXT_CHARS)
    .join("");
}
