/**
 * Persisted topic-model choice for `/xpi-session-naming-model`.
 *
 * Stored as `<agent-dir>/xpi-session-naming.json`, the same convention as
 * `xpi-diagram.json`. The file carries a provider/model-id *reference* only:
 * the provider credential stays in Pi's own auth store, so nothing here is
 * secret and nothing here needs `chmod 0600` for confidentiality (0600 is kept
 * anyway to avoid advertising the file to other local users).
 *
 * A missing, unreadable, or malformed file is not an error: it means "no
 * preference", and the caller falls back to the built-in default chain. The
 * diagnostic is returned for display, never thrown.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = "xpi-session-naming.json";

/** Resolved against `ctx.modelRegistry` at use time, never stored as a `Model`. */
export interface TopicModelPreference {
  /** Model id within that provider, e.g. `mimo-v2.6-flash`. */
  id: string;
  /** Provider id, e.g. `MIMO`. */
  provider: string;
}

export interface TopicModelConfigResult {
  /** Human-readable reason a stored preference was ignored. */
  diagnostic?: string;
  /** Absent means "use the built-in default chain". */
  preference?: TopicModelPreference;
}

export const topicModelConfigPath = (agentDir = getAgentDir()): string =>
  join(resolve(agentDir), CONFIG_FILE);

/**
 * Reads the stored preference. Never rejects: an absent file yields `{}`, and
 * an unusable one yields a diagnostic plus `{}`.
 */
export async function readTopicModelConfig(
  agentDir = getAgentDir(),
): Promise<TopicModelConfigResult> {
  try {
    const source = await readFile(topicModelConfigPath(agentDir), "utf8");
    const preference = parseTopicModelPreference(JSON.parse(source));
    return preference === undefined
      ? {}
      : {
          preference,
        };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {
      diagnostic: `xpi-session-naming 配置无效，已回退默认命名模型: ${errorMessage(error)}`,
    };
  }
}

/**
 * Writes `{ "topicModel": { "provider", "id" } }` in one rename, so a crash
 * never leaves a half-written file. Unrelated keys in the file are dropped:
 * this file belongs to this extension alone.
 */
export async function writeTopicModelConfig(
  preference: TopicModelPreference,
  agentDir = getAgentDir(),
): Promise<void> {
  if (
    nonEmptyString(preference.provider) === undefined ||
    nonEmptyString(preference.id) === undefined
  ) {
    throw new Error("provider and id must be non-empty strings");
  }

  const target = topicModelConfigPath(agentDir);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), {
    recursive: true,
  });
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
          topicModel: {
            id: preference.id,
            provider: preference.provider,
          },
        },
        null,
        2,
      )}\n`,
      {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      },
    );
    await rename(temporary, target);
  } finally {
    await rm(temporary, {
      force: true,
    });
  }
}

/** Throws with a readable reason so the reader can turn it into a diagnostic. */
function parseTopicModelPreference(parsed: unknown): TopicModelPreference | undefined {
  const root = asRecord(parsed);
  if (root === undefined) {
    throw new Error("configuration must be a JSON object");
  }
  const topicModel = root.topicModel;
  // An empty file, or a file without this key, means "no preference".
  if (topicModel === undefined) {
    return undefined;
  }
  const values = asRecord(topicModel);
  if (values === undefined) {
    throw new Error("topicModel must be an object with provider and id");
  }
  const provider = nonEmptyString(values.provider);
  const id = nonEmptyString(values.id);
  if (provider === undefined || id === undefined) {
    throw new Error("topicModel.provider and topicModel.id must be non-empty strings");
  }
  return {
    id,
    provider,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  // SAFETY: the guards above prove a non-null, non-array object; its own keys
  // are exactly the string-keyed own properties read below.
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
