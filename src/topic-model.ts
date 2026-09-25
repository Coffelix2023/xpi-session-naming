/**
 * Topic-model adapter: exactly one isolated completion on the configured topic
 * model, defaulting to `mimo-v2.6-flash`.
 *
 * Invocation path: `ctx.modelRegistry.streamSimple()` — the provider-neutral
 * nested-call path documented in Pi's extension guide. No subprocess, so there
 * is no credential inheritance, no extension reload recursion, and no stdout to
 * parse; the registry resolves request-time auth on its own.
 *
 * The topic model is passed explicitly and this module never touches the
 * session's active model, so generating a topic cannot change the model that
 * serves the conversation.
 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { TopicModelPreference } from "./topic-model-config.ts";
export const TOPIC_MODEL_ID = "mimo-v2.6-flash";
/** MIMO is this model's native endpoint; other providers are only a fallback. */
export const TOPIC_MODEL_PROVIDERS = [
  "MIMO",
] as const;
export const TOPIC_TIMEOUT_MS = 15_000;
/** Hard cap on the returned topic, in Unicode code points. */
export const TOPIC_MAX_CHARS = 120;

/** Registry surface the adapter needs; satisfied by `ctx.modelRegistry`. */
export type TopicModelRegistry = Pick<
  ModelRegistry,
  "find" | "getAvailable" | "hasConfiguredAuth" | "streamSimple"
>;

export interface GenerateTopicOptions {
  /** User-selected model; ignored when it cannot be resolved or has no auth. */
  preference?: TopicModelPreference;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The user's choice first — but only when that provider exists and has
 * configured auth. Otherwise the built-in chain: preferred provider first,
 * then any configured provider exposing the same model id. `undefined` means
 * "no usable topic model": the caller leaves the session unnamed instead of
 * failing the turn.
 */
export function resolveTopicModel(
  registry: TopicModelRegistry,
  preference?: TopicModelPreference,
): Model<Api> | undefined {
  if (preference) {
    const chosen = registry.find(preference.provider, preference.id);
    if (chosen && registry.hasConfiguredAuth(chosen)) {
      return chosen;
    }
  }
  for (const provider of TOPIC_MODEL_PROVIDERS) {
    const model = registry.find(provider, TOPIC_MODEL_ID);
    if (model && registry.hasConfiguredAuth(model)) {
      return model;
    }
  }
  return registry.getAvailable().find((model) => model.id === TOPIC_MODEL_ID);
}

/**
 * One bounded completion, or `undefined` on any failure. Never throws, and
 * never logs: naming stays isolated from the primary conversation.
 */
export async function generateTopic(
  registry: TopicModelRegistry,
  context: Context,
  options: GenerateTopicOptions = {},
): Promise<string | undefined> {
  const model = resolveTopicModel(registry, options.preference);
  if (!model) {
    return undefined;
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? TOPIC_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        timeout,
      ])
    : timeout;
  try {
    const message = await registry
      .streamSimple(model, context, {
        signal,
      })
      .result();
    // Setup failures such as an unknown provider or unconfigured auth settle
    // as an error message here instead of rejecting, so the stop reason, not
    // the promise, is what reports failure.
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return undefined;
    }
    const text = textOf(message).trim();
    if (text.length === 0) {
      return undefined;
    }
    return [
      ...text,
    ]
      .slice(0, TOPIC_MAX_CHARS)
      .join("");
  } catch {
    return undefined;
  }
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}
