import { describe, expect, it } from "vitest";
import { composeSessionName } from "./session-name.ts";

describe("composeSessionName", () => {
  it("formats the name as [main-model-id] - topic", () => {
    expect(composeSessionName("gpt-6-sol", "分析登录失败问题")).toBe(
      "[gpt-6-sol] - 分析登录失败问题",
    );
  });

  it("trims the model id", () => {
    expect(composeSessionName("  gpt-6-sol  ", "分析登录失败问题")).toBe(
      "[gpt-6-sol] - 分析登录失败问题",
    );
  });

  it("strips the provider segment from the model id", () => {
    expect(composeSessionName("deepseek/deepseek-v4.1-flash", "分析登录失败问题")).toBe(
      "[deepseek-v4.1-flash] - 分析登录失败问题",
    );
    expect(composeSessionName("a/b/c", "登录失败排查")).toBe("[c] - 登录失败排查");
  });

  it("fails safely when the provider prefix is all there is", () => {
    expect(composeSessionName("deepseek/", "登录失败排查")).toBeUndefined();
    expect(composeSessionName("/", "登录失败排查")).toBeUndefined();
  });

  it("fails safely without a usable main model id", () => {
    expect(composeSessionName(undefined, "分析登录失败问题")).toBeUndefined();
    expect(composeSessionName("", "分析登录失败问题")).toBeUndefined();
    expect(composeSessionName("   ", "分析登录失败问题")).toBeUndefined();
  });

  it("keeps the topic after the separator untouched", () => {
    expect(composeSessionName("m", "登录失败排查")).toBe("[m] - 登录失败排查");
  });
});
