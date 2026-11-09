import { describe, it, expect } from "vitest";
import { parseEffortCommand, resolveEffortCommand } from "./effort-command";
import type { EffortLevel } from "./types";

const ANTHROPIC: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

describe("parseEffortCommand", () => {
  it("인자를 소문자로 돌려주고, 인자가 없으면 빈 문자열이다", () => {
    expect(parseEffortCommand("/effort High")).toBe("high");
    expect(parseEffortCommand("  /EFFORT  ")).toBe("");
  });

  it("명령이 아니면 null — 일반 메시지와 비슷한 단어는 AI에 그대로 보낸다", () => {
    expect(parseEffortCommand("effort high")).toBeNull();
    expect(parseEffortCommand("/effortless")).toBeNull();
    expect(parseEffortCommand("what is /effort?")).toBeNull();
  });
});

describe("resolveEffortCommand", () => {
  it("인자가 없으면 현재 값과 허용 목록을 보여준다", () => {
    expect(resolveEffortCommand("", ANTHROPIC, "high")).toEqual({ kind: "show", current: "high", allowed: ANTHROPIC });
  });

  it("허용 레벨이면 변경한다", () => {
    expect(resolveEffortCommand("max", ANTHROPIC, "high")).toEqual({ kind: "set", level: "max" });
  });

  it("현재 모델이 받지 않는 레벨은 바꾸지 않는다", () => {
    expect(resolveEffortCommand("minimal", ANTHROPIC, "high")).toEqual({ kind: "invalid", input: "minimal", allowed: ANTHROPIC });
    expect(resolveEffortCommand("turbo", ANTHROPIC, "high").kind).toBe("invalid");
  });

  it("effort 미지원 모델이면 unsupported", () => {
    expect(resolveEffortCommand("high", [], "medium")).toEqual({ kind: "unsupported" });
  });
});
