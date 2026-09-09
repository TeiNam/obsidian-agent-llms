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

function storage(initial: Record<string, unknown>) {
  let data = { ...initial };
  return {
    loadData: async () => data,
    saveData: vi.fn(async (next: unknown) => { data = next as Record<string, unknown>; }),
    current: () => data,
  };
}

describe("자격증명 영속화", () => {
  it("쓰기 실패 후에도 마이그레이션 원본을 보존하고 재시도 성공 후 제거한다", async () => {
    const { persistSettingsWithCredentials, loadCredentialsFromLocal } = api;
    const store = storage({ geminiApiKey: "legacy-key", language: "en" });
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error("EACCES"); });
    const settings = { geminiApiKey: "legacy-key", language: "ko" };

    expect(await persistSettingsWithCredentials(settings, store)).toBe(false);
    expect(store.current()).toEqual(settings);
    expect(await persistSettingsWithCredentials(settings, store)).toBe(true);
    expect(store.current()).toEqual({ geminiApiKey: "", language: "ko" });
    expect(loadCredentialsFromLocal()).toEqual({ geminiApiKey: "legacy-key" });
  });

  it("키체인을 사용할 수 없어도 기존 파일을 보존하며 새 평문 키를 볼트에 쓰지 않는다", async () => {
    const { persistSettingsWithCredentials } = api;
    files.set(credentialPath, '{"geminiApiKey":"enc:old"}');
    encryptionAvailable = false;
    const store = storage({ geminiApiKey: "", language: "en" });
    expect(await persistSettingsWithCredentials({ geminiApiKey: "new-key", language: "ko" }, store)).toBe(false);
    expect(store.current()).toEqual({ geminiApiKey: "", language: "ko" });
    expect(files.get(credentialPath)).toBe('{"geminiApiKey":"enc:old"}');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("교체 실패 시 기존 암호문을 유지하고 임시 파일을 제거한다", async () => {
    const { saveCredentialsToLocal } = api;
    files.set(credentialPath, '{"geminiApiKey":"enc:old"}');
    fs.renameSync.mockImplementationOnce(() => { throw new Error("EACCES"); });
    expect(saveCredentialsToLocal({ geminiApiKey: "new-key" })).toBe(false);
    expect([...files.entries()]).toEqual([[credentialPath, '{"geminiApiKey":"enc:old"}']]);
  });

  it("기존 마이그레이션 키가 있어도 실패한 새 키로 덮어쓰지 않는다", async () => {
    const { persistSettingsWithCredentials } = api;
    encryptionAvailable = false;
    const store = storage({ geminiApiKey: "enc:original" });
    await persistSettingsWithCredentials({ geminiApiKey: "replacement" }, store);
    expect(store.current().geminiApiKey).toBe("enc:original");
  });

  it("사용자가 키를 비우면 기존 자격증명을 삭제하고 새 파일 권한은 0600이다", async () => {
    const { saveCredentialsToLocal } = api;
    files.set(credentialPath, '{"geminiApiKey":"enc:old"}');
    expect(saveCredentialsToLocal({ geminiApiKey: "" })).toBe(true);
    expect(files.get(credentialPath)).toBe("{}");
    expect(fs.writeFileSync.mock.calls[0][2]).toEqual({ encoding: "utf-8", mode: 0o600 });
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
