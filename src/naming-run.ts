/**
 * One naming attempt per completed run.
 *
 * Everything the attempt needs is passed in, so the caller owns lifecycle and
 * session APIs while this module owns the guards: an existing name (checked
 * before and after the model call, so a manual rename always wins) and a single
 * in-flight attempt.
 *
 * Failures are returned with their cause, never thrown, and the only text a
 * failure carries is the provider's own error message — never prompt or topic
 * text.
 *
 * A manual request (`manual: true`) is the user's own command, not a scheduled
 * best effort: it overwrites any existing name, skips the eligibility gate, and
 * reads the newest completed messages instead of the first ones.
 */
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
  type BranchEntry,
  completedUserTexts,
  namingDecision,
} from "./naming-eligibility.ts";
import { bareModelId, composeSessionName } from "./session-name.ts";
import {
  generateTopic,
  type TopicFailure,
  type TopicModelRegistry,
} from "./topic-model.ts";
import type { TopicModelPreference } from "./topic-model-config.ts";
import {
  buildTopicPrompt,
  MANUAL_CONTEXT_MESSAGES,
  MAX_CONTEXT_MESSAGES,
  normalizeTopic,
} from "./topic-text.ts";

export interface NamingRequest {
  branch: readonly BranchEntry[];
  /** Tried last when nothing else resolves: the primary conversation model. */
  fallback?: Model<Api>;
  getSessionName(): string | undefined;
  /**
   * Manual rename: overwrite the existing name, skip the eligibility gate, and
   * summarize the newest completed messages instead of the first ones.
   */
  manual?: boolean;
  /** Primary conversation model id; it becomes the name prefix. */
  modelId: string | undefined;
  /** Chosen by `/xpi-session-naming-model`; absent means the default chain. */
  preference?: TopicModelPreference;
  registry: TopicModelRegistry;
  setSessionName(name: string): void;
}

export type NamingFailureReason =
  | "no-context"
  | "no-primary-model"
  | "no-topic-model"
  | "topic-error"
  | "topic-timeout"
  | "topic-empty"
  | "topic-rejected"
  | "error";

export type NamingOutcome =
  | {
      /** The candidate that actually answered, as `provider/id`. */
      model: string;
      name: string;
      status: "named";
    }
  | {
      reason: "in-flight" | "already-named" | "not-eligible";
      status: "skipped";
    }
  | {
      /** Provider error text only; never prompt or topic text. */
      detail?: string;
      reason: NamingFailureReason;
      status: "failed";
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
    const manual = request.manual === true;
    // The automatic path never overwrites a name; the user's own command always may.
    if (!manual && request.getSessionName() !== undefined) {
      return {
        reason: "already-named",
        status: "skipped",
      };
    }
    const userTexts = completedUserTexts(request.branch);
    if (manual) {
      // An explicit rename needs any completed message; the newest ones are the topic.
      if (userTexts.length === 0) {
        return {
          reason: "no-context",
          status: "failed",
        };
      }
    } else if (!namingDecision(userTexts).eligible) {
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
      const limit = manual ? MANUAL_CONTEXT_MESSAGES : MAX_CONTEXT_MESSAGES;
      const generated = await generateTopic(
        request.registry,
        topicContext(
          buildTopicPrompt(manual ? userTexts.slice(-limit) : userTexts, limit),
        ),
        {
          fallback: request.fallback,
          preference: request.preference,
        },
      );
      if (!generated.ok) {
        return failedOutcome(generated.failure);
      }
      const topic = normalizeTopic(generated.text);
      if (topic === undefined) {
        return {
          reason: "topic-rejected",
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
      if (!manual && request.getSessionName() !== undefined) {
        return {
          reason: "already-named",
          status: "skipped",
        };
      }
      request.setSessionName(name);
      return {
        model: generated.model,
        name,
        status: "named",
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

function failedOutcome(failure: TopicFailure): NamingOutcome {
  switch (failure.kind) {
    case "no-model":
      return {
        reason: "no-topic-model",
        status: "failed",
      };
    case "provider-error":
      return failure.detail.length > 0
        ? {
            detail: failure.detail,
            reason: "topic-error",
            status: "failed",
          }
        : {
            reason: "topic-error",
            status: "failed",
          };
    case "timeout":
      return {
        reason: "topic-timeout",
        status: "failed",
      };
    case "empty":
      return {
        reason: "topic-empty",
        status: "failed",
      };
  }
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
