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
  return {
    result: async () => message,
  } as unknown as AssistantMessageEventStream;
}

export function fakeRegistry(
  options: { available?: boolean; throwOnResolve?: boolean; topic?: string } = {},
): {
  registry: TopicModelRegistry;
  requested: string[];
} {
  const available = options.available ?? true;
  const models: Model<string>[] = fauxProvider({
    provider: "MIMO",
    models: [
      {
        id: TOPIC_MODEL_ID,
      },
    ],
  }).models;
  const requested: string[] = [];
  return {
    requested,
    registry: {
      find: (provider, modelId) => {
        if (options.throwOnResolve) {
          throw new Error("registry unavailable");
        }
        return available && provider === "MIMO"
          ? models.find((m) => m.id === modelId)
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
        return ready(fauxAssistantMessage(options.topic ?? DEFAULT_TOPIC));
      },
    },
  };
}
