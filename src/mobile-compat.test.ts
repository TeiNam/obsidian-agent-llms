import { describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import { builtinModules, createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as obsidian from "./__mocks__/obsidian";

// 실제 배포 진입점을 실행한다. 모바일에서는 Node 전역과 네이티브 require를 제공하지 않는다.
const bundle = buildSync({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "chrome106",
  external: ["obsidian", "electron", ...builtinModules], minify: true, write: false,
}).outputFiles[0].text;
const nodeRequire = createRequire(import.meta.url);

function element(): any {
  const el: any = { parentElement: null, textContent: "" };
  for (const method of ["createDiv", "createSpan", "createEl"]) el[method] = () => element();
  for (const method of ["setText", "setAttr", "setAttribute", "appendChild", "addClass", "removeClass", "empty", "remove", "addEventListener"]) el[method] = vi.fn();
  el.classList = { add: vi.fn(), remove: vi.fn() };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  return el;
}

function runtime(mobile = true, initial: Record<string, unknown> = {}, modern = true) {
  let data = { aiBackend: "gemini", confirmToolExecution: false, ...initial };
  let secret: string | null = null;
  const nativeLoads: string[] = [];
  const secretStorage = {
    getSecret: vi.fn(() => secret),
    setSecret: vi.fn((_id: string, value: string) => { secret = value; }),
  };
  const file = Object.assign(new obsidian.TFile(), { path: "note.md", basename: "note", extension: "md" });
  let note = "# 제목\n\n원문";
  const app = {
    secretStorage: modern ? secretStorage : undefined,
    vault: {
      configDir: ".obsidian",
      adapter: { exists: vi.fn(async () => false), read: vi.fn(), write: vi.fn() },
      on: vi.fn(), getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      read: async () => note, cachedRead: async () => note,
      readBinary: async () => new TextEncoder().encode(note).buffer,
      modify: vi.fn(async (_file: unknown, value: string) => { note = value; }),
      process: vi.fn(async (_file: unknown, update: (value: string) => string) => { note = update(note); return note; }),
    },
    metadataCache: { on: vi.fn(), getFileCache: () => null, resolvedLinks: {} },
    workspace: {
      on: vi.fn(), onLayoutReady: vi.fn(), getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn(() => ({ setViewState: vi.fn() })),
      getRightLeaf: vi.fn(() => ({ setViewState: vi.fn() })),
      revealLeaf: vi.fn(),
    },
  };
  class Plugin {
    app = app;
    loadData = async () => data;
    saveData = async (next: typeof data) => { data = next; };
    registerView = vi.fn();
    addCommand = vi.fn();
    addSettingTab = vi.fn();
    addRibbonIcon = () => element();
    addStatusBarItem = () => element();
    registerEvent = vi.fn();
    registerInterval = vi.fn();
  }
  class ItemView { app = app; }
  const module = { exports: {} as any };
  const require = (id: string) => {
    if (id === "obsidian") return {
      ...obsidian, Plugin, ItemView, Component: class {}, MarkdownView: class {},
      WorkspaceLeaf: class {}, MarkdownRenderer: { render: vi.fn() },
      Platform: { isMobileApp: mobile, isDesktopApp: !mobile },
      requireApiVersion: () => modern, addIcon: vi.fn(), getAllTags: () => [],
    };
    nativeLoads.push(id);
    if (mobile) throw new Error(`Unavailable on mobile: ${id}`);
    return nodeRequire(id);
  };
  runInNewContext(bundle, {
    module, exports: module.exports, require, console,
    TextEncoder, TextDecoder, AbortController, URL, URLSearchParams, Uint8Array, setTimeout, clearTimeout,
    TransformStream, ReadableStream, WritableStream, Blob, Request, Response, Headers,
    document: { createElementNS: () => element() },
    window: { crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval: vi.fn(() => 1) },
  });
  const plugin = new module.exports.default();
  return { plugin, app, nativeLoads, secretStorage, data: () => data };
}

describe("모바일 배포 번들", () => {
  it.each([
    [true, "gemini"], [true, "bedrock"], [true, "openai"], [true, "ollama"],
    [false, "gemini"], [false, "bedrock"], [false, "openai"], [false, "ollama"],
  ] as const)("모바일=%s, 백엔드=%s: 초기화 후 채팅을 오른쪽 사이드바에서 연다", async (mobile, aiBackend) => {
    const { plugin, app, nativeLoads } = runtime(mobile, { aiBackend });
    await plugin.onload();
    expect(plugin.registerView).toHaveBeenCalledTimes(1);
    expect(plugin.mcpManager === null).toBe(mobile);
    expect(nativeLoads.includes("child_process")).toBe(!mobile);
    await plugin.activateView();
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(app.workspace.getRightLeaf).toHaveBeenCalledExactlyOnceWith(false);
    const sidebarLeaf = app.workspace.getRightLeaf.mock.results[0].value;
    expect(sidebarLeaf.setViewState).toHaveBeenCalledWith({
      type: plugin.registerView.mock.calls[0][0], active: true,
    });
    expect(app.workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(sidebarLeaf);
    if (mobile) {
      app.vault.adapter.read.mockClear();
      await expect(plugin.loadMcpConfig()).resolves.toEqual({ connected: [], failed: [] });
      expect(app.vault.adapter.read).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])("모바일=%s: 이미 열린 채팅은 재생성하지 않고 다시 표시한다", async (mobile) => {
    const { plugin, app } = runtime(mobile);
    const leaf = { setViewState: vi.fn() };
    app.workspace.getLeavesOfType.mockReturnValue([leaf] as any);
    await plugin.activateView();
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(leaf.setViewState).not.toHaveBeenCalled();
    expect(app.workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(leaf);
  });

  it("모바일은 PC 암호문을 전송하지 않고 자체 키 저장·재로드 후에도 PC 원본을 보존한다", async () => {
    const { plugin, data, secretStorage } = runtime(true, { bedrockApiKey: "enc:pc-only" });
    await plugin.loadSettings();
    expect(plugin.settings.bedrockApiKey).toBe("");
    plugin.settings.bedrockApiKey = "mobile-key";
    await plugin.saveSettings();
    await plugin.loadSettings();
    expect(plugin.settings.bedrockApiKey).toBe("mobile-key");
    expect(data().bedrockApiKey).toBe("enc:pc-only");
    expect(secretStorage.getSecret).toHaveBeenCalled();
  });

  it("레거시 키 마이그레이션에서 잘못된 타입은 모바일 키로 사용하지 않는다", async () => {
    const { plugin } = runtime(true, { geminiApiKey: 42, bedrockApiKey: "enc:pc-only" });
    await plugin.loadSettings();
    expect(plugin.settings.geminiApiKey).toBe("");
    expect(plugin.settings.bedrockApiKey).toBe("");
  });

  it("구버전 모바일도 초기화되며 새 키는 세션에만 남긴다", async () => {
    const { plugin, data } = runtime(true, {}, false);
    await plugin.onload();
    plugin.settings.geminiApiKey = "session-key";
    await plugin.saveSettings();
    expect(plugin.settings.geminiApiKey).toBe("session-key");
    expect(data().geminiApiKey).toBe("");
    await plugin.loadSettings();
    expect(plugin.settings.geminiApiKey).toBe("");
  });

  it("MCP 없이 실제 채팅 도구 루프에서 노트를 읽고 수정한다", async () => {
    const { plugin, app } = runtime();
    await plugin.onload();
    const viewFactory = plugin.registerView.mock.calls[0][1];
    const view = viewFactory({});
    const tool = (name: string, input: Record<string, unknown>) => ({
      stopReason: "tool_use", contentBlocks: [{ type: "tool_use", toolUseId: name, name, input }],
    });
    plugin.aiClient.converse = vi.fn()
      .mockResolvedValueOnce(tool("read_note", { path: "note.md" }))
      .mockResolvedValueOnce(tool("edit_note", { path: "note.md", find: "원문", replace: "수정한 본문" }))
      .mockResolvedValueOnce({ stopReason: "end_turn", contentBlocks: [] });
    Object.assign(view, {
      messages: [{ role: "user", content: "노트 수정" }], messagesEl: element(),
      setGenerating: vi.fn(), addAssistantLabel: vi.fn(), scrollToBottom: vi.fn(),
      appendCitationWarning: vi.fn(), persistHistory: vi.fn(),
    });
    await view.generateResponse();
    expect(plugin.aiClient.converse).toHaveBeenCalledTimes(3);
    expect(app.vault.process).toHaveBeenCalledTimes(1);
    expect(await app.vault.read()).toBe("# 제목\n\n수정한 본문");
    expect(plugin.aiChangeLedger.list()).toHaveLength(1);
    expect(plugin.aiClient.converse.mock.calls[0][1].some((tool: any) => tool.name === "read_note")).toBe(true);
  });

  it("태그 재생성 시 기존 태그를 제거하면서 제목·공백·줄바꿈을 보존한다", async () => {
    const { plugin, app } = runtime();
    await plugin.onload();
    const file = app.vault.getMarkdownFiles()[0];
    const body = "# 제목\n## 소제목\n본문 #이전 #태그\n#마지막\n다음 줄";
    await app.vault.modify(file, `---\ntags: [이전]\naliases: [보존]\n---\n${body}`);
    app.workspace.getLeavesOfType.mockReturnValue([{ view: { file } }] as any);
    plugin.aiClient.converse = vi.fn().mockResolvedValue({
      contentBlocks: [{ type: "text", text: "새태그, 문서, 테스트" }],
    });
    const view = plugin.registerView.mock.calls[0][1]({});
    await view.generateTags();
    expect(await app.vault.read()).toBe(
      "---\naliases: [보존]\ntags:\n  - 새태그\n  - 문서\n  - 테스트\n---\n# 제목\n## 소제목\n본문  \n\n다음 줄"
    );
  });

  it.each([true, false])("모바일=%s: Enter와 IME 조합 중 전송 동작을 구분한다", async (mobile) => {
    const { plugin } = runtime(mobile);
    await plugin.onload();
    plugin.settings.autoAttachActiveNote = false;
    const view = plugin.registerView.mock.calls[0][1]({});
    Object.assign(view, {
      viewContainerEl: element(), containerEl: element(),
      uiEvents: { registerDomEvent: vi.fn(), registerEvent: vi.fn() },
      applyFontSize: vi.fn(), handleSend: vi.fn(),
    });
    await view.buildInputArea();
    const handler = view.uiEvents.registerDomEvent.mock.calls.find(
      ([target, event]: any[]) => target === view.inputEl && event === "keydown"
    )[2];
    const event = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handler(event);
    expect(view.handleSend).toHaveBeenCalledTimes(mobile ? 0 : 1);
    expect(event.preventDefault).toHaveBeenCalledTimes(mobile ? 0 : 1);
    view.handleSend.mockClear();
    handler({ ...event, ctrlKey: true });
    expect(view.handleSend).toHaveBeenCalledTimes(1);
    handler({ ...event, isComposing: true });
    handler({ ...event, keyCode: 229 });
    expect(view.handleSend).toHaveBeenCalledTimes(1);
  });
});
