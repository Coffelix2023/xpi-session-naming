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
  /** Session id for providers that require session-aware routing (e.g. OpenCode). */
  sessionId?: string;
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
  // The last automatic attempt spent a topic request and failed: the next
  // turn retries from the newest completed turns instead of re-sending the
  // identical first-turns prompt that just failed.
  let lastAutoFailed = false;
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

    // The last automatic attempt spent a topic request and failed: the next
    // turn retries from the newest completed turns instead of re-sending the
    // identical first-turns prompt that just failed. Snapshot before marking:
    // short sessions are unaffected (both slices are the whole list when
    // there are at most `limit` texts). Manual renames always read newest.
    const retryFromLatest = !manual && lastAutoFailed;
    inFlight = true;
    // A topic request is spent from here on, so an automatic run that does
    // not end named leaves a failed attempt behind for the next turn.
    if (!manual) {
      lastAutoFailed = true;
    }
    try {
      const limit = manual ? MANUAL_CONTEXT_MESSAGES : MAX_CONTEXT_MESSAGES;
      const relevant = manual || retryFromLatest ? userTexts.slice(-limit) : userTexts;
      const generated = await generateTopic(
        request.registry,
        topicContext(buildTopicPrompt(relevant, limit)),
        {
          fallback: request.fallback,
          preference: request.preference,
          sessionId: request.sessionId,
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
      // The session is named: a later round starts fresh from the oldest turns.
      lastAutoFailed = false;
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
