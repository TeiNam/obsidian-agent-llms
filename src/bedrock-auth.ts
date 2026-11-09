import type { GeminiAssistantSettings } from "./types";

/** AWS SDK가 서명에 쓰는 임시 자격증명. @aws-sdk/types의 AwsCredentialIdentity와 같은 모양. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

/** 프로필 이름 하나로 자격증명을 받아오는 함수. 테스트에서 주입해 SDK·파일 시스템 없이 검증한다. */
export type ProfileLoader = (profile: string) => Promise<AwsCredentials>;

/** 프로필 하나의 실패 내역. 오류 메시지에 그대로 노출된다. */
export interface ProfileFailure {
  profile: string;
  message: string;
}

/**
 * 지정한 AWS 프로필이 모두 자격증명을 주지 못했을 때 던지는 오류.
 * BedrockClient가 이 타입일 때만 베어러 토큰으로 넘어간다 — 권한 거부·스로틀링 같은
 * 요청 오류에서 다른 계정으로 재시도하면 안 되기 때문이다.
 */
export class ProfileAuthError extends Error {
  readonly failures: readonly ProfileFailure[];

  constructor(failures: readonly ProfileFailure[], message: string) {
    super(message);
    this.name = "ProfileAuthError";
    this.failures = failures;
  }
}

/** 손상된 data.json에서 문자열이 아닌 값이 와도 빈 값으로 본다. */
function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 시도할 AWS 프로필을 우선순위대로 돌려준다: Roles Anywhere → SSO.
 * 모바일에는 `~/.aws`와 credential_process 실행 환경이 없으므로 항상 빈 배열이다.
 */
export function profileCandidates(
  settings: Pick<GeminiAssistantSettings, "bedrockRolesAnywhereProfile" | "bedrockSsoProfile">,
  isDesktop: boolean
): string[] {
  if (!isDesktop) return [];
  const names = [
    cleanName(settings.bedrockRolesAnywhereProfile),
    cleanName(settings.bedrockSsoProfile),
  ].filter((name) => name !== "");
  return [...new Set(names)];
}

/**
 * 프로필을 순서대로 시도하는 자격증명 공급자를 만든다. 첫 성공을 반환하고,
 * 모두 실패하면 ProfileAuthError를 던진다. 지정하지 않은 프로필(`[default]`·환경변수)로는
 * 절대 넘어가지 않는다 — 사용자가 고르지 않은 계정으로 과금되는 것을 막는다.
 */
export function createProfileChainProvider(
  profiles: readonly string[],
  load: ProfileLoader,
  describe: (details: string) => string
): () => Promise<AwsCredentials> {
  return async () => {
    const failures: ProfileFailure[] = [];
    for (const profile of profiles) {
      try {
        return await load(profile);
      } catch (error) {
        failures.push({ profile, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const details = failures.map((f) => `[${f.profile}] ${f.message}`).join("; ");
    throw new ProfileAuthError(failures, describe(details));
  };
}

/**
 * `~/.aws/config`의 프로필 하나로 자격증명을 받아온다(credential_process·SSO 캐시 모두 지원).
 * 모듈을 지연 로드한다 — 이 SDK 모듈은 fs·child_process를 쓰므로 모바일 번들 로드 시점에
 * 평가되면 플러그인 전체가 뜨지 않는다.
 */
export const loadIniProfile: ProfileLoader = async (profile) => {
  const { fromIni } = await import("@aws-sdk/credential-provider-ini");
  return fromIni({ profile })();
};

/**
 * 기본 클라이언트로 실행하고, 프로필 인증 자체가 실패했을 때만 대체 클라이언트로 다시 실행한다.
 * 자격증명 해석은 요청 전송 전에 일어나므로 재실행해도 요청이 두 번 나가지 않는다.
 */
export async function runWithAuthFallback<C, T>(
  primary: C,
  fallback: C | null,
  run: (client: C) => Promise<T>,
  onFallback: (error: ProfileAuthError) => void
): Promise<T> {
  try {
    return await run(primary);
  } catch (error) {
    if (!fallback || !(error instanceof ProfileAuthError)) throw error;
    onFallback(error);
    return run(fallback);
  }
}
