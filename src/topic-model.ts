/**
 * Topic-model adapter: one bounded completion per candidate, in order.
 *
 * The first candidate that answers wins: the stored preference (only while its
 * provider still exists and has configured auth), then the built-in default
 * chain, then the caller's fallback — the primary conversation model, which is
 * provably reachable because it is serving the conversation right now. A failing
 * candidate only moves the attempt to the next one, so a model that went away
 * upstream (a 403 the local registry cannot see) still ends in a name instead of
 * a silent skip.
 *
 * Invocation path: `ctx.modelRegistry.streamSimple()` — the provider-neutral
 * nested-call path documented in Pi's extension guide. No subprocess, so there
 * is no credential inheritance, no extension reload recursion, and no stdout to
 * parse; the registry resolves request-time auth on its own.
 *
 * Candidates are passed in explicitly and this module never touches the
 * session's active model, so generating a topic cannot change the model that
 * serves the conversation.
 *
 * Failures are classified rather than collapsed to `undefined`: the caller has
 * to tell "nothing is configured" apart from "the provider refused this model",
 * because only the second one is worth retrying on another candidate.
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
/** Cap on provider error text echoed into a warning, in Unicode code points. */
export const TOPIC_ERROR_MAX_CHARS = 160;

/** Registry surface the adapter needs; satisfied by `ctx.modelRegistry`. */
export type TopicModelRegistry = Pick<
  ModelRegistry,
  "find" | "getAvailable" | "hasConfiguredAuth" | "streamSimple"
>;

/**
 * Why no topic came back. Only `provider-error` carries text, and it carries the
 * provider's own message — never the prompt, the topic, or any user content.
 */
export type TopicFailure =
  | {
      kind: "no-model";
    }
  | {
      detail: string;
      kind: "provider-error";
    }
  | {
      kind: "timeout";
    }
  | {
      kind: "empty";
    };

export type TopicResult =
  | {
      model: string;
      ok: true;
      text: string;
    }
  | {
      failure: TopicFailure;
      ok: false;
    };

export interface ResolveTopicOptions {
  /** Last resort: the primary conversation model, which is currently reachable. */
  fallback?: Model<Api>;
  /** User-selected model; tried first when it resolves and has configured auth. */
  preference?: TopicModelPreference;
}

export interface GenerateTopicOptions extends ResolveTopicOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Every candidate worth trying, best first and deduplicated.
 *
 * A stored choice wins only while its provider still exists and has configured
 * auth — the same rule the default chain applies, so no branch can hand back an
 * unauthenticated model that would only fail at call time.
 */
export function resolveTopicCandidates(
  registry: TopicModelRegistry,
  options: ResolveTopicOptions = {},
): Model<Api>[] {
  const candidates: Model<Api>[] = [];
  const seen = new Set<string>();
  const add = (model: Model<Api> | undefined): void => {
    if (!model) {
      return;
    }
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(model);
  };

  const preference = options.preference;
  if (preference) {
    const chosen = registry.find(preference.provider, preference.id);
    if (chosen && registry.hasConfiguredAuth(chosen)) {
      add(chosen);
    }
  }
  for (const provider of TOPIC_MODEL_PROVIDERS) {
    const model = registry.find(provider, TOPIC_MODEL_ID);
    if (model && registry.hasConfiguredAuth(model)) {
      add(model);
    }
  }
  add(
    registry
      .getAvailable()
      .find(
        (model) => model.id === TOPIC_MODEL_ID && registry.hasConfiguredAuth(model),
      ),
  );
  add(options.fallback);
  return candidates;
}

/**
 * The single best candidate. The model picker shows this as the current choice,
 * so it deliberately ignores the fallback the naming run would use.
 */
export function resolveTopicModel(
  registry: TopicModelRegistry,
  preference?: TopicModelPreference,
): Model<Api> | undefined {
  return resolveTopicCandidates(registry, {
    preference,
  })[0];
}

/**
 * The first candidate that answers, or the first failure when none does. Never
 * throws on a provider failure: setup problems such as an unknown provider or
 * unconfigured auth settle as an error message, so the stop reason — not the
 * promise — is what reports them.
 */
export async function generateTopic(
  registry: TopicModelRegistry,
  context: Context,
  options: GenerateTopicOptions = {},
): Promise<TopicResult> {
  const candidates = resolveTopicCandidates(registry, options);
  if (candidates.length === 0) {
    return {
      ok: false,
      failure: {
        kind: "no-model",
      },
    };
  }

  // The first failure is kept: it belongs to the best candidate, so it carries
  // the most useful provider message.
  let firstFailure: TopicFailure | undefined;
  for (const model of candidates) {
    // biome-ignore lint/performance/noAwaitInLoops: candidates are tried in order
    const result = await attemptTopic(registry, model, context, options);
    if (result.ok) {
      return result;
    }
    firstFailure ??= result.failure;
  }
  return {
    failure: firstFailure ?? {
      kind: "no-model",
    },
    ok: false,
  };
}

async function attemptTopic(
  registry: TopicModelRegistry,
  model: Model<Api>,
  context: Context,
  options: GenerateTopicOptions,
): Promise<TopicResult> {
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
    if (message.stopReason === "aborted") {
      return {
        ok: false,
        failure: {
          kind: "timeout",
        },
      };
    }
    if (message.stopReason === "error") {
      return {
        ok: false,
        failure: {
          detail: boundedDetail(message.errorMessage),
          kind: "provider-error",
        },
      };
    }
    const text = textOf(message).trim();
    if (text.length === 0) {
      return {
        ok: false,
        failure: {
          kind: "empty",
        },
      };
    }
    return {
      model: `${model.provider}/${model.id}`,
      ok: true,
      text: [
        ...text,
      ]
        .slice(0, TOPIC_MAX_CHARS)
        .join(""),
    };
  } catch {
    return {
      ok: false,
      failure: {
        detail: "",
        kind: "provider-error",
      },
    };
  }
}

/** Provider error text on one line and bounded, so a warning stays readable. */
function boundedDetail(raw: string | undefined): string {
  return [
    ...(raw ?? "").replace(/\s+/g, " ").trim(),
  ]
    .slice(0, TOPIC_ERROR_MAX_CHARS)
    .join("");
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}
