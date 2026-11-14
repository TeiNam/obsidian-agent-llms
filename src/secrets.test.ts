import { describe, expect, it } from "vitest";
import { importLegacySecrets, resolveSecrets } from "./secrets";

/** Obsidian SecretStorage의 공개 메서드만 흉내 낸 저장소. */
function fakeStorage(initial: Record<string, string> = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    getSecret: (id: string) => secrets.get(id) ?? null,
    setSecret: (id: string, value: string) => { secrets.set(id, value); },
    all: () => Object.fromEntries(secrets),
  };
}

const NO_IDS = { geminiApiKeySecret: "", bedrockApiKeySecret: "", openaiApiKeySecret: "" };

describe("resolveSecrets", () => {
  it("비밀 이름이 가리키는 값을 돌려준다", () => {
    const storage = fakeStorage({ "my-gemini": "g-key", "my-openai": "o-key" });

    const values = resolveSecrets(
      { geminiApiKeySecret: "my-gemini", bedrockApiKeySecret: "", openaiApiKeySecret: "my-openai" },
      storage
    );

    expect(values).toEqual({ geminiApiKey: "g-key", bedrockApiKey: "", openaiApiKey: "o-key" });
  });

  it("이름이 가리키는 비밀이 없으면 빈 문자열이다", () => {
    const values = resolveSecrets({ ...NO_IDS, geminiApiKeySecret: "deleted-secret" }, fakeStorage());

    expect(values.geminiApiKey).toBe("");
  });

  it("붙여넣다 딸려 온 앞뒤 공백을 뗀다", () => {
    const values = resolveSecrets(
      { ...NO_IDS, openaiApiKeySecret: "my-openai" },
      fakeStorage({ "my-openai": "  o-key\n" })
    );

    expect(values.openaiApiKey).toBe("o-key");
  });
});

describe("importLegacySecrets", () => {
  it("예전 키를 기본 이름의 비밀로 옮기고 그 이름을 돌려준다", () => {
    const storage = fakeStorage();

    const ids = importLegacySecrets(NO_IDS, { geminiApiKey: "g-key", bedrockApiKey: "b-key" }, storage);

    expect(storage.all()).toEqual({ "agent-llms-gemini-key": "g-key", "agent-llms-bedrock-key": "b-key" });
    expect(ids).toEqual({
      geminiApiKeySecret: "agent-llms-gemini-key",
      bedrockApiKeySecret: "agent-llms-bedrock-key",
    });
  });

  it("다른 기기에서 고른 이름이 동기화돼 있으면 그 이름으로 옮긴다", () => {
    const storage = fakeStorage();

    const ids = importLegacySecrets({ ...NO_IDS, openaiApiKeySecret: "work-openai" }, { openaiApiKey: "o-key" }, storage);

    expect(storage.all()).toEqual({ "work-openai": "o-key" });
    expect(ids).toEqual({});
  });

  it("같은 이름의 비밀이 이미 있으면 덮어쓰지 않는다", () => {
    const storage = fakeStorage({ "agent-llms-gemini-key": "newer" });

    const ids = importLegacySecrets(NO_IDS, { geminiApiKey: "older" }, storage);

    expect(storage.all()).toEqual({ "agent-llms-gemini-key": "newer" });
    expect(ids).toEqual({ geminiApiKeySecret: "agent-llms-gemini-key" });
  });

  it("빈 값은 옮기지 않는다", () => {
    const storage = fakeStorage();

    const ids = importLegacySecrets(NO_IDS, { geminiApiKey: "", openaiApiKey: "   " }, storage);

    expect(storage.all()).toEqual({});
    expect(ids).toEqual({});
  });
});
