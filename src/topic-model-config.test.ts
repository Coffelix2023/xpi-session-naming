import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTopicModelConfig,
  topicModelConfigPath,
  writeTopicModelConfig,
} from "./topic-model-config.ts";

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

function isolatedAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-naming-config-"));
  roots.push(dir);
  return dir;
}

function seed(agentDir: string, source: string): void {
  writeFileSync(topicModelConfigPath(agentDir), source, "utf8");
}

describe("topicModelConfigPath", () => {
  it("lives in the agent directory under this extension's name", () => {
    expect(topicModelConfigPath("/tmp/agent")).toBe(
      "/tmp/agent/xpi-session-naming.json",
    );
  });
});

describe("readTopicModelConfig", () => {
  it("treats a missing file as no preference", async () => {
    expect(await readTopicModelConfig(isolatedAgentDir())).toEqual({});
  });

  it("round-trips a stored preference", async () => {
    const agentDir = isolatedAgentDir();
    await writeTopicModelConfig(
      {
        id: "deepseek-v4.1-flash",
        provider: "CMD-PRO",
      },
      agentDir,
    );

    expect(await readTopicModelConfig(agentDir)).toEqual({
      preference: {
        id: "deepseek-v4.1-flash",
        provider: "CMD-PRO",
      },
    });
  });

  it("writes the documented shape and nothing else", async () => {
    const agentDir = isolatedAgentDir();
    await writeTopicModelConfig(
      {
        id: "mimo-v2.6-flash",
        provider: "MIMO",
      },
      agentDir,
    );

    expect(readFileSync(topicModelConfigPath(agentDir), "utf8")).toBe(
      `${JSON.stringify(
        {
          topicModel: {
            id: "mimo-v2.6-flash",
            provider: "MIMO",
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("keeps the file out of other local users' reach", async () => {
    const agentDir = isolatedAgentDir();
    await writeTopicModelConfig(
      {
        id: "mimo-v2.6-flash",
        provider: "MIMO",
      },
      agentDir,
    );

    expect(statSync(topicModelConfigPath(agentDir)).mode & 0o777).toBe(0o600);
  });

  it("leaves no temporary file behind", async () => {
    const agentDir = isolatedAgentDir();
    await writeTopicModelConfig(
      {
        id: "mimo-v2.6-flash",
        provider: "MIMO",
      },
      agentDir,
    );

    expect(readdirSync(agentDir).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("falls back to no preference on malformed JSON, with a diagnostic", async () => {
    const agentDir = isolatedAgentDir();
    seed(agentDir, "{ not json");

    const result = await readTopicModelConfig(agentDir);

    expect(result.preference).toBeUndefined();
    expect(result.diagnostic).toContain("已回退默认命名模型");
  });

  it.each([
    [
      "a JSON array",
      "[]",
    ],
    [
      "a JSON string",
      '"MIMO"',
    ],
    [
      "a non-object topicModel",
      '{"topicModel":"MIMO/mimo-v2.6-flash"}',
    ],
    [
      "a missing provider",
      '{"topicModel":{"id":"mimo-v2.6-flash"}}',
    ],
    [
      "a blank id",
      '{"topicModel":{"id":"  ","provider":"MIMO"}}',
    ],
  ])("falls back to no preference on %s", async (_label, source) => {
    const agentDir = isolatedAgentDir();
    seed(agentDir, source);

    const result = await readTopicModelConfig(agentDir);

    expect(result.preference).toBeUndefined();
    expect(result.diagnostic).toBeDefined();
  });

  it("accepts an object without a topicModel key as no preference", async () => {
    const agentDir = isolatedAgentDir();
    seed(agentDir, "{}");

    expect(await readTopicModelConfig(agentDir)).toEqual({});
  });

  it("refuses to write a blank provider or id", async () => {
    const agentDir = isolatedAgentDir();

    await expect(
      writeTopicModelConfig(
        {
          id: "",
          provider: "MIMO",
        },
        agentDir,
      ),
    ).rejects.toThrow("non-empty");
    await expect(
      writeTopicModelConfig(
        {
          id: "mimo-v2.6-flash",
          provider: "   ",
        },
        agentDir,
      ),
    ).rejects.toThrow("non-empty");
  });
});
