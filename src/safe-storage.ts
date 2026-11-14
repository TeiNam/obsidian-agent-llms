/**
 * 예전 자격증명 저장소 읽기
 *
 * API 키는 이제 Obsidian 비밀 저장소(SecretStorage)에 있다 (secrets.ts).
 * 이 모듈은 예전 버전이 남긴 키를 읽어 옮기는 데만 쓴다. 새로 쓰지 않는다.
 *
 * - PC: OS 키체인(Electron safeStorage)으로 암호화해 Electron userData 경로의
 *   로컬 전용 파일에 저장했다. 볼트 밖이라 동기화되지 않는다.
 * - 모바일: Obsidian SecretStorage의 항목 하나에 JSON으로 저장했다.
 * - 아주 예전: data.json에 암호문("enc:...") 또는 평문으로 저장했다.
 */


declare const require: (id: string) => unknown;
declare class Buffer {
  static from(data: string, encoding: string): Buffer;
  toString(encoding: string): string;
}

import { planCredentialMigration } from "./migration";
import type { App } from "obsidian";

// 암호화된 값 식별 접두사
const ENCRYPTED_PREFIX = "enc:";

// 예전 로컬 전용 자격증명 파일명.
// `{pluginId}-credentials.json` 규칙을 지켜야 한다 — planCredentialMigration이
// 같은 규칙으로 마이그레이션 대상 파일명을 만든다.
const CREDENTIALS_FILE = "agent-llms-credentials.json";
const MOBILE_CREDENTIALS_ID = "agent-llms-credentials";

/** 이 모듈이 실제로 쓰는 `fs` API만 좁혀 선언한다. */
interface NodeFsSubset {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  writeFileSync(
    path: string,
    data: string,
    options: { encoding: string; mode: number }
  ): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
}

/** 이 모듈이 실제로 쓰는 `path` API만 좁혀 선언한다. */
interface NodePathSubset {
  join(...parts: string[]): string;
}

interface SafeStorageApi {
  encryptString(value: string): Buffer;
  decryptString(buffer: Buffer): string;
  isEncryptionAvailable(): boolean;
}

interface ElectronApp {
  getPath(name: string): string;
}

/**
 * Electron 모듈 표면. `remote`는 구 버전 옵시디언에서만 존재하므로 모두 옵셔널이다.
 */
interface ElectronModule {
  safeStorage?: SafeStorageApi;
  app?: ElectronApp;
  remote?: { safeStorage?: SafeStorageApi; app?: ElectronApp };
}

/**
 * Node/Electron 모듈을 가져온다. 없는 환경(테스트, 모바일)에서는 null.
 *
 * 선언한 타입은 이 파일이 호출하는 멤버로 한정한다 — 런타임 검증이 아니라
 * 호출부의 오타를 잡기 위한 좁은 계약이다.
 */
function requireModule<T>(id: string): T | null {
  try {
    return require(id) as T;
  } catch {
    return null;
  }
}

// Node.js 모듈 (Obsidian/Electron 런타임에서 사용 가능)
const nodeFs = requireModule<NodeFsSubset>("fs");
const nodePath = requireModule<NodePathSubset>("path");

/** 암호화할 설정 필드 목록 (Gemini + Bedrock + OpenAI 자격증명) */
export const SENSITIVE_FIELDS = [
  "geminiApiKey",
  // OpenAI API 키 — 기존 자격증명과 동일한 민감 필드 처리(저장/제거/로컬 이전/레거시 마이그레이션)를 적용 (Req 3.1)
  // 참고: Ollama 서버 base URL(ollamaBaseUrl)은 비민감이므로 의도적으로 제외하여 data.json에 일반 저장 (Req 3.5)
  "openaiApiKey",
  // Bedrock API 키 — 장기 베어러 토큰이므로 data.json에 남기지 않는다.
  "bedrockApiKey",
] as const;

