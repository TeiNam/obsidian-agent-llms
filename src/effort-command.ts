// ============================================
// /effort 채팅 명령 모듈
// ============================================
// 채팅 입력에서 `/effort [레벨]`을 판별하고 결과를 계산하는 순수 함수.
// AI에 보내지 않고 대화 기록에도 남기지 않는 로컬 명령이다.

import type { EffortLevel } from "./types";

/** 명령 이름. 대소문자를 구분하지 않는다. */
const EFFORT_COMMAND = "/effort";

export type EffortCommandResult =
  | { kind: "show"; current: EffortLevel; allowed: readonly EffortLevel[] }
  | { kind: "set"; level: EffortLevel }
  | { kind: "invalid"; input: string; allowed: readonly EffortLevel[] }
  | { kind: "unsupported" };

/**
 * `/effort` 명령이면 인자(없으면 "")를, 아니면 null을 돌려준다.
 * `/effortless`처럼 명령 이름으로 시작하는 다른 단어는 명령이 아니다.
 */
export function parseEffortCommand(text: string): string | null {
  const [head, ...rest] = text.trim().split(/\s+/);
  if (head.toLowerCase() !== EFFORT_COMMAND) return null;
  return rest.join(" ").toLowerCase();
}

/**
 * 인자와 현재 모델의 허용 레벨로 명령 결과를 계산한다.
 * @param arg parseEffortCommand의 반환값
 * @param allowed 현재 모델이 받는 레벨(effortLevels). 비면 effort 미지원 모델
 * @param current 현재 실제로 전송되는 레벨(clampEffort 적용 값)
 */
export function resolveEffortCommand(
  arg: string,
  allowed: readonly EffortLevel[],
  current: EffortLevel
): EffortCommandResult {
  if (allowed.length === 0) return { kind: "unsupported" };
  if (arg === "") return { kind: "show", current, allowed };
  const level = allowed.find((l) => l === arg);
  return level ? { kind: "set", level } : { kind: "invalid", input: arg, allowed };
}
