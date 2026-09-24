import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  generateTopic,
  resolveTopicModel,
  TOPIC_MAX_CHARS,
  TOPIC_MODEL_ID,
  type TopicModelRegistry,
} from "./topic-model.ts";

const CONTEXT: Context = {
  messages: [
    {
      content: "帮我看看登录失败",
      role: "user",
      timestamp: 0,
    },
  ],
};

/** Streams a canned message through the real event-stream contract. */
function streamOf(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "stop" || message.stopReason === "length") {
      stream.push({
        message,
        reason: message.stopReason,
        type: "done",
      });
    } else {
      stream.push({
        error: message,
        reason: "aborted",
        type: "error",
      });
    }
    stream.end(message);
  });
  return stream;
}

/**
 * Minimal `ctx.modelRegistry` stand-in: real `Model` objects from Pi's faux
 * provider, a scripted response, and a record of every request the adapter made.
 */
function createRegistry(options: {
  providers?: string[];
  configured?: string[];
  respond?: (model: Model<Api>) => AssistantMessage;
}) {
  const providers = options.providers ?? [
    "MIMO",
  ];
  const configured = new Set(options.configured ?? providers);
  const respond = options.respond ?? (() => fauxAssistantMessage("登录失败排查"));
  const faux = fauxProvider({
    models: providers.map((provider) => ({
      id: TOPIC_MODEL_ID,
      name: provider,
    })),
    provider: providers[0],
  });
  const models: Model<Api>[] = providers.map(
    (provider) =>
      Object.assign({}, faux.models[0], {
        provider,
      }) as Model<Api>,
  );
  const calls: {
    model: Model<Api>;
    signal: AbortSignal | undefined;
  }[] = [];

  const registry: TopicModelRegistry = {
    find: (provider, modelId) =>
      models.find((m) => m.provider === provider && m.id === modelId),
    getAvailable: () => models.filter((m) => configured.has(m.provider)),
    hasConfiguredAuth: (model) => configured.has(model.provider),
    streamSimple: (model, _context, streamOptions) => {
      calls.push({
        model,
        signal: streamOptions?.signal,
      });
      return streamOf(respond(model));
    },
  };
  return {
    calls,
    registry,
  };
}

describe("resolveTopicModel", () => {
  it("prefers the configured MIMO provider", () => {
    const { registry } = createRegistry({
      providers: [
        "MIMO",
        "CMD-PRO",
      ],
    });
    expect(resolveTopicModel(registry)?.provider).toBe("MIMO");
  });

  it("falls back to another configured provider exposing the same id", () => {
    const { registry } = createRegistry({
      configured: [
        "CMD-PRO",
      ],
      providers: [
        "MIMO",
        "CMD-PRO",
      ],
    });
    expect(resolveTopicModel(registry)?.provider).toBe("CMD-PRO");
  });

  it("returns undefined when no provider offers the model", () => {
    const { registry } = createRegistry({
      configured: [],
      providers: [
        "CMD-PRO",
      ],
    });
    expect(resolveTopicModel(registry)).toBeUndefined();
  });
});

describe("generateTopic", () => {
  it("returns the topic from a representative conversation context", async () => {
    const { calls, registry } = createRegistry({});
    await expect(generateTopic(registry, CONTEXT)).resolves.toBe("登录失败排查");
    expect(calls).toHaveLength(1);
    expect(calls[0].model.id).toBe(TOPIC_MODEL_ID);
    expect(calls[0].model.provider).toBe("MIMO");
  });

  it("bounds an overlong topic to TOPIC_MAX_CHARS code points", async () => {
    const long = "很".repeat(TOPIC_MAX_CHARS * 3);
    const { registry } = createRegistry({
      respond: () => fauxAssistantMessage(long),
    });
    const topic = await generateTopic(registry, CONTEXT);
    expect([
      ...(topic ?? ""),
    ]).toHaveLength(TOPIC_MAX_CHARS);
    expect(long.startsWith(topic ?? "")).toBe(true);
  });

  it("routes the request to the topic model and leaves the primary model untouched", async () => {
    const primary = Object.assign({}, fauxProvider().models[0], {
      id: "deepseek-v4.1-flash",
      provider: "CMD-PRO",
    });
    const snapshot = structuredClone(primary);
    const { calls, registry } = createRegistry({});
    await generateTopic(registry, CONTEXT);
    expect(calls[0].model.id).not.toBe(primary.id);
    expect(primary).toEqual(snapshot);
  });

  it("returns undefined when no topic model is available", async () => {
    const { calls, registry } = createRegistry({
      configured: [],
      providers: [
        "CMD-PRO",
      ],
    });
    await expect(generateTopic(registry, CONTEXT)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("returns undefined on an error response instead of throwing", async () => {
    const { registry } = createRegistry({
      respond: () =>
        fauxAssistantMessage("", {
          errorMessage: "boom",
          stopReason: "error",
        }),
    });
    await expect(generateTopic(registry, CONTEXT)).resolves.toBeUndefined();
  });

  it("aborts the request signal and returns undefined when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, registry } = createRegistry({
      respond: () =>
        fauxAssistantMessage("", {
          stopReason: "aborted",
        }),
    });
    await expect(
      generateTopic(registry, CONTEXT, {
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(true);
  });
});
