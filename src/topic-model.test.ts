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
  resolveTopicCandidates,
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

/** Registry over explicit provider/model pairs, so a stored preference can be exercised. */
function multiModelRegistry(
  entries: {
    id: string;
    provider: string;
  }[],
  configured: string[],
): {
  calls: Model<Api>[];
  registry: TopicModelRegistry;
} {
  const faux = fauxProvider({
    models: entries.map((entry) => ({
      id: entry.id,
    })),
    provider: entries[0]?.provider ?? "MIMO",
  });
  const models: Model<Api>[] = entries.map(
    (entry, index) => Object.assign({}, faux.models[index], entry) as Model<Api>,
  );
  const auth = new Set(configured);
  const calls: Model<Api>[] = [];
  return {
    calls,
    registry: {
      find: (provider, modelId) =>
        models.find((m) => m.provider === provider && m.id === modelId),
      getAvailable: () => models.filter((m) => auth.has(m.provider)),
      hasConfiguredAuth: (model) => auth.has(model.provider),
      streamSimple: (model) => {
        calls.push(model);
        return streamOf(fauxAssistantMessage("登录失败排查"));
      },
    },
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

describe("resolveTopicModel with a stored preference", () => {
  const CHOSEN = {
    id: "deepseek-v4.1-flash",
    provider: "CMD-PRO",
  };
  const CATALOGUE = [
    CHOSEN,
    {
      id: TOPIC_MODEL_ID,
      provider: "MIMO",
    },
  ];

  it("uses the chosen model when it resolves and has auth", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);

    expect(resolveTopicModel(registry, CHOSEN)).toMatchObject(CHOSEN);
  });

  it("falls back to the default chain when the chosen provider has no auth", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "MIMO",
    ]);

    expect(resolveTopicModel(registry, CHOSEN)?.provider).toBe("MIMO");
  });

  it("falls back to the default chain when the chosen model was removed", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);

    expect(
      resolveTopicModel(registry, {
        id: "removed-model",
        provider: "CMD-PRO",
      })?.provider,
    ).toBe("MIMO");
  });

  it("keeps the default chain when no preference is stored", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);

    expect(resolveTopicModel(registry)?.provider).toBe("MIMO");
  });

  it("routes the completion to the chosen model", async () => {
    const { calls, registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);

    await generateTopic(registry, CONTEXT, {
      preference: CHOSEN,
    });

    expect(calls[0]).toMatchObject(CHOSEN);
  });
});

describe("generateTopic", () => {
  it("returns the topic from a representative conversation context", async () => {
    const { calls, registry } = createRegistry({});
    await expect(generateTopic(registry, CONTEXT)).resolves.toMatchObject({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      ok: true,
      text: "登录失败排查",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model.id).toBe(TOPIC_MODEL_ID);
    expect(calls[0].model.provider).toBe("MIMO");
  });

  it("bounds an overlong topic to TOPIC_MAX_CHARS code points", async () => {
    const long = "很".repeat(TOPIC_MAX_CHARS * 3);
    const { registry } = createRegistry({
      respond: () => fauxAssistantMessage(long),
    });
    const result = await generateTopic(registry, CONTEXT);
    const topic = result.ok ? result.text : "";
    expect(result.ok).toBe(true);
    expect([
      ...topic,
    ]).toHaveLength(TOPIC_MAX_CHARS);
    expect(long.startsWith(topic)).toBe(true);
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
    await expect(generateTopic(registry, CONTEXT)).resolves.toEqual({
      ok: false,
      failure: {
        kind: "no-model",
      },
    });
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
    await expect(generateTopic(registry, CONTEXT)).resolves.toEqual({
      ok: false,
      failure: {
        detail: "boom",
        kind: "provider-error",
      },
    });
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
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "timeout",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe("resolveTopicCandidates", () => {
  const CHOSEN = {
    id: "deepseek-v4.1-flash",
    provider: "CMD-PRO",
  };
  const CATALOGUE = [
    CHOSEN,
    {
      id: TOPIC_MODEL_ID,
      provider: "MIMO",
    },
  ];

  it("orders the preference, the default chain, and the fallback", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);
    const fallback = Object.assign({}, fauxProvider().models[0], {
      id: "fallback-model",
      provider: "FALLBACK",
    }) as Model<Api>;

    expect(
      resolveTopicCandidates(registry, {
        fallback,
        preference: CHOSEN,
      }).map((model) => `${model.provider}/${model.id}`),
    ).toEqual([
      "CMD-PRO/deepseek-v4.1-flash",
      `MIMO/${TOPIC_MODEL_ID}`,
      "FALLBACK/fallback-model",
    ]);
  });

  it("skips a stored preference whose provider has no auth", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "MIMO",
    ]);

    expect(
      resolveTopicCandidates(registry, {
        preference: CHOSEN,
      }).map((model) => model.provider),
    ).toEqual([
      "MIMO",
    ]);
  });

  it("lists a duplicated fallback once", () => {
    const { registry } = multiModelRegistry(CATALOGUE, [
      "CMD-PRO",
      "MIMO",
    ]);
    const candidates = resolveTopicCandidates(registry, {
      fallback: Object.assign({}, fauxProvider().models[0], CHOSEN) as Model<Api>,
      preference: CHOSEN,
    });

    expect(
      candidates.filter(
        (model) => `${model.provider}/${model.id}` === "CMD-PRO/deepseek-v4.1-flash",
      ),
    ).toHaveLength(1);
    expect(candidates).toHaveLength(2);
  });
});

describe("generateTopic with candidates", () => {
  it("retries the next candidate after the provider refuses the first", async () => {
    const fallback = Object.assign({}, fauxProvider().models[0], {
      id: "deepseek-v4.1-flash",
      provider: "CMD-PRO",
    }) as Model<Api>;
    const { calls, registry } = createRegistry({
      respond: (model) =>
        model.provider === fallback.provider
          ? fauxAssistantMessage("登录失败排查")
          : fauxAssistantMessage("", {
              errorMessage: "Space Bunny Alpha is no longer available",
              stopReason: "error",
            }),
    });

    await expect(
      generateTopic(registry, CONTEXT, {
        fallback,
      }),
    ).resolves.toEqual({
      model: `CMD-PRO/${fallback.id}`,
      ok: true,
      text: "登录失败排查",
    });
    expect(calls.map((call) => call.model.provider)).toEqual([
      "MIMO",
      "CMD-PRO",
    ]);
  });

  it("reports the best candidate's provider error when every candidate fails", async () => {
    const fallback = Object.assign({}, fauxProvider().models[0], {
      id: "fallback-model",
      provider: "FALLBACK",
    }) as Model<Api>;
    const { registry } = createRegistry({
      respond: () =>
        fauxAssistantMessage("", {
          errorMessage: "provider refused this model",
          stopReason: "error",
        }),
    });

    await expect(
      generateTopic(registry, CONTEXT, {
        fallback,
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        detail: "provider refused this model",
        kind: "provider-error",
      },
    });
  });

  it("masks a credential-like token inside the provider message", async () => {
    const secret = "k".repeat(48);
    const { registry } = createRegistry({
      respond: () =>
        fauxAssistantMessage("", {
          errorMessage: `invalid key ${secret}`,
          stopReason: "error",
        }),
    });

    await expect(generateTopic(registry, CONTEXT)).resolves.toEqual({
      ok: false,
      failure: {
        detail: "invalid key [redacted]",
        kind: "provider-error",
      },
    });
  });
});
