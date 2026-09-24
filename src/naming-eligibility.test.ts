import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  classifyInput,
  completedUserTexts,
  MEANINGFUL_INPUT_CHARS,
  namingDecision,
} from "./naming-eligibility.ts";

const AT = "2026-01-01T00:00:00.000Z";

/** Above the threshold; built at runtime so the entropy scanner stays quiet. */
const MEANINGFUL_REQUEST = "登录失败".repeat(3);

function userEntry(id: string, content: string): SessionEntry {
  return {
    id,
    parentId: null,
    timestamp: AT,
    type: "message",
    message: {
      content,
      role: "user",
      timestamp: 0,
    },
  };
}

function assistantEntry(id: string): SessionEntry {
  return {
    id,
    message: fauxAssistantMessage("ok"),
    parentId: null,
    timestamp: AT,
    type: "message",
  };
}

function toolResultEntry(id: string): SessionEntry {
  return {
    id,
    parentId: null,
    timestamp: AT,
    type: "message",
    message: {
      content: [],
      isError: false,
      role: "toolResult",
      timestamp: 0,
      toolCallId: "call-1",
      toolName: "read",
    },
  };
}

function customEntry(id: string): SessionEntry {
  return {
    customType: "caveman-mode",
    id,
    parentId: null,
    timestamp: AT,
    type: "custom",
  };
}

describe("classifyInput", () => {
  it("treats `hello` as trivial", () => {
    expect(classifyInput("hello")).toEqual({
      chars: 5,
      kind: "trivial",
    });
  });

  it(`treats exactly ${MEANINGFUL_INPUT_CHARS} characters as trivial`, () => {
    expect(classifyInput("x".repeat(MEANINGFUL_INPUT_CHARS))).toEqual({
      chars: MEANINGFUL_INPUT_CHARS,
      kind: "trivial",
    });
  });

  it(`treats more than ${MEANINGFUL_INPUT_CHARS} characters as meaningful`, () => {
    expect(classifyInput(MEANINGFUL_REQUEST)).toEqual({
      chars: 12,
      kind: "meaningful",
    });
  });

  it("trims surrounding whitespace before counting", () => {
    expect(classifyInput("   hello   ")).toEqual({
      chars: 5,
      kind: "trivial",
    });
    expect(classifyInput("   ")).toEqual({
      chars: 0,
      kind: "trivial",
    });
  });

  it("excludes slash commands", () => {
    expect(classifyInput(" /model gpt-6-sol ")).toEqual({
      chars: 0,
      kind: "command",
    });
    expect(classifyInput("/skill:caveman")).toEqual({
      chars: 0,
      kind: "command",
    });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(classifyInput("😀😀😀")).toEqual({
      chars: 3,
      kind: "trivial",
    });
  });
});

describe("completedUserTexts", () => {
  it("counts a user turn completed by an assistant message", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
    ];
    expect(completedUserTexts(branch)).toEqual([
      "hello",
    ]);
  });

  it("does not count assistant-only turns", () => {
    expect(
      completedUserTexts([
        assistantEntry("a1"),
        assistantEntry("a2"),
      ]),
    ).toEqual([]);
  });

  it("does not count tool results, custom entries, or a still-running user turn", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
      toolResultEntry("t1"),
      customEntry("c1"),
      assistantEntry("a2"),
      userEntry("u2", "还在跑的这一轮"),
    ];
    expect(completedUserTexts(branch)).toEqual([
      "hello",
    ]);
  });

  it("counts the second user turn once it completes", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
      userEntry("u2", "帮我看看登录失败"),
      toolResultEntry("t1"),
      assistantEntry("a2"),
    ];
    expect(completedUserTexts(branch)).toEqual([
      "hello",
      "帮我看看登录失败",
    ]);
  });

  it("is stable across repeated reads of the same branch", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
    ];
    expect(completedUserTexts(branch)).toEqual(completedUserTexts(branch));
  });

  it("reads text blocks from structured content", () => {
    const entry: SessionEntry = {
      id: "u1",
      parentId: null,
      timestamp: AT,
      type: "message",
      message: {
        role: "user",
        timestamp: 0,
        content: [
          {
            text: "第一段",
            type: "text",
          },
          {
            data: "aGk=",
            mimeType: "image/png",
            type: "image",
          },
        ],
      },
    };
    expect(
      completedUserTexts([
        entry,
        assistantEntry("a1"),
      ]),
    ).toEqual([
      "第一段",
    ]);
  });
});

describe("namingDecision", () => {
  it("waits when no user turn has completed", () => {
    expect(namingDecision([])).toEqual({
      eligible: false,
      reason: "no-user-turn",
    });
  });

  it("names after a meaningful first turn", () => {
    expect(
      namingDecision([
        MEANINGFUL_REQUEST,
      ]),
    ).toEqual({
      eligible: true,
      reason: "meaningful-first-turn",
    });
  });

  it("defers a trivial first turn until the second turn completes", () => {
    expect(
      namingDecision([
        "hello",
      ]),
    ).toEqual({
      eligible: false,
      reason: "awaiting-second-turn",
    });
    expect(
      namingDecision([
        "hello",
        "帮我看看登录失败",
      ]),
    ).toEqual({
      eligible: true,
      reason: "second-turn",
    });
  });

  it("never treats a slash command as the meaningful first turn", () => {
    expect(
      namingDecision([
        "/model gpt-6-sol",
      ]),
    ).toEqual({
      eligible: false,
      reason: "awaiting-second-turn",
    });
    expect(
      namingDecision([
        "/model gpt-6-sol",
        "帮我看看登录失败",
      ]),
    ).toEqual({
      eligible: true,
      reason: "second-turn",
    });
  });

  it("decides from a realistic branch and is stable when events repeat", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
      userEntry("u2", "帮我看看登录失败"),
      assistantEntry("a2"),
    ];
    const texts = completedUserTexts(branch);
    expect(namingDecision(texts)).toEqual({
      eligible: true,
      reason: "second-turn",
    });
    expect(namingDecision(completedUserTexts(branch))).toEqual(namingDecision(texts));
  });
});
