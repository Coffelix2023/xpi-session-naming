import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNamer, type NamingOutcome } from "./naming-run.ts";

const VERSION = "0.1.0";
export default function xpiSessionNaming(pi: ExtensionAPI): void {
  const maybeNameSession = createNamer();

  pi.registerCommand("xpi-session-naming", {
    description: "Show xpi-session-naming status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-session-naming ${VERSION} loaded`);
    },
  });

  // `agent_settled` is the boundary where Pi will not continue on its own, so
  // every completed user turn is already on the branch. Turn counts come from
  // the branch, never from event payloads.
  pi.on("agent_settled", async (_event, ctx) => {
    try {
      const outcome = await maybeNameSession({
        branch: ctx.sessionManager.getBranch(),
        modelId: ctx.model?.id,
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
