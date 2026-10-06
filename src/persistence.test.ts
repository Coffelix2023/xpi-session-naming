import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createNamer, type NamingRequest } from "./naming-run.ts";
import { DEFAULT_TOPIC, fakeRegistry } from "./test-registry.ts";
import { TOPIC_MODEL_ID } from "./topic-model.ts";

const PRIMARY_MODEL_ID = "deepseek-v4.1-flash";
const MEANINGFUL_REQUEST = "登录失败".repeat(3);

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, {
      force: true,
      recursive: true,
    });
  }
  roots = [];
});

function isolatedProject() {
  const cwd = mkdtempSync(join(tmpdir(), "xpi-naming-cwd-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "xpi-naming-sessions-"));
  roots.push(cwd, sessionDir);
  return {
    cwd,
    sessionDir,
  };
}

/** Wires a real `SessionManager` into the namer, the way `src/index.ts` wires `pi`. */
function sessionRequest(
  manager: SessionManager,
  registry: NamingRequest["registry"],
): NamingRequest {
  return {
    branch: manager.getBranch(),
    modelId: PRIMARY_MODEL_ID,
    getSessionName: () => manager.getSessionName(),
    registry,
    setSessionName: (name) => {
      manager.appendSessionInfo(name);
    },
  };
}

function createSession(
  cwd: string,
  sessionDir: string,
  firstTurn: string,
): SessionManager {
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({
    content: firstTurn,
    role: "user",
    timestamp: 0,
  });
  manager.appendMessage(fauxAssistantMessage("ok"));
  return manager;
}

describe("session name persistence", () => {
  it("stores the name through Pi's session state and keeps it across a reload", async () => {
    const { cwd, sessionDir } = isolatedProject();
    const manager = createSession(cwd, sessionDir, MEANINGFUL_REQUEST);
    const expected = `[${PRIMARY_MODEL_ID}] - ${DEFAULT_TOPIC}`;

    const outcome = await createNamer()(
      sessionRequest(manager, fakeRegistry().registry),
    );
    expect(outcome).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: expected,
      status: "named",
    });
    expect(manager.getSessionName()).toBe(expected);

    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();
    // Persisted as a session_info entry, not just held in memory.
    const raw = readFileSync(sessionFile as string, "utf8");
    expect(raw).toContain('"type":"session_info"');
    expect(raw).toContain(expected);

    // Reload: a fresh manager on the same file, and a fresh namer.
    const reopened = SessionManager.open(sessionFile as string, sessionDir, cwd);
    expect(reopened.getSessionName()).toBe(expected);

    const { registry, requested } = fakeRegistry();
    const afterReload = await createNamer()(sessionRequest(reopened, registry));
    expect(afterReload).toEqual({
      reason: "already-named",
      status: "skipped",
    });
    expect(requested).toEqual([]);
    expect(reopened.getSessionName()).toBe(expected);
  });

  it("still names after a reload of an unnamed session", async () => {
    const { cwd, sessionDir } = isolatedProject();
    const manager = createSession(cwd, sessionDir, MEANINGFUL_REQUEST);
    const sessionFile = manager.getSessionFile() as string;

    const reopened = SessionManager.open(sessionFile, sessionDir, cwd);
    expect(reopened.getSessionName()).toBeUndefined();

    const { registry } = fakeRegistry();
    const outcome = await createNamer()(sessionRequest(reopened, registry));

    expect(outcome).toEqual({
      model: `MIMO/${TOPIC_MODEL_ID}`,
      name: `[${PRIMARY_MODEL_ID}] - ${DEFAULT_TOPIC}`,
      status: "named",
    });
    expect(reopened.getSessionName()).toBe(`[${PRIMARY_MODEL_ID}] - ${DEFAULT_TOPIC}`);
  });
});
