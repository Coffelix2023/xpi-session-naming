import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import xpiSessionNaming from "./index.ts";
import { fakeRegistry } from "./test-registry.ts";
import { TOPIC_MODEL_ID, type TopicModelRegistry } from "./topic-model.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

const AT = "2026-01-01T00:00:00.000Z";
const PRIMARY_MODEL_ID = "deepseek-v4.1-flash";
const MEANINGFUL_REQUEST = "登录失败".repeat(3);

/** Minimal mock pi: captures hooks and the session-name calls the wiring makes. */
function mockPi() {
  const hooks = new Map<string, Handler>();
  const setNames: string[] = [];
  let sessionName: string | undefined;
  const api = {
    getSessionName: () => sessionName,
    on: (event: string, handler: Handler) => {
      hooks.set(event, handler);
    },
    registerCommand: () => undefined,
    setSessionName: (name: string) => {
      sessionName = name;
      setNames.push(name);
    },
  };
  return {
    api,
    hooks,
    sessionName: () => sessionName,
    setNames,
  };
}

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

/** Minimal mock ctx: only the members this extension reads. */
function mockCtx(options: {
  branch?: SessionEntry[];
  hasUI?: boolean;
  modelId?: string | undefined;
  registry?: TopicModelRegistry;
}) {
  const notifies: {
    message: string;
    type?: string;
  }[] = [];
  return {
    hasUI: options.hasUI ?? true,
    model:
      options.modelId === undefined
        ? undefined
        : {
            id: options.modelId,
          },
    modelRegistry: options.registry ?? fakeRegistry().registry,
    notifies,
    sessionManager: {
      getBranch: () => options.branch ?? [],
    },
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifies.push({
          message,
          type,
        });
      },
    },
  };
}

function load() {
  const pi = mockPi();
  xpiSessionNaming(pi.api as never);
  function handler(name: string): Handler {
    const registered = pi.hooks.get(name);
    expect(registered, `hook ${name} registered`).toBeDefined();
    return registered as Handler;
  }
  return {
    ...pi,
    handler,
  };
}

describe("xpiSessionNaming wiring", () => {
  it("registers a single agent_settled hook", () => {
    const pi = load();
    expect([
      ...pi.hooks.keys(),
    ]).toEqual([
      "agent_settled",
    ]);
  });

  it("names the session after a meaningful first turn, prefixed with the main model", async () => {
    const pi = load();
    const { registry, requested } = fakeRegistry();

    await pi.handler("agent_settled")(
      {
        type: "agent_settled",
      },
      mockCtx({
        modelId: PRIMARY_MODEL_ID,
        branch: [
          userEntry("u1", MEANINGFUL_REQUEST),
          assistantEntry("a1"),
        ],
        registry,
      }),
    );

    expect(pi.sessionName()).toBe(`[${PRIMARY_MODEL_ID}] - 登录失败排查`);
    expect(pi.sessionName()).not.toContain(TOPIC_MODEL_ID);
    expect(requested).toEqual([
      TOPIC_MODEL_ID,
    ]);
  });

  it("does not name after a trivial first turn", async () => {
    const pi = load();

    const ctx = mockCtx({
      modelId: PRIMARY_MODEL_ID,
      branch: [
        userEntry("u1", "hello"),
        assistantEntry("a1"),
      ],
    });
    await pi.handler("agent_settled")(
      {
        type: "agent_settled",
      },
      ctx,
    );

    expect(pi.sessionName()).toBeUndefined();
    expect(pi.setNames).toEqual([]);
    expect(ctx.notifies).toEqual([]);
  });

  it("never overwrites a manual name", async () => {
    const pi = load();
    pi.api.setSessionName("手动命名");
    pi.setNames.length = 0;

    await pi.handler("agent_settled")(
      {
        type: "agent_settled",
      },
      mockCtx({
        modelId: PRIMARY_MODEL_ID,
        branch: [
          userEntry("u1", MEANINGFUL_REQUEST),
          assistantEntry("a1"),
        ],
      }),
    );

    expect(pi.sessionName()).toBe("手动命名");
    expect(pi.setNames).toEqual([]);
  });

  it("reports a failure without touching the name when the main model is unavailable", async () => {
    const pi = load();
    const ctx = mockCtx({
      modelId: undefined,
      branch: [
        userEntry("u1", MEANINGFUL_REQUEST),
        assistantEntry("a1"),
      ],
    });

    await pi.handler("agent_settled")(
      {
        type: "agent_settled",
      },
      ctx,
    );

    expect(pi.sessionName()).toBeUndefined();
    expect(ctx.notifies).toEqual([
      {
        // biome-ignore lint/security/noSecrets: user-facing message, not a credential
        message: "当前模型信息不可用，未自动命名本次会话",
        type: "warning",
      },
    ]);
  });

  it("stays silent when the client has no UI", async () => {
    const pi = load();
    const ctx = mockCtx({
      hasUI: false,
      modelId: undefined,
      branch: [
        userEntry("u1", MEANINGFUL_REQUEST),
        assistantEntry("a1"),
      ],
    });

    await pi.handler("agent_settled")(
      {
        type: "agent_settled",
      },
      ctx,
    );

    expect(pi.sessionName()).toBeUndefined();
    expect(ctx.notifies).toEqual([]);
  });
});
