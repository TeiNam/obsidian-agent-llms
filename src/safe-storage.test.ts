import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { DEFAULT_SETTINGS, GeminiAssistantSettings } from "./types";

import {
  SENSITIVE_FIELDS,
  stripSensitiveFields,
  LEGACY_SENSITIVE_FIELDS,
  LEGACY_OBSOLETE_FIELDS,
} from "./safe-storage";

// ============================================
// 단위 테스트: SENSITIVE_FIELDS 필드 포함 확인
// ============================================

describe("SENSITIVE_FIELDS", () => {
  it("geminiApiKey를 포함한다", () => {
    expect(SENSITIVE_FIELDS).toContain("geminiApiKey");
  });

});

// ============================================
// 단위 테스트: SENSITIVE_FIELDS 멤버십 (multi-provider-ai-backends)
// ============================================
// OpenAI API 키는 민감 필드에 포함되어야 하고(Req 3.1),
// Ollama 서버 base URL은 비민감이므로 포함되지 않아야 한다(Req 3.5).

describe("SENSITIVE_FIELDS 멤버십 (multi-provider)", () => {
  it("openaiApiKey를 포함한다 (OpenAI 자격증명, Req 3.1)", () => {
    expect(SENSITIVE_FIELDS).toContain("openaiApiKey");
  });

  it("bedrockApiKey를 포함한다 (Bedrock API 키 인증)", () => {
    expect(SENSITIVE_FIELDS).toContain("bedrockApiKey");
  });

  it("ollamaBaseUrl을 포함하지 않는다 (비민감, data.json 일반 저장 — Req 3.5)", () => {
    expect(SENSITIVE_FIELDS).not.toContain("ollamaBaseUrl");
  });

});

// ============================================
// 폐기된 액세스 키 필드 제거
// ============================================

describe("stripSensitiveFields: 폐기된 액세스 키 필드", () => {
  it("구 data.json에 남은 평문 액세스 키를 제거한다", () => {
    // 0.3.0에서 액세스 키 인증을 제거하면서 두 필드를 SENSITIVE_FIELDS에서 뺐다.
    // strip 대상에서도 빠지면 구 설정의 평문 키가 클라우드 동기화되는 data.json에
    // 그대로 재저장된다 — 제거가 오히려 유출을 만든다.
    const legacy = {
      awsRegion: "us-east-1",
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    } as unknown as GeminiAssistantSettings;

    const stripped = stripSensitiveFields(legacy) as unknown as Record<string, unknown>;

    // 빈 문자열로 남기지 않고 키 자체를 지운다.
    expect("awsAccessKeyId" in stripped).toBe(false);
    expect("awsSecretAccessKey" in stripped).toBe(false);
    // 비민감 필드는 보존한다.
    expect(stripped.awsRegion).toBe("us-east-1");
  });

  it("원본 객체를 변경하지 않는다", () => {
    const legacy = {
      awsAccessKeyId: "AKID",
    } as unknown as GeminiAssistantSettings;

    stripSensitiveFields(legacy);

    expect((legacy as unknown as Record<string, unknown>).awsAccessKeyId).toBe("AKID");
  });
});

// ============================================
// Property 4: 민감 필드 strip 일관성
// ============================================

/**
 * Property 4: 민감 필드 strip 일관성
 *
 * 임의의 설정 객체에 대해, stripSensitiveFields 결과는
 * openaiApiKey를 포함한 모든 SENSITIVE_FIELDS를 빈 문자열로 만들고,
 * 비민감 필드인 ollamaBaseUrl 값은 원본 그대로 보존한다.
 *
 * Validates: Requirements 3.1, 3.3, 3.5
 */
describe("Property 4: 민감 필드 strip 일관성", () => {
  // Feature: multi-provider-ai-backends, Property 4: 민감 필드 strip 일관성
  it("모든 SENSITIVE_FIELDS는 빈 문자열로 제거되고, 비민감 ollamaBaseUrl은 원본 그대로 보존된다", () => {
    fc.assert(
      fc.property(
        // 각 민감 필드(OpenAI/Gemini/AWS 키)에 임의 값을 부여
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        // 비민감 필드 ollamaBaseUrl 값 (빈 문자열 포함 가능)
        fc.string({ maxLength: 120 }),
        (geminiKey, bedrockKey, openaiKey, ollamaUrl) => {
          const settings: GeminiAssistantSettings = {
            ...DEFAULT_SETTINGS,
            geminiApiKey: geminiKey,
            bedrockApiKey: bedrockKey,
            openaiApiKey: openaiKey,
            ollamaBaseUrl: ollamaUrl,
          };

          const stripped = stripSensitiveFields(settings);
          const strippedRecord = stripped as unknown as Record<string, unknown>;

          // 모든 민감 필드는 빈 문자열로 제거되어야 함 (Req 3.1, 3.3)
          for (const field of SENSITIVE_FIELDS) {
            expect(strippedRecord[field]).toBe("");
          }

          // 비민감 필드 ollamaBaseUrl은 원본 그대로 보존되어야 함 (Req 3.5)
          expect(stripped.ollamaBaseUrl).toBe(ollamaUrl);

          // 원본 객체는 변경되지 않아야 함 (불변성 보장)
          expect(settings.openaiApiKey).toBe(openaiKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================
// 폐기된 비-비밀 필드 제거 및 목록 분리
// ============================================

describe("LEGACY_OBSOLETE_FIELDS: 폐기된 비-비밀 필드", () => {
  it("awsAuthMethod·awsProfile을 저장 시 제거한다", () => {
    // 남으면 filterStaleCredentials가 매 실행마다 같은 판정을 반복하고,
    // 마이그레이션 분기는 그 함수를 타지 않아 잔존 키가 적용될 수 있다.
    const legacy = {
      awsAuthMethod: "profile",
      awsProfile: "my-profile",
      awsRegion: "ap-northeast-2",
    } as unknown as GeminiAssistantSettings;

    const stripped = stripSensitiveFields(legacy) as unknown as Record<string, unknown>;

    expect("awsAuthMethod" in stripped).toBe(false);
    expect("awsProfile" in stripped).toBe(false);
    // 비폐기 필드는 보존한다.
    expect(stripped.awsRegion).toBe("ap-northeast-2");
  });

  it("비밀 목록과 비-비밀 목록이 겹치지 않는다", () => {
    // 겹치면 main.ts의 hasMigratedKeys 판정이 모든 구 사용자를 마이그레이션
    // 분기로 보내고, 그 분기는 filterStaleCredentials를 타지 않는다.
    const secrets = new Set<string>(SENSITIVE_FIELDS);
    for (const field of LEGACY_SENSITIVE_FIELDS) secrets.add(field);
    for (const field of LEGACY_OBSOLETE_FIELDS) {
      expect(secrets.has(field)).toBe(false);
    }
  });
});
