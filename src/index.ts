import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createNamer,
  type NamingFailureReason,
  type NamingOutcome,
} from "./naming-run.ts";
import { resolveTopicModel } from "./topic-model.ts";
import { readTopicModelConfig, writeTopicModelConfig } from "./topic-model-config.ts";
import { ModelPicker, modelLabel } from "./ui/model-picker.ts";

const VERSION = "0.3.0";
const MODEL_COMMAND = "xpi-session-naming-model";
const MODELS_SUBCOMMAND = "models";
export default function xpiSessionNaming(pi: ExtensionAPI): void {
  const maybeNameSession = createNamer();
  // `agent_settled` fires every turn, so an unrecoverable failure would repeat
  // its warning forever; each failure kind is reported at most once per session.
  const reportedFailures = new Set<NamingFailureReason>();

  pi.registerCommand("xpi-session-naming", {
    description: "Show xpi-session-naming status; `models` picks the naming model",
    getArgumentCompletions: (prefix) =>
      MODELS_SUBCOMMAND.startsWith(prefix.trim())
        ? [
            {
              description: "Choose the model that names sessions",
              label: MODELS_SUBCOMMAND,
              value: MODELS_SUBCOMMAND,
            },
          ]
        : null,
    handler: async (args, ctx) => {
      const subcommand = args.trim();
      if (subcommand === MODELS_SUBCOMMAND) {
        await pickNamingModel(ctx);
        return;
      }
      if (subcommand !== "") {
        ctx.ui.notify(
          `未知子命令 "${subcommand}"，可用: ${MODELS_SUBCOMMAND}`,
          "warning",
        );
        return;
      }
      ctx.ui.notify(`xpi-session-naming ${VERSION} loaded`);
    },
  });

  pi.registerCommand(MODEL_COMMAND, {
    description: "Choose the model that names sessions",
    handler: async (_args, ctx) => pickNamingModel(ctx),
  });

  // `agent_settled` is the boundary where Pi will not continue on its own, so
  // every completed user turn is already on the branch. Turn counts come from
  // the branch, never from event payloads.
  pi.on("agent_settled", async (_event, ctx) => {
    try {
      // Re-read per turn: a `/xpi-session-naming-model` pick then applies to the
      // next turn without a `/reload`.
      const { preference } = await readTopicModelConfig();
      const outcome = await maybeNameSession({
        branch: ctx.sessionManager.getBranch(),
        fallback: ctx.model,
        modelId: ctx.model?.id,
        preference,
        registry: ctx.modelRegistry,
        getSessionName: () => pi.getSessionName(),
        setSessionName: (name) => {
          pi.setSessionName(name);
        },
      });
      reportFailure(ctx, outcome, reportedFailures);
    } catch {
      // Scheduling a name must never disturb the conversation.
    }
  });
}

/**
 * Pick the model that names sessions and persist the choice, shared by
 * `/xpi-session-naming models` and its long-form alias `/xpi-session-naming-model`.
 * Never touches the conversation's active model or Pi's own model selection.
 */
async function pickNamingModel(ctx: ExtensionCommandContext): Promise<void> {
  try {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("选择命名模型需要 TUI 模式", "warning");
      return;
    }
    const models = pickableModels(ctx);
    if (models.length === 0) {
      ctx.ui.notify("没有可用模型，命名模型保持不变", "warning");
      return;
    }
    const { diagnostic, preference } = await readTopicModelConfig();
    if (diagnostic) {
      ctx.ui.notify(diagnostic, "warning");
    }
    const picked = await ctx.ui.custom<Model<Api> | null>(
      (tui, theme, keybindings, done) =>
        new ModelPicker({
          current: resolveTopicModel(ctx.modelRegistry, preference),
          keybindings,
          models,
          onCancel: () => done(null),
          onPick: (model) => done(model),
          theme,
          tui,
        }),
    );
    if (!picked) {
      return;
    }
    await writeTopicModelConfig({
      id: picked.id,
      provider: picked.provider,
    });
    ctx.ui.notify(`命名模型已设为 ${modelLabel(picked)}`, "info");
  } catch (error) {
    ctx.ui.notify(
      `命名模型未修改: ${error instanceof Error ? error.message : "unknown error"}`,
      "error",
    );
  }
}

/**
 * The same candidates the `/model-name` picker offers: the session's scoped
 * models when scoping is configured, otherwise every available model.
 */
function pickableModels(ctx: ExtensionContext): Model<Api>[] {
  return ctx.scopedModels.length > 0
    ? ctx.scopedModels.map((entry) => entry.model)
    : ctx.modelRegistry.getAvailable();
}

/**
 * Reports a failed attempt once per failure kind, naming the cause. No prompt or
 * topic text is ever included: the only quoted text is the provider's own error.
 */
function reportFailure(
  ctx: ExtensionContext,
  outcome: NamingOutcome,
  reported: Set<NamingFailureReason>,
): void {
  if (outcome.status === "named") {
    reported.clear();
    return;
  }
  if (outcome.status !== "failed" || !ctx.hasUI || reported.has(outcome.reason)) {
    return;
  }
  reported.add(outcome.reason);
  ctx.ui.notify(failureText(outcome.reason, outcome.detail), "warning");
}

/** One line per cause, so the message says what to change. */
function failureText(reason: NamingFailureReason, detail?: string): string {
  switch (reason) {
    case "no-primary-model":
      return "当前模型信息不可用，会话名保持不变";
    case "no-topic-model":
      return "没有可用的命名模型，运行 /xpi-session-naming models 选择";
    case "topic-error":
      return detail === undefined ? "命名模型调用失败" : `命名模型调用失败：${detail}`;
    case "topic-timeout":
      return "命名模型 15 秒未响应";
    case "topic-empty":
      return "命名模型没有返回内容";
    case "topic-rejected":
      return "命名模型返回的内容不能用作名字";
    case "error":
      // biome-ignore lint/security/noSecrets: user-facing message, not a credential
      return "命名过程遇到意外错误，会话名保持不变";
  }
}
