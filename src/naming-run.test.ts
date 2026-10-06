import {
  type Api,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
} from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createNamer, type NamingRequest } from "./naming-run.ts";
import { fakeRegistry } from "./test-registry.ts";
import { TOPIC_MODEL_ID } from "./topic-model.ts";

const AT = "2026-01-01T00:00:00.000Z";
const PRIMARY_MODEL_ID = "deepseek-v4.1-flash";
/** Above the meaningful-input threshold, so the first turn alone triggers naming. */
const MEANINGFUL_REQUEST = "登录失败".repeat(3);

function userEntry(id: string, content: string): SessionEntry {
  return {
    id,
    parentId: null,
    timestamp: AT,
    type: "message",
    message: {
      content,
      role: "user",
      timestamp: 0,
    },
  };
}

function assistantEntry(id: string): SessionEntry {
  return {
    id,
    message: fauxAssistantMessage("ok"),
    parentId: null,
    timestamp: AT,
    type: "message",
  };
}

function request(overrides: Partial<NamingRequest> = {}): NamingRequest {
  return {
    modelId: PRIMARY_MODEL_ID,
    registry: fakeRegistry().registry,
    branch: [
      userEntry("u1", MEANINGFUL_REQUEST),
      assistantEntry("a1"),
    ],
    getSessionName: () => undefined,
    setSessionName: () => undefined,
    ...overrides,
  };
}