/**
 * 더 이상 지원하지 않지만 구 `data.json`에 평문으로 남아 있을 수 있는 **자격증명** 필드.
 *
 * 0.3.0에서 액세스 키 인증을 제거하면서 이 필드들을 SENSITIVE_FIELDS에서 뺐는데,
 * 그러면 strip 대상에서도 빠져 구 설정의 평문 키가 클라우드 동기화되는 data.json에
 * 그대로 재저장된다. 제거가 오히려 유출을 만드는 셈이므로, 읽지는 않되 지우기는 한다.
 *
 * **비밀값만 넣는다.** 이 목록은 `main.ts`의 `hasMigratedKeys` 판정에도 쓰인다.
 * `awsAuthMethod` 같은 비-비밀 필드를 넣으면 모든 구 사용자가 마이그레이션 분기로
 * 흘러가고, 그 분기는 `filterStaleCredentials`를 타지 않아 잔존 API 키가 적용된다.
 * 폐기된 비-비밀 필드는 LEGACY_OBSOLETE_FIELDS로 분리한다.
 */
export const LEGACY_SENSITIVE_FIELDS = ["awsAccessKeyId", "awsSecretAccessKey"] as const;

/**
 * 폐기된 비-비밀 설정 필드. 저장 시 제거하지만 마이그레이션 판정에는 쓰지 않는다.
 *
 * `awsAuthMethod`가 data.json에 남아 있으면 `filterStaleCredentials`가 매 실행마다
 * 같은 판정을 반복한다. 그 함수도 자체적으로 raw에서 지우지만, loadSettings의
 * 마이그레이션 분기는 그 함수를 타지 않으므로 저장 경로에서도 한 번 더 지운다.
 */
export const LEGACY_OBSOLETE_FIELDS = ["awsAuthMethod", "awsProfile"] as const;

/**
 * Electron safeStorage 모듈 가져오기 (런타임에서만 사용 가능)
 * 옵시디언 환경이 아니거나 safeStorage를 지원하지 않으면 null 반환
 */
function getSafeStorage(): SafeStorageApi | null {
  const electron = requireModule<ElectronModule>("electron");
  const ss = electron?.remote?.safeStorage ?? electron?.safeStorage;
  if (!ss || typeof ss.isEncryptionAvailable !== "function") return null;
  try {
    return ss.isEncryptionAvailable() ? ss : null;
  } catch {
    // 키체인 접근 실패(잠긴 세션 등)는 평문 폴백으로 처리한다.
    return null;
  }
}

/**
 * Electron app.getPath('userData') 경로 가져오기
 * iCloud 동기화 대상이 아닌 로컬 전용 경로
 * 예: macOS → ~/Library/Application Support/obsidian
 */
function getLocalStoragePath(): string | null {
  const electron = requireModule<ElectronModule>("electron");
  const app = electron?.remote?.app ?? electron?.app;
  if (!app || typeof app.getPath !== "function") return null;
  try {
    return app.getPath("userData");
  } catch {
    return null;
  }
}

/**
 * 로컬 전용 자격증명 파일의 전체 경로 반환
 */
function getCredentialsFilePath(): string | null {
  const dir = getLocalStoragePath();
  if (!dir || !nodePath) return null;
  return nodePath.join(dir, CREDENTIALS_FILE);
}

/**
 * 값이 이미 암호화되어 있는지 판별
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * "enc:..." 형태의 암호화된 문자열을 복호화하여 원본 반환
 * 암호화되지 않은 값이면 그대로 반환 (하위 호환)
 * safeStorage를 사용할 수 없으면 원본 그대로 반환
 */
export function decryptValue(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  const ss = getSafeStorage();
  if (!ss) return stored;
  try {
    const base64 = stored.slice(ENCRYPTED_PREFIX.length);
    const buffer = Buffer.from(base64, "base64");
    return ss.decryptString(buffer);
  } catch {
    // 복호화 실패 시 원본 반환 (키체인 변경 등)
    return stored;
  }
}

/**
 * 설정 객체에서 민감한 필드를 제거하여 새 객체로 반환 (data.json 저장용)
 * iCloud로 동기화되는 data.json에는 키 정보가 포함되지 않도록 합니다.
 * 원본 객체를 변경하지 않습니다.
 */
