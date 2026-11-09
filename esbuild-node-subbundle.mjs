import esbuild from "esbuild";
import { builtinModules } from "node:module";

/** PC에서만 지연 로드하는 AWS 자격증명 SDK. Node용으로 따로 묶는다. */
export const AWS_NODE_PACKAGES = ["@aws-sdk/credential-provider-ini"];

/** Node 내장 모듈. 접두어 없는 이름과 `node:` 접두어 이름 모두 외부로 둔다. */
export const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/**
 * 지정한 패키지를 platform: "node"로 따로 번들해 메인 번들에 끼워 넣는다.
 *
 * 메인 번들은 모바일 때문에 브라우저용이다. AWS 자격증명 SDK는 package.json의 `browser`
 * 필드로 `~/.aws` 파일 읽기 모듈을 빈 모듈로 바꿔치기하므로, 브라우저용으로 묶으면
 * PC에서도 프로필을 읽지 못한다. 이 패키지는 PC에서만 지연 로드되므로 Node용으로 묶는다.
 */
export function nodeSubbundle(packages) {
  const filter = new RegExp(`^(${packages.map((p) => p.replace(/[/.]/g, "\\$&")).join("|")})$`);
  return {
    name: "node-subbundle",
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "node-subbundle" }));
      build.onLoad({ filter: /.*/, namespace: "node-subbundle" }, async (args) => {
        const result = await esbuild.build({
          stdin: { contents: `module.exports = require(${JSON.stringify(args.path)});`, resolveDir: process.cwd() },
          bundle: true,
          platform: "node",
          format: "cjs",
          target: "chrome106",
          external: ["electron", ...NODE_BUILTINS],
          write: false,
          minify: build.initialOptions.minify,
          logLevel: "silent",
        });
        return { contents: result.outputFiles[0].text, loader: "js" };
      });
    },
  };
}
