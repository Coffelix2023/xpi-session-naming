/**
 * Naming eligibility: classify the user's effective input, then decide whether
 * the completed conversation already justifies an automatic session name.
 *
 * Effective input is the trimmed user text with Pi slash commands excluded, and
 * its length is counted in Unicode code points.
 */
/** More than this many code points counts as a meaningful request. */
export const MEANINGFUL_INPUT_CHARS = 10;

export type InputKind = "command" | "trivial" | "meaningful";

export interface EffectiveInput {
  /** Code points in the trimmed input; 0 for a slash command. */
  chars: number;
  kind: InputKind;
}

/** The slice of `SessionEntry` this module reads; only message entries matter. */
export interface BranchEntry {
  message?: {
    role?: string;
    content?: unknown;
  };
  type: string;
}

export type NamingDecision =
  | {
      eligible: false;
      reason: "no-user-turn" | "awaiting-second-turn";
    }
  | {
      eligible: true;
      reason: "meaningful-first-turn" | "second-turn";
    };

export function classifyInput(text: string): EffectiveInput {
  const trimmed = text.trim();
  // Pi records slash commands and expanded prompt templates as user messages.
  if (trimmed.startsWith("/")) {
    return {
      chars: 0,
      kind: "command",
    };
  }
  const chars = [
    ...trimmed,
  ].length;
  return {
    chars,
    kind: chars > MEANINGFUL_INPUT_CHARS ? "meaningful" : "trivial",
  };
}

/**
 * Text of every completed user message in the branch, oldest first. A user
 * message counts once an assistant message follows it, so tool results,
 * assistant-only turns, and repeated lifecycle events cannot add turns; a
 * trailing user message whose turn is still running is not counted yet.
 */
export function completedUserTexts(branch: readonly BranchEntry[]): string[] {
  const texts: string[] = [];
  const pending: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message") {
      continue;
    }
    const role = entry.message?.role;
    if (role === "user") {
      pending.push(userTextOf(entry.message?.content));
    } else if (role === "assistant" && pending.length > 0) {
      texts.push(...pending);
      pending.length = 0;
    }
  }
  return texts;
}

/**
 * A meaningful first turn names the session right away; a trivial first turn
 * (including a slash command or `hello`) waits for the second completed turn.
 */
export function namingDecision(userTexts: readonly string[]): NamingDecision {
  const first = userTexts[0];
  if (first === undefined) {
    return {
      eligible: false,
      reason: "no-user-turn",
    };
  }
  if (classifyInput(first).kind === "meaningful") {
    return {
      eligible: true,
      reason: "meaningful-first-turn",
    };
  }
  if (userTexts.length < 2) {
    return {
      eligible: false,
      reason: "awaiting-second-turn",
    };
  }
  return {
    eligible: true,
    reason: "second-turn",
  };
}

function userTextOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (
        block,
      ): block is {
        type: "text";
        text: string;
      } => {
        const candidate = block as {
          type?: unknown;
          text?: unknown;
        };
        return candidate.type === "text" && typeof candidate.text === "string";
      },
    )
    .map((block) => block.text)
    .join(" ");
}
