import { describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { createRequire } from "node:module";
// @ts-expect-error 빌드 스크립트(.mjs)는 타입 선언이 없다
import { AWS_NODE_PACKAGES, NODE_BUILTINS, nodeSubbundle } from "../esbuild-node-subbundle.mjs";
import { runInNewContext } from "node:vm";
import * as obsidian from "./__mocks__/obsidian";

// 실제 배포 진입점을 실행한다. 모바일에서는 Node 전역과 네이티브 require를 제공하지 않는다.
const bundle = (await build({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "chrome106",
  external: ["obsidian", "electron", ...NODE_BUILTINS], minify: true, write: false,
  plugins: [nodeSubbundle(AWS_NODE_PACKAGES)],
})).outputFiles[0].text;
const nodeRequire = createRequire(import.meta.url);

function element(): any {
  const el: any = { parentElement: null, textContent: "" };
  for (const method of ["createDiv", "createSpan", "createEl"]) el[method] = () => element();
  for (const method of ["setText", "setAttr", "setAttribute", "appendChild", "addClass", "removeClass", "empty", "remove", "addEventListener"]) el[method] = vi.fn();
  el.classList = { add: vi.fn(), remove: vi.fn() };
  // 옵시디언의 모든 노드는 자기가 속한 창의 문서를 `doc`으로 돌려준다.
  el.doc = { createElementNS: () => element() };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  return el;
}

/**
 * @param native PC에서 require가 돌려줄 모듈 대역 (electron, fs 등). 없는 모듈은 실제 Node 모듈을 쓴다.
 */
function runtime(mobile = true, initial: Record<string, unknown> = {}, native: Record<string, unknown> = {}) {
  let data = { aiBackend: "gemini", confirmToolExecution: false, ...initial };
  const nativeLoads: string[] = [];
  // Obsidian SecretStorage: 볼트별 키체인. 값이 바뀌면 "changed"를 알린다.
  const secrets = new Map<string, string>();
  const secretListeners: Array<() => void> = [];
  const secretStorage = {
    getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
    setSecret: vi.fn((id: string, value: string) => {
      secrets.set(id, value);
      for (const listener of secretListeners) listener();
    }),
    on: (_name: string, listener: () => void) => { secretListeners.push(listener); return {}; },
  };
  // 볼트·기기별 로컬 저장소 (app.loadLocalStorage / saveLocalStorage)
  const localStorage = new Map<string, unknown>();
  const file = Object.assign(new obsidian.TFile(), { path: "note.md", basename: "note", extension: "md" });
  let note = "# 제목\n\n원문";
  const app = {
    secretStorage,
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { localStorage.set(key, value); },
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
      addIcon: vi.fn(), getAllTags: () => [],
    };
    nativeLoads.push(id);
    if (mobile) throw new Error(`Unavailable on mobile: ${id}`);
    return id in native ? native[id] : nodeRequire(id);
  };
  runInNewContext(bundle, {
    module, exports: module.exports, require, console,
    TextEncoder, TextDecoder, AbortController, URL, URLSearchParams, Uint8Array, setTimeout, clearTimeout,
    TransformStream, ReadableStream, WritableStream, Blob, Request, Response, Headers,
    // Buffer는 PC(Electron)에만 있는 전역이다.
    ...(mobile ? {} : { Buffer }),
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

  it("모바일은 PC 암호문을 키로 쓰지 않고, 비밀을 골라 저장·재로드한 뒤에도 PC 원본을 보존한다", async () => {
    const { plugin, data, secretStorage } = runtime(true, { bedrockApiKey: "enc:pc-only" });
    await plugin.loadSettings();
    expect(plugin.settings.bedrockApiKey).toBe("");
    secretStorage.setSecret("my-bedrock", "mobile-key");
    plugin.settings.bedrockApiKeySecret = "my-bedrock";
    await plugin.saveSettings();
    await plugin.loadSettings();
    expect(plugin.settings.bedrockApiKey).toBe("mobile-key");
    expect(data().bedrockApiKey).toBe("enc:pc-only");
    expect(data().bedrockApiKeySecret).toBe("my-bedrock");
  });

  it("레거시 키 마이그레이션에서 잘못된 타입은 모바일 키로 사용하지 않는다", async () => {
    const { plugin } = runtime(true, { geminiApiKey: 42, bedrockApiKey: "enc:pc-only" });
    await plugin.loadSettings();
    expect(plugin.settings.geminiApiKey).toBe("");
    expect(plugin.settings.bedrockApiKey).toBe("");
  });

  it("키 값은 data.json에 쓰지 않고 비밀 이름만 저장한다", async () => {
    const { plugin, data, secretStorage } = runtime(true);
    await plugin.loadSettings();
    secretStorage.setSecret("my-gemini", "g-key");
    plugin.settings.geminiApiKeySecret = "my-gemini";
    plugin.refreshApiKeys();
    await plugin.saveSettings();
    expect(plugin.settings.geminiApiKey).toBe("g-key");
    expect(data().geminiApiKey).toBe("");
    expect(data().geminiApiKeySecret).toBe("my-gemini");
  });

  it("키체인에서 값을 바꾸면 다시 읽어 다음 요청부터 새 키를 쓴다", async () => {
    const { plugin, secretStorage } = runtime(true, { geminiApiKeySecret: "my-gemini" });
    secretStorage.setSecret("my-gemini", "first");
    await plugin.onload();
    expect(plugin.settings.geminiApiKey).toBe("first");
    secretStorage.setSecret("my-gemini", "rotated");
    expect(plugin.settings.geminiApiKey).toBe("rotated");
  });

  describe("예전 저장소의 키 옮기기", () => {
    /** 예전 PC 버전의 형식: "enc:" + base64(OS 키체인 암호문). 가짜 키체인은 평문을 그대로 돌려준다. */
    const encrypted = (value: string) => `enc:${Buffer.from(value).toString("base64")}`;
    const LEGACY_FILE = "/user-data/agent-llms-credentials.json";

    /** Electron userData의 예전 자격증명 파일과 OS 키체인 대역. */
    function legacyPcStore(content: Record<string, string>, keychainAvailable = true) {
      const files = new Map([[LEGACY_FILE, JSON.stringify(content)]]);
      const fs = {
        existsSync: (path: string) => files.has(path),
        readFileSync: (path: string) => files.get(path),
        writeFileSync: vi.fn(), renameSync: vi.fn(), unlinkSync: vi.fn(),
      };
      const electron = {
        app: { getPath: () => "/user-data" },
        safeStorage: {
          isEncryptionAvailable: () => keychainAvailable,
          decryptString: (value: Buffer) => value.toString(),
        },
      };
      return { files, fs, native: { fs, electron } };
    }

    it("모바일의 예전 단일 항목을 키별 비밀로 옮기고 data.json에는 이름만 남긴다", async () => {
      const { plugin, data, secretStorage } = runtime(true);
      secretStorage.setSecret("agent-llms-credentials", JSON.stringify({ geminiApiKey: "old-key" }));
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("old-key");
      expect(secretStorage.getSecret("agent-llms-gemini-key")).toBe("old-key");
      expect(data().geminiApiKeySecret).toBe("agent-llms-gemini-key");
      expect(data().geminiApiKey).toBe("");
    });

    it("PC의 예전 암호화 파일을 풀어 비밀로 옮기고 파일은 건드리지 않는다", async () => {
      const store = legacyPcStore({ openaiApiKey: encrypted("o-key"), bedrockApiKey: encrypted("b-key") });
      const { plugin, data, secretStorage } = runtime(false, {}, store.native);
      await plugin.loadSettings();
      expect(plugin.settings.openaiApiKey).toBe("o-key");
      expect(secretStorage.getSecret("agent-llms-openai-key")).toBe("o-key");
      expect(secretStorage.getSecret("agent-llms-bedrock-key")).toBe("b-key");
      expect(data().openaiApiKeySecret).toBe("agent-llms-openai-key");
      expect(data().openaiApiKey).toBe("");
      // 같은 PC의 다른 볼트도 이 파일에서 키를 옮겨야 하므로 지우지 않는다.
      expect([...store.files.keys()]).toEqual([LEGACY_FILE]);
      expect(store.fs.writeFileSync).not.toHaveBeenCalled();
      expect(store.fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("한 번 옮긴 볼트에서는 사용자가 지운 키가 예전 저장소에서 되살아나지 않는다", async () => {
      const store = legacyPcStore({ geminiApiKey: encrypted("old-key") });
      const { plugin, data } = runtime(false, {}, store.native);
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("old-key");
      plugin.settings.geminiApiKeySecret = "";
      await plugin.saveSettings();
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("");
      expect(data().geminiApiKeySecret).toBe("");
    });

    it("OS 키체인이 잠겨 파일을 풀지 못하면 암호문을 옮기지 않고 다음 실행에서 다시 시도한다", async () => {
      const store = legacyPcStore({ geminiApiKey: encrypted("old-key") }, false);
      const { plugin, secretStorage } = runtime(false, {}, store.native);
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("");
      expect(secretStorage.setSecret).not.toHaveBeenCalled();
      // 키체인이 풀린 뒤의 다음 실행
      store.native.electron.safeStorage.isEncryptionAvailable = () => true;
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("old-key");
    });

    it("아주 예전 버전이 data.json에 둔 평문 키를 비밀로 옮기고 파일에서 지운다", async () => {
      const { plugin, data, secretStorage } = runtime(true, { openaiApiKey: "plain-old" });
      await plugin.loadSettings();
      expect(plugin.settings.openaiApiKey).toBe("plain-old");
      expect(secretStorage.getSecret("agent-llms-openai-key")).toBe("plain-old");
      expect(data().openaiApiKey).toBe("");
      expect(data().openaiApiKeySecret).toBe("agent-llms-openai-key");
    });

    it("비밀 저장소에 쓰지 못하면 data.json의 예전 키를 지우지 않는다", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { plugin, data, secretStorage } = runtime(true, { geminiApiKey: "plain-old" });
      secretStorage.setSecret.mockImplementation(() => { throw new Error("Secure storage is not available."); });
      await plugin.loadSettings();
      expect(plugin.settings.geminiApiKey).toBe("");
      await plugin.saveSettings();
      expect(data().geminiApiKey).toBe("plain-old");
      vi.restoreAllMocks();
    });
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
