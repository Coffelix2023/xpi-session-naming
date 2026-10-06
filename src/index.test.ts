import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import xpiSessionNaming from "./index.ts";
import { fakeRegistry } from "./test-registry.ts";
import { TOPIC_MODEL_ID, type TopicModelRegistry } from "./topic-model.ts";
import { readTopicModelConfig, topicModelConfigPath } from "./topic-model-config.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
type CommandHandler = (args: string, ctx: unknown) => Promise<unknown> | unknown;

const AT = "2026-01-01T00:00:00.000Z";
const CHOSEN_MODEL_ID = "deepseek-v4.1-pro";
const CHOSEN_MODEL_PROVIDER = "CMD-PRO";
const PRIMARY_MODEL_ID = "deepseek-v4.1-flash";
const MEANINGFUL_REQUEST = "登录失败".repeat(3);

/** Minimal mock pi: captures commands, hooks, and the session-name calls. */
function mockPi() {
  const hooks = new Map<string, Handler>();
  const commands: string[] = [];
  const handlers = new Map<string, CommandHandler>();
  const completions = new Map<string, (prefix: string) => unknown>();
  const setNames: string[] = [];
  let sessionName: string | undefined;
  const api = {
    getSessionName: () => sessionName,
    on: (event: string, handler: Handler) => {
      hooks.set(event, handler);
    },
    registerCommand: (
      name: string,
      options: {
        getArgumentCompletions?: (prefix: string) => unknown;
        handler: CommandHandler;
      },
    ) => {
      commands.push(name);
      handlers.set(name, options.handler);
      if (options.getArgumentCompletions) {
        completions.set(name, options.getArgumentCompletions);
      }
    },
    setSessionName: (name: string) => {
      sessionName = name;
      setNames.push(name);
    },
  };
  function command(name: string): CommandHandler {
    const registered = handlers.get(name);
    expect(registered, `command ${name} registered`).toBeDefined();
    return registered as CommandHandler;
  }

  return {
    api,
    command,
    commands,
    completions,
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
  mode?: string;
  /** Value `ctx.ui.custom` resolves to; the picker itself is tested separately. */
  pickedModel?: {
    id: string;
    provider: string;
  } | null;
}) {
  const notifies: {
    message: string;
    type?: string;
  }[] = [];
  return {
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? "tui",
    model:
      options.modelId === undefined
        ? undefined
        : {
            id: options.modelId,
          },
    modelRegistry: options.registry ?? fakeRegistry().registry,
    notifies,
    scopedModels: [],
    sessionManager: {
      getBranch: () => options.branch ?? [],
    },
    ui: {
      custom: async () => options.pickedModel ?? null,
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

let agentDirs: string[] = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  for (const dir of agentDirs) {
    rmSync(dir, {
      force: true,
      recursive: true,
    });
  }
  agentDirs = [];
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

/**
 * Point `getAgentDir()` at a throwaway directory, optionally seeded with a
 * `xpi-session-naming.json`. Nothing in this suite touches the real agent dir.
 */
function useAgentDir(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-naming-agent-"));
  agentDirs.push(dir);
  if (config !== undefined) {
    writeFileSync(topicModelConfigPath(dir), config, "utf8");
  }
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
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

  it("registers the status command and the naming-model command", () => {
    const pi = load();
    expect(pi.commands).toEqual([
      "xpi-session-naming",
      "xpi-session-naming-model",
    ]);
  });

  it("picks the naming model through the `models` subcommand", async () => {
    const dir = useAgentDir();
    const pi = load();
    const ctx = mockCtx({
      pickedModel: {
        id: CHOSEN_MODEL_ID,
        provider: CHOSEN_MODEL_PROVIDER,
      },
    });

    await pi.command("xpi-session-naming")("models", ctx);

    expect(await readTopicModelConfig(dir)).toEqual({
      preference: {
        id: CHOSEN_MODEL_ID,
        provider: CHOSEN_MODEL_PROVIDER,
      },
    });
    expect(ctx.notifies).toEqual([
      {
        message: `命名模型已设为 ${CHOSEN_MODEL_ID}`,
        type: "info",
      },
    ]);
  });

  it("keeps the stored preference when the picker is cancelled", async () => {
    const stored = JSON.stringify({
      topicModel: {
        id: CHOSEN_MODEL_ID,
        provider: CHOSEN_MODEL_PROVIDER,
      },
    });
    const dir = useAgentDir(stored);
    const pi = load();

    await pi.command("xpi-session-naming")(
      "models",
      mockCtx({
        pickedModel: null,
      }),
    );

    expect(readFileSync(topicModelConfigPath(dir), "utf8")).toBe(stored);
  });

  it("reports the version status when the argument is empty", async () => {
    const pi = load();
    const ctx = mockCtx({});

    await pi.command("xpi-session-naming")("  ", ctx);

    expect(ctx.notifies).toHaveLength(1);
    expect(ctx.notifies[0]?.type).toBeUndefined();
    expect(ctx.notifies[0]?.message).toContain("loaded");
  });

  it("warns on an unknown subcommand", async () => {
    const pi = load();
    const ctx = mockCtx({});

    await pi.command("xpi-session-naming")("bogus", ctx);

    expect(ctx.notifies).toEqual([
      {
        message: '未知子命令 "bogus"，可用: models',
        type: "warning",
      },
    ]);
  });

  it("completes `models` and nothing else", () => {
    const pi = load();
    const complete = pi.completions.get("xpi-session-naming");

    expect(complete?.("m")).toEqual([
      {
        description: "Choose the model that names sessions",
        label: "models",
        value: "models",
      },
    ]);
    expect(complete?.("x")).toBeNull();
  });

  it("names with the model stored by /xpi-session-naming-model", async () => {
    useAgentDir(
      JSON.stringify({
        topicModel: {
          id: CHOSEN_MODEL_ID,
          provider: CHOSEN_MODEL_PROVIDER,
        },
      }),
    );
    const pi = load();
    const { registry, requested } = fakeRegistry({
      extraModel: {
        id: CHOSEN_MODEL_ID,
        provider: CHOSEN_MODEL_PROVIDER,
      },
    });

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

    expect(requested).toEqual([
      CHOSEN_MODEL_ID,
    ]);
    expect(pi.sessionName()).toBe(`[${PRIMARY_MODEL_ID}] - 登录失败排查`);
  });

  it("falls back to the default topic model when the stored one is gone", async () => {
    useAgentDir(
      JSON.stringify({
        topicModel: {
          id: "removed-model",
          provider: "REMOVED",
        },
      }),
    );
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

    expect(requested).toEqual([
      TOPIC_MODEL_ID,
    ]);
  });

  it("names with the default topic model when no preference is stored", async () => {
    useAgentDir();
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

    expect(requested).toEqual([
      TOPIC_MODEL_ID,
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
        message: "当前模型信息不可用，会话名保持不变",
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
