import { afterEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => {
  class Component {}
  class ItemView extends Component {}
  class Modal {}
  class FuzzySuggestModal<T> extends Modal {}
  class TFile {
    path = "";
    name = "";
    basename = "";
    extension = "";
  }

  return {
    App: class {},
    Component,
    FuzzySuggestModal,
    ItemView,
    MarkdownRenderer: {},
    MarkdownView: class {},
    Modal,
    Notice: class {
      constructor(message: string) { notices(message); }
    },
    TFile,
    WorkspaceLeaf: class {},
    normalizePath: (path: string) => path,
    requestUrl: vi.fn(),
    setIcon: vi.fn(),
  };
});

describe("ChatView 메시지 복사", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    notices.mockClear();
  });

  function copyButton() {
    const copy = { empty: vi.fn(), setText: vi.fn(), addEventListener: vi.fn() };
    const content = { setText: vi.fn() };
    const actions = { createSpan: () => copy };
    const message = { createDiv: vi.fn().mockReturnValueOnce(content).mockReturnValueOnce(actions) };
    const view = Object.create(ChatView.prototype) as any;
    Object.assign(view, {
      plugin: { settings: { language: "ko" } },
      messagesEl: { createDiv: () => message },
      scrollToBottom: vi.fn(),
    });
    view.renderUserMessage({ role: "user", content: "복사할 내용" });
    return { copy, click: copy.addEventListener.mock.calls[0][1] as () => void };
  }

  it("클립보드 쓰기가 끝난 뒤에만 성공 표시를 보여준다", async () => {
    vi.useFakeTimers();
    const write = deferred<void>();
    const writeText = vi.fn(() => write.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { copy, click } = copyButton();
    click();
    expect(writeText).toHaveBeenCalledWith("복사할 내용");
    expect(copy.setText).not.toHaveBeenCalled();
    write.resolve();
    await Promise.resolve();
    expect(copy.setText).toHaveBeenCalledWith("✓");
    expect(notices).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(copy.empty).toHaveBeenCalledTimes(2);
  });

  it.each(["reject", "unavailable"])("복사 실패(%s)는 성공 표시 없이 안내한다", async (failure) => {
    vi.stubGlobal("navigator", failure === "reject"
      ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }
      : {});
    const { copy, click } = copyButton();
    click();
    await Promise.resolve();
    expect(copy.setText).not.toHaveBeenCalled();
    expect(notices).toHaveBeenCalledWith("클립보드에 복사하지 못했습니다. 다시 시도해 주세요.");
  });
});

import { TFile } from "obsidian";
import { ChatView } from "./chat-view";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path;
  file.basename = path.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

describe("ChatView 자동 첨부", () => {
  it("늦게 끝난 이전 노트 읽기가 현재 노트를 다시 덮어쓰지 않는다", async () => {
    const files = new Map([
      ["A.md", markdownFile("A.md")],
      ["B.md", markdownFile("B.md")],
    ]);
    const reads = new Map([
      ["A.md", deferred<string>()],
      ["B.md", deferred<string>()],
    ]);
    const view = Object.create(ChatView.prototype) as any;
    Object.assign(view, {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => files.get(path) ?? null,
          cachedRead: (file: TFile) => reads.get(file.path)!.promise,
        },
      },
      attachedFiles: new Map(),
      attachedBinaryFiles: new Map(),
      manuallyAttachedPaths: new Set(),
      autoAttachedPath: null,
      autoAttachVersion: 0,
      renderFileChips: vi.fn(),
    });

    const first = view.autoAttachFile("A.md");
    const second = view.autoAttachFile("B.md");
    reads.get("B.md")!.resolve("B 내용");
    await second;
    reads.get("A.md")!.resolve("A 내용");
    await first;

    expect([...view.attachedFiles.entries()]).toEqual([["B.md", "B 내용"]]);
    expect(view.autoAttachedPath).toBe("B.md");
  });
});
