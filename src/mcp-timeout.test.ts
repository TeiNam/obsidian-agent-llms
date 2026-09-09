import { describe, it, expect, vi } from "vitest";
import {
  encodeMcpStdioMessage,
  formatMcpToolResult,
  joinSearchPath,
  McpManager,
  parseMcpConfig,
  buildMcpEnvironment,
} from "./mcp-client";
import { DEFAULT_SETTINGS } from "./types";

describe("MCP 타임아웃 설정", () => {
  it("stdio 메시지는 Content-Length 없이 JSON 한 줄로 직렬화한다", () => {
    const payload = encodeMcpStdioMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(payload).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    expect(payload).not.toContain("Content-Length");
  });

  it("DEFAULT_SETTINGS에 mcpTimeout 기본값이 10이다", () => {
    expect(DEFAULT_SETTINGS.mcpTimeout).toBe(10);
  });

  it("mcpTimeout이 BedrockAssistantSettings 인터페이스에 존재한다", () => {
    // DEFAULT_SETTINGS가 타입 체크를 통과하면 인터페이스에 필드가 존재함
    expect("mcpTimeout" in DEFAULT_SETTINGS).toBe(true);
    expect(typeof DEFAULT_SETTINGS.mcpTimeout).toBe("number");
  });

  it("McpManager.setTimeout()이 정상 호출된다", () => {
    const manager = new McpManager();
    // 에러 없이 호출되어야 함
    expect(() => manager.setTimeout(60)).not.toThrow();
  });

  it("McpManager.setTimeout()에 다양한 값을 설정할 수 있다", () => {
    const manager = new McpManager();
    // 최소값 (10초)
    expect(() => manager.setTimeout(10)).not.toThrow();
    // 최대값 (120초)
    expect(() => manager.setTimeout(120)).not.toThrow();
    // 중간값
    expect(() => manager.setTimeout(45)).not.toThrow();
  });

  it("서버가 없는 상태에서 setTimeout 호출 시 에러가 발생하지 않는다", () => {
    const manager = new McpManager();
    // 연결된 서버가 없어도 안전하게 동작해야 함
    expect(() => manager.setTimeout(90)).not.toThrow();
    expect(manager.getStatus()).toEqual([]);
  });

  it("MCP 설정 구조와 필드 타입을 검증한다", () => {
    expect(parseMcpConfig('{"mcpServers":{"local":{"command":"npx","args":["-y"]}}}'))
      .toEqual({ mcpServers: { local: { command: "npx", args: ["-y"] } } });
    expect(() => parseMcpConfig("{}")).toThrow("mcpServers");
    expect(() => parseMcpConfig('{"mcpServers":{"bad":{"command":1}}}')).toThrow("command");
    expect(() => parseMcpConfig('{"mcpServers":{"bad":{"command":"x","args":[1]}}}')).toThrow("args");
  });

  it("텍스트 외 MCP 콘텐츠도 버리지 않는다", () => {
    const formatted = formatMcpToolResult({
      content: [
        { type: "text", text: "설명" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
        { type: "resource", resource: { uri: "file:///a.txt", text: "자료" } },
      ],
      structuredContent: { count: 2 },
    });

    expect(formatted).toContain("설명");
    expect(formatted).toContain('"type":"image"');
    expect(formatted).toContain('"type":"resource"');
    expect(formatted).toContain('"count":2');
  });

  it("Windows PATH는 세미콜론과 드라이브 문자를 보존한다", () => {
    expect(joinSearchPath(["C:\\Windows", "C:\\Program Files\\nodejs"], ";"))
      .toBe("C:\\Windows;C:\\Program Files\\nodejs");
  });

  it("부모 비밀값과 런타임 주입 옵션은 상속하지 않고 명시한 환경만 전달한다", () => {
    const env = buildMcpEnvironment(
      { MCP_API_KEY: "configured", PATH: "/custom/bin" },
      { HOME: "/home/test", PATH: "/usr/bin", LANG: "ko_KR.UTF-8", GITHUB_TOKEN: "secret", NODE_OPTIONS: "--inspect" },
      "linux",
    );
    expect(env).toEqual({
      HOME: "/home/test", PATH: "/custom/bin", LANG: "ko_KR.UTF-8", MCP_API_KEY: "configured",
    });
  });

  it("Windows 환경변수 이름을 정규화하여 Path와 PATH 충돌을 막는다", () => {
    const env = buildMcpEnvironment(
      { Path: "C:\\custom" },
      { Path: "C:\\Windows", SystemRoot: "C:\\Windows", SECRET: "hidden" },
      "win32",
    );
    expect(env).toEqual({ PATH: "C:\\custom", SYSTEMROOT: "C:\\Windows" });
    expect(buildMcpEnvironment({}, { UserProfile: "C:\\Users\\test", Path: "C:\\Windows" }, "win32").PATH)
      .toBe("C:\\Users\\test\\.local\\bin;C:\\Users\\test\\.cargo\\bin;C:\\Windows");
  });

  it.skipIf(process.platform === "win32")("실제 stdio 서버의 환경을 제한하고 SIGTERM 무시 시 강제 종료한다", async () => {
    // 외부 서비스 없이 실제 Node 프로세스와 JSON-RPC 왕복·종료를 검증한다.
    const server = `
      const readline = require("node:readline");
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const request = JSON.parse(line);
        if (request.id === undefined) return;
        let result = {};
        if (request.method === "tools/list") result = { tools: [{ name: "probe" }] };
        if (request.method === "tools/call") result = { content: [{ type: "text", text: JSON.stringify({
          pid: process.pid,
          inherited: process.env.AGENT_LLMS_PARENT_ONLY ?? null,
          configured: process.env.AGENT_LLMS_EXPLICIT
        }) }] };
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
      });
    `;
    const manager = new McpManager();
    let pid: number | undefined;
    vi.stubEnv("AGENT_LLMS_PARENT_ONLY", "synthetic-parent-value");
    try {
      expect(await manager.loadConfig(JSON.stringify({
        mcpServers: { local: {
          command: process.execPath,
          args: ["-e", server],
          env: { AGENT_LLMS_EXPLICIT: "configured" },
        } },
      }))).toEqual({ connected: ["local"], failed: [] });
      const result = JSON.parse(await manager.executeTool("mcp_local_probe", {}));
      pid = result.pid;
      expect(result).toEqual({ pid: expect.any(Number), inherited: null, configured: "configured" });
      manager.disconnectAll();
      expect(() => process.kill(pid!, 0)).not.toThrow();
      await vi.waitFor(() => {
        expect(() => process.kill(pid!, 0)).toThrow();
      }, { timeout: 5000, interval: 25 });
      pid = undefined;
      expect(manager.getAllTools()).toEqual([]);
    } finally {
      manager.disconnectAll();
      if (pid !== undefined) {
        try { process.kill(pid, "SIGKILL"); } catch { /* 이미 종료된 경우 */ }
      }
      vi.unstubAllEnvs();
    }
  }, 10000);
});
