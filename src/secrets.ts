// API 키를 Obsidian 비밀 저장소(SecretStorage)에 두기 위한 연결 계층.
// 설정(data.json)에는 비밀의 이름만 저장하고, 값은 필요할 때 이름으로 읽는다.

import type { SecretStorage } from "obsidian";

/**
 * 비밀 값 필드와, 그 비밀의 이름을 저장하는 설정 필드의 짝.
 * `defaultId`는 예전 저장소(로컬 파일·모바일 항목·data.json)의 키를 옮길 때 쓰는 비밀 이름이다.
 */
export const SECRET_FIELDS = [
  { value: "geminiApiKey", id: "geminiApiKeySecret", defaultId: "agent-llms-gemini-key" },
  { value: "bedrockApiKey", id: "bedrockApiKeySecret", defaultId: "agent-llms-bedrock-key" },
  { value: "openaiApiKey", id: "openaiApiKeySecret", defaultId: "agent-llms-openai-key" },
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];
export type SecretValues = Record<SecretField["value"], string>;
export type SecretIds = Record<SecretField["id"], string>;

/** 설정이 가리키는 비밀의 실제 값. 이름이 비었거나 그 비밀이 없으면 빈 문자열이다. */
export function resolveSecrets(ids: SecretIds, storage: Pick<SecretStorage, "getSecret">): SecretValues {
  return Object.fromEntries(
    SECRET_FIELDS.map((field) => {
      const id = ids[field.id];
      return [field.value, id ? (storage.getSecret(id) ?? "").trim() : ""];
    })
  ) as SecretValues;
}

/**
 * 예전 저장소의 키를 비밀 저장소로 옮긴다.
 *
 * 같은 이름의 비밀이 이미 있으면 덮어쓰지 않는다 — 사용자가 키체인에서 직접 넣은 값이 더 최신이다.
 *
 * @returns 새로 채워야 할 비밀 이름. 이미 이름이 있던 필드는 들어 있지 않다.
 */
export function importLegacySecrets(
  ids: SecretIds,
  legacy: Partial<SecretValues>,
  storage: Pick<SecretStorage, "getSecret" | "setSecret">
): Partial<SecretIds> {
  const assigned: Partial<SecretIds> = {};
  for (const field of SECRET_FIELDS) {
    const value = legacy[field.value]?.trim();
    if (!value) continue;
    const id = ids[field.id] || field.defaultId;
    if (storage.getSecret(id) === null) storage.setSecret(id, value);
    if (!ids[field.id]) assigned[field.id] = id;
  }
  return assigned;
}