describe("createNamer", () => {
  it("names after a meaningful first turn, using the primary model as prefix", async () => {
    const { registry, requested } = fakeRegistry({
      topic: "登录失败排查",
    });
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
      status: "named",
    });
    expect(names).toEqual([
      `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
    ]);
    expect(names[0]).toContain(`[${PRIMARY_MODEL_ID}] - `);
    expect(names[0]).not.toContain(TOPIC_MODEL_ID);
    // The topic request goes to the topic model, not to the primary model.
    expect(requested).toEqual([
      TOPIC_MODEL_ID,
    ]);
  });

  it("uses the bare model id when the primary model is provider-qualified", async () => {
    const { registry } = fakeRegistry();
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        modelId: "deepseek/deepseek-v4.1-flash",
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: "[deepseek-v4.1-flash] - 登录失败排查",
      status: "named",
    });
    expect(names).toEqual([
      "[deepseek-v4.1-flash] - 登录失败排查",
    ]);
  });

  it("waits for the second turn when the first turn is trivial", async () => {
    const namer = createNamer();
    const { registry, requested } = fakeRegistry({
      topic: "登录失败排查",
    });
    const names: string[] = [];
    const setSessionName = (name: string) => names.push(name);

    const afterFirst = await namer(
      request({
        branch: [
          userEntry("u1", "hello"),
          assistantEntry("a1"),
        ],
        registry,
        setSessionName,
      }),
    );
    expect(afterFirst).toEqual({
      reason: "not-eligible",
      status: "skipped",
    });
    expect(requested).toEqual([]);
    expect(names).toEqual([]);

    const afterSecond = await namer(
      request({
        branch: [
          userEntry("u1", "hello"),
          assistantEntry("a1"),
          userEntry("u2", MEANINGFUL_REQUEST),
          assistantEntry("a2"),
        ],
        registry,
        setSessionName,
      }),
    );
    expect(afterSecond).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
      status: "named",
    });
    expect(names).toHaveLength(1);
  });

  it("never overwrites an existing name", async () => {
    const { registry, requested } = fakeRegistry({});
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        getSessionName: () => "手动命名",
        registry,
        setSessionName: (n) => names.push(n),
      }),
    );

    expect(outcome).toEqual({
      reason: "already-named",
      status: "skipped",
    });
    expect(requested).toEqual([]);
    expect(names).toEqual([]);
  });

  it("lets a manual rename during the request win", async () => {
    const { registry } = fakeRegistry({});
    const names: string[] = [];
    let reads = 0;
    const outcome = await createNamer()(
      request({
        // First read (before starting) sees no name; the second read sees the rename.
        getSessionName: () => (reads++ === 0 ? undefined : "手动命名"),
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      reason: "already-named",
      status: "skipped",
    });
    expect(names).toEqual([]);
  });

  it("attempts at most once for concurrent eligible events", async () => {
    const { registry, requested } = fakeRegistry({
      topic: "登录失败排查",
    });
    const names: string[] = [];
    const namer = createNamer();
    const naming = request({
      registry,
      setSessionName: (name) => names.push(name),
    });

    const [first, second] = await Promise.all([
      namer(naming),
      namer(naming),
    ]);

    expect(first).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
      status: "named",
    });
    expect(second).toEqual({
      reason: "in-flight",
      status: "skipped",
    });
    expect(requested).toHaveLength(1);
    expect(names).toHaveLength(1);
  });

  it("fails safely without a primary model id and spends no request", async () => {
    const { registry, requested } = fakeRegistry({});
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        modelId: undefined,
        registry,
        setSessionName: (n) => names.push(n),
      }),
    );

    expect(outcome).toEqual({
      reason: "no-primary-model",
      status: "failed",
    });
    expect(requested).toEqual([]);
    expect(names).toEqual([]);
  });

  it("fails safely when no topic model is available", async () => {
    const { registry, requested } = fakeRegistry({
      available: false,
    });
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      reason: "no-topic-model",
      status: "failed",
    });
    expect(requested).toEqual([]);
    expect(names).toEqual([]);
  });

  it("leaves the name unchanged when the topic is unusable", async () => {
    const { registry } = fakeRegistry({
      topic: "Login failure troubleshooting",
    });
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      reason: "topic-rejected",
      status: "failed",
    });
    expect(names).toEqual([]);
  });

  it("contains a resolving failure instead of throwing", async () => {
    const { registry } = fakeRegistry({
      throwOnResolve: true,
    });
    const names: string[] = [];
    const outcome = await createNamer()(
      request({
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      reason: "error",
      status: "failed",
    });
    expect(names).toEqual([]);
  });

  it("releases the in-flight guard after a failure, so a later turn can still name", async () => {
    const { registry } = fakeRegistry({
      throwOnResolve: true,
    });
    const namer = createNamer();

    const failed = await namer(
      request({
        registry,
      }),
    );
    expect(failed).toEqual({
      reason: "error",
      status: "failed",
    });

    const { registry: healthy, requested } = fakeRegistry({
      topic: "登录失败排查",
    });
    const named = await namer(
      request({
        registry: healthy,
      }),
    );
    expect(named.status).toBe("named");
    expect(requested).toEqual([
      TOPIC_MODEL_ID,
    ]);
  });

  it("retries on the primary model when the topic model refuses", async () => {
    const fallback = Object.assign({}, fauxProvider().models[0], {
      id: PRIMARY_MODEL_ID,
      provider: "CMD-PRO",
    }) as Model<Api>;
    const { registry, requested } = fakeRegistry({
      respond: (model) =>
        model.provider === "CMD-PRO"
          ? fauxAssistantMessage("登录失败排查")
          : fauxAssistantMessage("", {
              errorMessage: "Space Bunny Alpha is no longer available",
              stopReason: "error",
            }),
    });
    const names: string[] = [];

    const outcome = await createNamer()(
      request({
        fallback,
        registry,
        setSessionName: (name) => names.push(name),
      }),
    );

    expect(outcome).toEqual({
      model: `CMD-PRO/${PRIMARY_MODEL_ID}`,
      name: `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
      status: "named",
    });
    expect(requested).toEqual([
      TOPIC_MODEL_ID,
      PRIMARY_MODEL_ID,
    ]);
    expect(names).toEqual([
      `[${PRIMARY_MODEL_ID}] - 登录失败排查`,
    ]);
  });

  it("surfaces the provider message when no candidate answers", async () => {
    const { registry } = fakeRegistry({
      respond: () =>
        fauxAssistantMessage("", {
          errorMessage: "Space Bunny Alpha is no longer available",
          stopReason: "error",
        }),
    });

    const outcome = await createNamer()(
      request({
        registry,
      }),
    );

    expect(outcome).toEqual({
      detail: "Space Bunny Alpha is no longer available",
      reason: "topic-error",
      status: "failed",
    });
  });
});
