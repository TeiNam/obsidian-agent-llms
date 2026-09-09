import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

import { McpManager } from "./mcp-client";

class FakeProcess extends EventEmitter {
  pid = 123;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin: {
    writable: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    on: EventEmitter["on"];
  };
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });

  constructor(respond: boolean) {
    super();
    const stdinEvents = new EventEmitter();
    this.stdin = {
      writable: true,
      end: vi.fn(),
      on: stdinEvents.on.bind(stdinEvents),
      write: vi.fn((raw: string) => {
        if (!respond) return true;
        const request = JSON.parse(String(raw)) as { id?: number; method?: string };
        if (request.id === undefined) return true;
        const result = request.method === "tools/list" ? { tools: [] } : {};
        queueMicrotask(() => {
          this.stdout.emit(
            "data",
            Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`)
          );
        });
        return true;
      }),
    };
  }
}

const CONFIG = JSON.stringify({
  mcpServers: {
    local: { command: "fake-command" },
  },
});

describe("MCP 연결 수명주기", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    childProcessMocks.spawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("사용자 타임아웃을 initialize 요청부터 적용한다", async () => {
    childProcessMocks.spawn.mockReturnValue(new FakeProcess(false));
    const manager = new McpManager();
    manager.setTimeout(1);

    const loading = manager.loadConfig(CONFIG);
    let settled = false;
    void loading.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(loading).resolves.toEqual({ connected: [], failed: ["local"] });
  });

  it("중지 전에 예약된 재연결을 취소한다", async () => {
    const process = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    manager.setTimeout(1);
    await manager.loadConfig(CONFIG);

    process.emit("exit", 1);
    manager.disconnectAll();
    await vi.advanceTimersByTimeAsync(5000);

    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("응답을 받은 요청의 타임아웃 타이머를 즉시 정리한다", async () => {
    childProcessMocks.spawn.mockReturnValue(new FakeProcess(true));
    const manager = new McpManager();
    manager.setTimeout(60);

    await manager.loadConfig(CONFIG);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("SIGTERM을 보냈어도 종료되지 않았으면 3초 후 강제 종료한다", async () => {
    const process = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    await manager.loadConfig(CONFIG);
    manager.disconnectAll();
    expect(process.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(process.kill.mock.calls).toEqual([[], ["SIGKILL"]]);
  });

  it("정상 종료하면 강제 종료 예약도 제거한다", async () => {
    const process = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    await manager.loadConfig(CONFIG);
    manager.disconnectAll();
    process.exitCode = 0;
    process.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("초기화 중 중지하면 현재 연결과 아직 시작하지 않은 서버를 취소한다", async () => {
    const process = new FakeProcess(false);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    const loading = manager.loadConfig(JSON.stringify({
      mcpServers: { first: { command: "first" }, second: { command: "second" } },
    }));
    manager.disconnectAll();
    await expect(loading).resolves.toEqual({ connected: [], failed: [] });
    process.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toEqual([]);
    expect(process.kill).toHaveBeenCalled();
  });

  it("초기화 응답 직후 중지해도 연결 완료가 서버를 되살리지 않는다", async () => {
    const process = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    const loading = manager.loadConfig(CONFIG);
    await Promise.resolve();
    manager.disconnectAll();
    await loading;
    expect(manager.getStatus()).toEqual([]);
    expect(process.kill).toHaveBeenCalled();
  });

  it("새 설정이 이전 초기화를 취소하고 새 서버만 유지한다", async () => {
    const oldProcess = new FakeProcess(false);
    const newProcess = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValueOnce(oldProcess).mockReturnValueOnce(newProcess);
    const manager = new McpManager();
    const oldLoad = manager.loadConfig(CONFIG);
    const nextLoad = manager.loadConfig(JSON.stringify({ mcpServers: { next: { command: "next" } } }));
    await Promise.all([oldLoad, nextLoad]);
    expect(manager.getStatus()).toEqual([{ name: "next", connected: true, toolCount: 0 }]);
    expect(oldProcess.kill).toHaveBeenCalled();
    expect(newProcess.kill).not.toHaveBeenCalled();
  });

  it("프로세스 시작 오류는 요청 타임아웃까지 기다리지 않는다", async () => {
    const process = new FakeProcess(false);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    const loading = manager.loadConfig(CONFIG);
    process.emit("error", new Error("ENOENT"));
    await expect(loading).resolves.toEqual({ connected: [], failed: ["local"] });
    expect(manager.getStatus()).toEqual([]);
  });
});
