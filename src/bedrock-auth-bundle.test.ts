import { describe, it, expect, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
// @ts-expect-error 빌드 스크립트(.mjs)는 타입 선언이 없다
import { AWS_NODE_PACKAGES, NODE_BUILTINS, nodeSubbundle } from "../esbuild-node-subbundle.mjs";

// 배포 번들은 모바일 때문에 브라우저용이다. 브라우저용으로 묶인 AWS SDK는 `~/.aws` 파일
// 읽기가 빈 모듈로 바뀌어 PC에서도 프로필을 못 읽었다. 실제 번들 설정으로 회귀를 막는다.
const dir = mkdtempSync(join(tmpdir(), "bedrock-auth-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("배포 번들의 AWS 프로필 로드", () => {
  it("브라우저용 번들 안에서도 ~/.aws/config 프로필을 읽는다", async () => {
    const configFile = join(dir, "config");
    writeFileSync(configFile, "[profile bundle-test]\naws_access_key_id = AKIDBUNDLE\naws_secret_access_key = secret\n");
    const result = await build({
      stdin: { contents: 'module.exports = require("./src/bedrock-auth");', resolveDir: process.cwd(), loader: "ts" },
      bundle: true, format: "cjs", target: "chrome106", write: false, logLevel: "silent",
      external: ["obsidian", "electron", ...NODE_BUILTINS],
      plugins: [nodeSubbundle(AWS_NODE_PACKAGES)],
    });
    const outFile = join(dir, "bundle.cjs");
    writeFileSync(outFile, result.outputFiles[0].text);

    const previous = { config: process.env.AWS_CONFIG_FILE, creds: process.env.AWS_SHARED_CREDENTIALS_FILE };
    process.env.AWS_CONFIG_FILE = configFile;
    process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, "missing-credentials");
    try {
      const { loadIniProfile } = createRequire(import.meta.url)(outFile);
      const creds = await loadIniProfile("bundle-test");
      expect(creds.accessKeyId).toBe("AKIDBUNDLE");
    } finally {
      process.env.AWS_CONFIG_FILE = previous.config;
      process.env.AWS_SHARED_CREDENTIALS_FILE = previous.creds;
      if (previous.config === undefined) delete process.env.AWS_CONFIG_FILE;
      if (previous.creds === undefined) delete process.env.AWS_SHARED_CREDENTIALS_FILE;
    }
  });
});
