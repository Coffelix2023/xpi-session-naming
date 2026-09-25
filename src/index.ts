import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNamer, type NamingOutcome } from "./naming-run.ts";
import { resolveTopicModel } from "./topic-model.ts";
import { readTopicModelConfig, writeTopicModelConfig } from "./topic-model-config.ts";
import { ModelPicker, modelLabel } from "./ui/model-picker.ts";

const VERSION = "0.1.0";
const MODEL_COMMAND = "xpi-session-naming-model";

export default function xpiSessionNaming(pi: ExtensionAPI): void {
  const maybeNameSession = createNamer();

  pi.registerCommand("xpi-session-naming", {
    description: "Show xpi-session-naming status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-session-naming ${VERSION} loaded`);
    },
  });

  pi.registerCommand(MODEL_COMMAND, {
    description: "Choose the model that names sessions",
    handler: async (_args, ctx) => {
      try {
        if (ctx.mode !== "tui") {
          ctx.ui.notify(`/${MODEL_COMMAND} requires TUI mode`, "warning");
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
    },
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
        modelId: ctx.model?.id,
        preference,
        registry: ctx.modelRegistry,
        getSessionName: () => pi.getSessionName(),
        setSessionName: (name) => {
          pi.setSessionName(name);
        },
      });
      notifyFailure(ctx, outcome);
    } catch {
      // Scheduling a name must never disturb the conversation.
    }
  });
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

/** Naming failures are reported without prompt or topic text. */
function notifyFailure(ctx: ExtensionContext, outcome: NamingOutcome): void {
  if (outcome.status !== "failed" || !ctx.hasUI) {
    return;
  }
  ctx.ui.notify(
    outcome.reason === "no-primary-model"
      ? // biome-ignore lint/security/noSecrets: user-facing message, not a credential
        "当前模型信息不可用，未自动命名本次会话"
      : "自动命名会话失败，会话名保持不变",
    "warning",
  );
}
