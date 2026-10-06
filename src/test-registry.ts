/**
 * Shared test double for `ctx.modelRegistry` and the stream it returns.
 * Test-only: `src/index.ts` never imports this module.
 */
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { TOPIC_MODEL_ID, type TopicModelRegistry } from "./topic-model.ts";

export const DEFAULT_TOPIC = "登录失败排查";

/**
 * Minimal stream stub. The real event-stream contract (including setup failures
 * resolving as error messages) is covered in `topic-model.test.ts`.
 */
export function ready(message: AssistantMessage): AssistantMessageEventStream {
  // SAFETY: the adapter only ever awaits `result()`; every other member of the
  // event-stream surface is exercised against the real stream in
  // `topic-model.test.ts`, so this stub never has to be a full stream.
  return {
    result: async () => message,
  } as unknown as AssistantMessageEventStream;
}

export function fakeRegistry(
  options: {
    available?: boolean;
    /** A second, non-default model the registry can also resolve. */
    extraModel?: {
      id: string;
      provider: string;
    };
    throwOnResolve?: boolean;
    topic?: string;
    /** Per-model response; defaults to a canned topic. */
    respond?: (model: Model<string>) => AssistantMessage;
  } = {},
): {
  registry: TopicModelRegistry;
  requested: string[];
} {
  const available = options.available ?? true;
  const entries: {
    id: string;
    provider: string;
  }[] = [
    {
      id: TOPIC_MODEL_ID,
      provider: "MIMO",
    },
    ...(options.extraModel
      ? [
          options.extraModel,
        ]
      : []),
  ];
  const faux = fauxProvider({
    models: entries.map((entry) => ({
      id: entry.id,
    })),
    provider: "MIMO",
  });
  const models: Model<string>[] = entries.map(
    (entry, index) =>
      Object.assign({}, faux.models[index], {
        provider: entry.provider,
      }) as Model<string>,
  );
  const requested: string[] = [];
  return {
    requested,
    registry: {
      find: (provider, modelId) => {
        if (options.throwOnResolve) {
          throw new Error("registry unavailable");
        }
        return available
          ? models.find((model) => model.provider === provider && model.id === modelId)
          : undefined;
      },
      getAvailable: () => {
        if (options.throwOnResolve) {
          throw new Error("registry unavailable");
        }
        return available ? models : [];
      },
      hasConfiguredAuth: () => available,
      streamSimple: (model) => {
        requested.push(model.id);
        return ready(
          options.respond?.(model) ??
            fauxAssistantMessage(options.topic ?? DEFAULT_TOPIC),
        );
      },
    },
  };
}
