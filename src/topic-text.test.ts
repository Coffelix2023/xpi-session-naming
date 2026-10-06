import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { completedUserTexts } from "./naming-eligibility.ts";
import {
  buildTopicPrompt,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_MESSAGES,
  normalizeTopic,
  TOPIC_MAX_LENGTH,
} from "./topic-text.ts";

const AT = "2026-01-01T00:00:00.000Z";
const TOOL_MARKER = "TOOL-OUTPUT-MARKER";
const ASSISTANT_TEXT = "好的，我来看看";

type EntryMessage = NonNullable<
  Extract<
    SessionEntry,
    {
      type: "message";
    }
  >["message"]
>;

function messageEntry(id: string, message: EntryMessage): SessionEntry {
  return {
    id,
    message,
    parentId: null,
    timestamp: AT,
    type: "message",
  };
}

function userEntry(id: string, content: string): SessionEntry {
  return messageEntry(id, {
    content,
    role: "user",
    timestamp: 0,
  });
}

function assistantEntry(id: string, content = ASSISTANT_TEXT): SessionEntry {
  return messageEntry(id, fauxAssistantMessage(content));
}

function toolResultEntry(id: string): SessionEntry {
  return messageEntry(id, {
    isError: false,
    role: "toolResult",
    timestamp: 0,
    toolCallId: "call-1",
    toolName: "read",
    content: [
      {
        text: TOOL_MARKER,
        type: "text",
      },
    ],
  });
}

describe("buildTopicPrompt", () => {
  it("asks for a concise Chinese subject without explanations, markdown, or line breaks", () => {
    const prompt = buildTopicPrompt([
      "帮我看看登录失败",
    ]);
    expect(prompt).toContain("简体中文");
    expect(prompt).toContain("不要解释");
    expect(prompt).toContain("Markdown");
    expect(prompt).toContain("不要换行");
  });

  it("numbers the relevant user messages", () => {
    const prompt = buildTopicPrompt([
      "hello",
      "帮我看看登录失败",
    ]);
    expect(prompt).toContain("1. hello");
    expect(prompt).toContain("2. 帮我看看登录失败");
  });

  it("carries no tool output, assistant text, or other session data", () => {
    const branch = [
      userEntry("u1", "hello"),
      assistantEntry("a1"),
      toolResultEntry("t1"),
      userEntry("u2", "帮我看看登录失败"),
      assistantEntry("a2"),
    ];
    const prompt = buildTopicPrompt(completedUserTexts(branch));
    expect(prompt).toContain("hello");
    expect(prompt).toContain("帮我看看登录失败");
    expect(prompt).not.toContain(TOOL_MARKER);
    expect(prompt).not.toContain(ASSISTANT_TEXT);
    expect(prompt).not.toContain("toolResult");
  });

  it(`sends at most ${MAX_CONTEXT_MESSAGES} messages`, () => {
    const prompt = buildTopicPrompt([
      "first-turn",
      "second-turn",
      "third-turn",
    ]);
    expect(prompt).toContain("second-turn");
    expect(prompt).not.toContain("third-turn");
  });

  it("honors an explicit limit instead of the automatic default", () => {
    const prompt = buildTopicPrompt(
      [
        "first-turn",
        "second-turn",
        "third-turn",
      ],
      3,
    );
    expect(prompt).toContain("third-turn");
  });
  it("collapses message whitespace so the prompt keeps its shape", () => {
    const prompt = buildTopicPrompt([
      "\n 帮我看看\n 登录失败 \n",
    ]);
    expect(prompt).toContain("1. 帮我看看 登录失败");
  });

  it(`bounds each message to ${MAX_CONTEXT_CHARS} code points`, () => {
    const blob = "A".repeat(MAX_CONTEXT_CHARS * 2);
    const prompt = buildTopicPrompt([
      blob,
    ]);
    expect(prompt).toContain("A".repeat(MAX_CONTEXT_CHARS));
    expect(prompt).not.toContain("A".repeat(MAX_CONTEXT_CHARS + 1));
  });

  it("returns the instructions alone when there is nothing to summarize", () => {
    const prompt = buildTopicPrompt([
      "   ",
      "",
    ]);
    expect(prompt).toContain("简体中文");
    expect(prompt).not.toContain("用户消息：");
  });
});

describe("normalizeTopic", () => {
  it("accepts a plain topic", () => {
    expect(normalizeTopic("登录失败排查")).toBe("登录失败排查");
  });

  it("strips wrapping quotes, backticks, and emphasis", () => {
    expect(normalizeTopic('  "登录失败排查"  ')).toBe("登录失败排查");
    expect(normalizeTopic("`登录失败排查`")).toBe("登录失败排查");
    expect(normalizeTopic("**登录失败排查**")).toBe("登录失败排查");
    expect(normalizeTopic("「登录失败排查」")).toBe("登录失败排查");
  });

  it("rejects empty or whitespace-only output", () => {
    expect(normalizeTopic("")).toBeUndefined();
    expect(normalizeTopic("   \n  ")).toBeUndefined();
    expect(normalizeTopic('"  "')).toBeUndefined();
  });

  it("rejects multi-line output", () => {
    // biome-ignore lint/security/noSecrets: fixture text, not a credential
    expect(normalizeTopic("登录失败排查\n解释如下")).toBeUndefined();
  });

  it("rejects overlong output and keeps the limit boundary", () => {
    expect(normalizeTopic("主".repeat(TOPIC_MAX_LENGTH + 1))).toBeUndefined();
    expect(normalizeTopic("主".repeat(TOPIC_MAX_LENGTH))).toBe(
      "主".repeat(TOPIC_MAX_LENGTH),
    );
  });

  it("rejects output that is not Chinese", () => {
    expect(normalizeTopic("Login failure troubleshooting")).toBeUndefined();
  });

  it("rejects leftover markdown markers", () => {
    expect(normalizeTopic("登录失败**排查")).toBeUndefined();
    expect(normalizeTopic("- 登录失败排查")).toBeUndefined();
  });
});
