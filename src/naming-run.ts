/**
 * One naming attempt per completed run.
 *
 * Everything the attempt needs is passed in, so the caller owns lifecycle and
 * session APIs while this module owns the guards: an existing name (checked
 * before and after the model call, so a manual rename always wins) and a single
 * in-flight attempt. Failures are returned, never thrown.
 */
import type { Context } from "@earendil-works/pi-ai";
import {
  type BranchEntry,
  completedUserTexts,
  namingDecision,
} from "./naming-eligibility.ts";
import { bareModelId, composeSessionName } from "./session-name.ts";
import { generateTopic, type TopicModelRegistry } from "./topic-model.ts";
import type { TopicModelPreference } from "./topic-model-config.ts";
import { buildTopicPrompt, normalizeTopic } from "./topic-text.ts";

export interface NamingRequest {
  branch: readonly BranchEntry[];
  getSessionName(): string | undefined;
  /** Primary conversation model id; it becomes the name prefix. */
  modelId: string | undefined;
  /** Chosen by `/xpi-session-naming-model`; absent means the default chain. */
  preference?: TopicModelPreference;
  registry: TopicModelRegistry;
  setSessionName(name: string): void;
}

export type NamingOutcome =
  | {
      status: "named";
      name: string;
    }
  | {
      status: "skipped";
      reason: "in-flight" | "already-named" | "not-eligible";
    }
  | {
      status: "failed";
      reason: "no-primary-model" | "no-topic" | "error";
    };

export type MaybeNameSession = (request: NamingRequest) => Promise<NamingOutcome>;

export function createNamer(): MaybeNameSession {
  let inFlight = false;

  return async function maybeNameSession(
    request: NamingRequest,
  ): Promise<NamingOutcome> {
    if (inFlight) {
      return {
        reason: "in-flight",
        status: "skipped",
      };
    }
    if (request.getSessionName() !== undefined) {
      return {
        reason: "already-named",
        status: "skipped",
      };
    }
    const userTexts = completedUserTexts(request.branch);
    if (!namingDecision(userTexts).eligible) {
      return {
        reason: "not-eligible",
        status: "skipped",
      };
    }
    const modelId = bareModelId(request.modelId);
    if (!modelId) {
      // Fail before spending a request that could not be used as a name.
      return {
        reason: "no-primary-model",
        status: "failed",
      };
    }

    inFlight = true;
    try {
      const raw = await generateTopic(
        request.registry,
        topicContext(buildTopicPrompt(userTexts)),
        {
          preference: request.preference,
        },
      );
      const topic = raw === undefined ? undefined : normalizeTopic(raw);
      if (topic === undefined) {
        return {
          reason: "no-topic",
          status: "failed",
        };
      }
      const name = composeSessionName(modelId, topic);
      if (name === undefined) {
        return {
          reason: "no-primary-model",
          status: "failed",
        };
      }
      if (request.getSessionName() !== undefined) {
        return {
          reason: "already-named",
          status: "skipped",
        };
      }
      request.setSessionName(name);
      return {
        status: "named",
        name,
      };
    } catch {
      return {
        reason: "error",
        status: "failed",
      };
    } finally {
      inFlight = false;
    }
  };
}

function topicContext(prompt: string): Context {
  return {
    messages: [
      {
        content: prompt,
        role: "user",
        timestamp: Date.now(),
      },
    ],
  };
}