export function stripSensitiveFields<T extends object>(settings: T): T {
  const result = { ...settings } as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    if (field in result) {
      result[field] = "";
    }
  }
  // 폐기된 필드는 값을 비우는 대신 키 자체를 지운다. 지금은 읽지 않는 필드이므로
  // 빈 문자열로 남겨둘 이유가 없고, 남기면 구 설정의 잔재가 계속 따라온다.
  for (const field of [...LEGACY_SENSITIVE_FIELDS, ...LEGACY_OBSOLETE_FIELDS]) {
    if (field in result) {
      delete result[field];
    }
  }
  return result as T;
}

/** 같은 디렉터리의 완성된 임시 파일로 교체하여 실패 시 기존 파일을 보존한다. */
function writeCredentialsFile(fs: NodeFsSubset, filePath: string, data: string): void {
  const temporaryPath = `${filePath}.${window.crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, data, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch { /* 교체 완료 또는 파일 생성 실패 */ }
  }
}

/**
 * 예전 저장소에 남은 자격증명을 읽는다. 없거나 읽지 못하면 빈 객체.
 *
 * @param secretStorage 모바일이면 SecretStorage(예전 단일 항목을 읽는다), PC면 생략(로컬 파일을 읽는다)
 */
export function loadCredentialsFromLocal(secretStorage?: App["secretStorage"]): Record<string, string> {
  if (secretStorage !== undefined) {
    try {
      const stored = secretStorage.getSecret(MOBILE_CREDENTIALS_ID);
      if (!stored) return {};
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const result: Record<string, string> = {};
      for (const field of SENSITIVE_FIELDS) {
        const value = (parsed as Record<string, unknown>)[field];
        if (typeof value === "string" && !isEncrypted(value)) result[field] = value;
      }
      return result;
    } catch (error) {
      console.error("자격증명 모바일 로드 실패:", error);
      return {};
    }
  }
  const filePath = getCredentialsFilePath();
  if (!filePath || !nodeFs) return {};

  try {
    if (!nodeFs.existsSync(filePath)) return {};
    const data = nodeFs.readFileSync(filePath, "utf-8");
    const credentials = JSON.parse(data) as Record<string, string>;

    // 복호화
    const result: Record<string, string> = {};
    for (const field of SENSITIVE_FIELDS) {
      if (credentials[field]) {
        result[field] = decryptValue(credentials[field]);
      }
    }
    return result;
  } catch (e) {
    console.error("자격증명 로컬 로드 실패:", e);
    return {};
  }
}

/**
 * 설정 객체의 민감한 필드들을 복호화하여 새 객체로 반환
 * 원본 객체를 변경하지 않습니다.
 * 아주 예전 버전이 data.json에 남긴 값을 읽을 때만 쓴다.
 */
export function decryptSettings<T extends object>(settings: T): T {
  const result = { ...settings } as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    const value = result[field];
    if (typeof value === "string") {
      result[field] = decryptValue(value);
    }
  }
  return result as T;
}

/**
 * 구 플러그인 ID의 자격증명 파일을 새 ID 파일명으로 복사한다.
 *
 * 복사이지 이동이 아니다. 대상이 이미 있으면 아무것도 하지 않는다.
 * 암복호화는 하지 않는다 — 암호화된 Base64 문자열을 그대로 옮기며,
 * OS 키체인 키가 동일 기기에서 유지되므로 복호화는 계속 가능하다.
 *
 * @returns 복사를 수행했으면 true
 */
export function migrateCredentialsFile(
  legacyIds: readonly string[],
  newId: string
): boolean {
  const dir = getLocalStoragePath();
  if (!dir || !nodeFs || !nodePath) return false;

  const exists = (fileName: string): boolean => {
    try {
      return nodeFs.existsSync(nodePath.join(dir, fileName));
    } catch {
      return false;
    }
  };

  const task = planCredentialMigration(legacyIds, newId, exists);
  if (!task) return false;

  try {
    const data = nodeFs.readFileSync(nodePath.join(dir, task.from), "utf-8");
    writeCredentialsFile(nodeFs, nodePath.join(dir, task.to), data);
    return true;
  } catch (e) {
    console.error("자격증명 파일 복사 실패:", e);
    return false;
  }
}
