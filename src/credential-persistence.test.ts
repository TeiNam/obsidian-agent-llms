import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

// Electron의 동적 require 경계를 그대로 실행하고 파일·키체인만 격리한다.
const bundled = buildSync({
  entryPoints: ["src/safe-storage.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["obsidian"],
  write: false,
}).outputFiles[0].text;
let api: typeof import("./safe-storage");

const directory = "/credential-test";
const credentialPath = join(directory, "agent-llms-credentials.json");
let files: Map<string, string>;
let fs: {
  existsSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  renameSync: ReturnType<typeof vi.fn>;
  unlinkSync: ReturnType<typeof vi.fn>;
};
let encryptionAvailable: boolean;

beforeEach(() => {
  files = new Map();
  encryptionAvailable = true;
  fs = {
    existsSync: vi.fn((path: string) => files.has(path)),
    readFileSync: vi.fn((path: string) => files.get(path)),
    writeFileSync: vi.fn((path: string, data: string) => { files.set(path, data); }),
    renameSync: vi.fn((from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    unlinkSync: vi.fn((path: string) => { files.delete(path); }),
  };
  const require = (id: string) => {
    if (id === "obsidian") return { requireApiVersion: () => true };
    if (id === "fs") return fs;
    if (id === "path") return { join };
    if (id === "electron") return {
      app: { getPath: () => directory },
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (value: string) => Buffer.from(value),
        decryptString: (value: Buffer) => value.toString(),
      },
    };
    throw new Error(`Unexpected module: ${id}`);
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  const module = { exports: {} };
  runInNewContext(bundled, { module, require, Buffer, window: { crypto: { randomUUID } }, console });
  api = module.exports as typeof import("./safe-storage");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 예전 PC 버전의 형식: "enc:" + base64(OS 키체인 암호문). 테스트의 키체인은 평문을 그대로 돌려준다. */
const encrypted = (value: string) => `enc:${Buffer.from(value).toString("base64")}`;

describe("예전 PC 자격증명 파일 읽기", () => {
  it("암호화된 키를 복호화해 돌려준다", () => {
    files.set(credentialPath, JSON.stringify({ geminiApiKey: encrypted("g-key"), openaiApiKey: encrypted("o-key") }));
    expect(api.loadCredentialsFromLocal()).toEqual({ geminiApiKey: "g-key", openaiApiKey: "o-key" });
  });

  it("파일이 없으면 빈 객체다", () => {
    expect(api.loadCredentialsFromLocal()).toEqual({});
  });

  it("OS 키체인을 쓸 수 없으면 암호문을 그대로 돌려줘 호출부가 가려낼 수 있게 한다", () => {
    files.set(credentialPath, JSON.stringify({ geminiApiKey: encrypted("g-key") }));
    encryptionAvailable = false;
    const loaded = api.loadCredentialsFromLocal();
    expect(loaded).toEqual({ geminiApiKey: encrypted("g-key") });
    expect(api.isEncrypted(loaded.geminiApiKey)).toBe(true);
  });

  it("읽기만 하고 파일을 고치거나 지우지 않는다", () => {
    const content = JSON.stringify({ geminiApiKey: encrypted("g-key") });
    files.set(credentialPath, content);
    api.loadCredentialsFromLocal();
    expect([...files.entries()]).toEqual([[credentialPath, content]]);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("구 플러그인 파일 복사 실패 후에도 다음 실행에서 다시 이전할 수 있다", async () => {
    const { migrateCredentialsFile } = api;
    const legacy = join(directory, "ai-assistant-credentials.json");
    files.set(legacy, '{"geminiApiKey":"enc:old"}');
    fs.renameSync.mockImplementationOnce(() => { throw new Error("EACCES"); });
    expect(migrateCredentialsFile(["ai-assistant"], "agent-llms")).toBe(false);
    expect(files.has(credentialPath)).toBe(false);
    expect(migrateCredentialsFile(["ai-assistant"], "agent-llms")).toBe(true);
    expect(files.get(credentialPath)).toBe(files.get(legacy));
  });
});

describe("예전 모바일 단일 항목 읽기", () => {
  function secrets(initial: string | null) {
    return { getSecret: vi.fn(() => initial) } as any;
  }

  it("한 항목에 JSON으로 저장한 키를 돌려준다", () => {
    const secretStorage = secrets('{"geminiApiKey":"mobile-gemini","bedrockApiKey":"mobile-bedrock"}');
    expect(api.loadCredentialsFromLocal(secretStorage)).toEqual({
      geminiApiKey: "mobile-gemini",
      bedrockApiKey: "mobile-bedrock",
    });
    expect(secretStorage.getSecret).toHaveBeenCalledExactlyOnceWith("agent-llms-credentials");
  });

  it("항목이 없으면 빈 객체다", () => {
    expect(api.loadCredentialsFromLocal(secrets(null))).toEqual({});
  });

  it("해독 불가능한 PC 암호문과 잘못된 타입은 키로 돌려주지 않는다", () => {
    const secretStorage = secrets('{"bedrockApiKey":"enc:desktop-key","openaiApiKey":42,"language":"ja"}');
    expect(api.loadCredentialsFromLocal(secretStorage)).toEqual({});
  });

  it("모바일에서는 PC 파일을 읽지 않는다", () => {
    files.set(credentialPath, JSON.stringify({ geminiApiKey: encrypted("g-key") }));
    expect(api.loadCredentialsFromLocal(secrets(null))).toEqual({});
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
