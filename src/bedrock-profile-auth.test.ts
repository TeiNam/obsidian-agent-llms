import { describe, it, expect, vi } from "vitest";
import {
  ProfileAuthError,
  createProfileChainProvider,
  profileCandidates,
  runWithAuthFallback,
  type AwsCredentials,
} from "./bedrock-auth";

const CREDS: AwsCredentials = { accessKeyId: "AKIA", secretAccessKey: "secret" };
const describeError = (details: string) => `failed: ${details}`;

describe("profileCandidates: 인증 우선순위", () => {
  it("PC에서는 Roles Anywhere → SSO 순서로 돌려준다", () => {
    expect(
      profileCandidates({ bedrockRolesAnywhereProfile: " ra ", bedrockSsoProfile: "sso" }, true)
    ).toEqual(["ra", "sso"]);
  });

  it("빈 칸은 건너뛰고 같은 프로필은 한 번만 시도한다", () => {
    expect(profileCandidates({ bedrockRolesAnywhereProfile: "", bedrockSsoProfile: "sso" }, true)).toEqual(["sso"]);
    expect(profileCandidates({ bedrockRolesAnywhereProfile: "p", bedrockSsoProfile: "p" }, true)).toEqual(["p"]);
  });

  it("모바일에서는 프로필을 무시한다(베어러 토큰만)", () => {
    expect(profileCandidates({ bedrockRolesAnywhereProfile: "ra", bedrockSsoProfile: "sso" }, false)).toEqual([]);
  });

  it("손상된 설정(문자열 아님·누락)에서도 예외 없이 빈 값으로 본다", () => {
    const bad = { bedrockRolesAnywhereProfile: 42, bedrockSsoProfile: undefined } as unknown as {
      bedrockRolesAnywhereProfile: string;
      bedrockSsoProfile: string;
    };
    expect(profileCandidates(bad, true)).toEqual([]);
  });
});

describe("createProfileChainProvider", () => {
  it("첫 프로필이 성공하면 다음 프로필은 시도하지 않는다", async () => {
    const load = vi.fn(async () => CREDS);
    await expect(createProfileChainProvider(["ra", "sso"], load, describeError)()).resolves.toBe(CREDS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("ra");
  });

  it("앞 프로필이 실패하면 다음 프로필로 넘어간다", async () => {
    const load = vi.fn(async (profile: string) => {
      if (profile === "ra") throw new Error("helper missing");
      return CREDS;
    });
    await expect(createProfileChainProvider(["ra", "sso"], load, describeError)()).resolves.toBe(CREDS);
    expect(load.mock.calls.map((c) => c[0])).toEqual(["ra", "sso"]);
  });

  it("모두 실패하면 각 프로필의 원인을 담은 ProfileAuthError를 던진다", async () => {
    const load = vi.fn(async (profile: string) => {
      throw new Error(`${profile} expired`);
    });
    const error = await createProfileChainProvider(["ra", "sso"], load, describeError)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProfileAuthError);
    expect((error as ProfileAuthError).message).toBe("failed: [ra] ra expired; [sso] sso expired");
    expect((error as ProfileAuthError).failures.map((f) => f.profile)).toEqual(["ra", "sso"]);
  });
});

describe("runWithAuthFallback", () => {
  const authError = new ProfileAuthError([], "auth");

  it("프로필 인증 실패면 대체 클라이언트로 다시 실행하고 알린다", async () => {
    const onFallback = vi.fn();
    const run = vi.fn(async (client: string) => {
      if (client === "profile") throw authError;
      return `ok:${client}`;
    });
    await expect(runWithAuthFallback("profile", "bearer", run, onFallback)).resolves.toBe("ok:bearer");
    expect(onFallback).toHaveBeenCalledWith(authError);
  });

  it("요청 오류(권한 거부 등)는 다른 계정으로 재시도하지 않는다", async () => {
    const denied = new Error("AccessDeniedException");
    const run = vi.fn(async () => {
      throw denied;
    });
    await expect(runWithAuthFallback("profile", "bearer", run, vi.fn())).rejects.toBe(denied);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("대체 클라이언트가 없으면 인증 오류를 그대로 던진다", async () => {
    const run = vi.fn(async () => {
      throw authError;
    });
    await expect(runWithAuthFallback("profile", null, run, vi.fn())).rejects.toBe(authError);
  });
});
