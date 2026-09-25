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
import { VIEW_I18N } from "./chat-view-i18n";

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

/** Obsidian DOM 헬퍼(createDiv 등)만 흉내 낸 요소. 만든 자식과 옵션을 기록한다. */
function fakeEl(options?: Record<string, any>): any {
  const el: any = { options, children: [] as any[] };
  el.createDiv = el.createSpan = (childOptions?: Record<string, any>) => {
    const child = fakeEl(childOptions);
    el.children.push(child);
    return child;
  };
  el.empty = () => {
    el.children = [];
  };
  el.addEventListener = vi.fn();
  el.addClass = vi.fn();
  el.removeClass = vi.fn();
  return el;
}

/** 요소 트리의 aria-label(툴팁)을 모두 모은다. */
function ariaLabels(el: any): string[] {
  const own = el.options?.attr?.["aria-label"];
  return [...(own ? [own] : []), ...el.children.flatMap(ariaLabels)];
}

describe("ChatView 로컬 파일 첨부", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    notices.mockClear();
  });

  function attachView() {
    const view = Object.create(ChatView.prototype) as any;
    Object.assign(view, {
      // 문서 첨부를 못 받는 백엔드여도 텍스트 첨부는 프롬프트에 들어가므로 붙어야 한다.
      plugin: { settings: { language: "ko", aiBackend: "ollama" } },
      attachedFiles: new Map(),
      attachedBinaryFiles: new Map(),
      manuallyAttachedPaths: new Set(),
      renderFileChips: vi.fn(),
    });
    return view;
  }

  it.each(["note.md", "memo.txt"])("PC에서 끌어온 %s를 텍스트로 첨부한다", async (name) => {
    const view = attachView();

    await view.addLocalFile(new File(["# 제목\n본문"], name));

    expect(view.attachedFiles.get(name)).toBe("# 제목\n본문");
    expect(notices).not.toHaveBeenCalled();
  });

  it("파일 선택창이 텍스트와 바이너리 첨부 형식을 함께 보여준다", () => {
    const input: any = { addEventListener: vi.fn(), click: vi.fn() };
    vi.stubGlobal("createEl", () => input);

    attachView().openBinaryFileAttach();

    expect(input.accept.split(",")).toEqual(
      expect.arrayContaining([".md", ".txt", ".csv", ".pdf", ".png", ".docx"]),
    );
  });
});

describe("ChatView 첨부 텍스트 잘림 안내", () => {
  const long = "A".repeat(8000) + "Z".repeat(1500);

  function contextView(files: Record<string, string>) {
    const view = Object.create(ChatView.prototype) as any;
    Object.assign(view, {
      plugin: { settings: { language: "ko" } },
      webSearchEnabled: false,
      attachedFiles: new Map(Object.entries(files)),
      attachedBinaryFiles: new Map(),
      autoAttachedPath: null,
      fileChipContainer: fakeEl(),
      contextRow: fakeEl(),
      updateContextRing: vi.fn(),
    });
    return view;
  }

  it("한도를 넘는 첨부는 앞부분만 보내고 잘린 사실을 프롬프트에 적는다", () => {
    const prefix: string = contextView({ "long.md": long }).buildContextPrefix();

    expect(prefix).toContain("A".repeat(8000));
    expect(prefix).not.toContain("Z");
    expect(prefix).toContain(VIEW_I18N.ko.attachmentTruncated(8000, 9500));
  });

  it("한도 이하 첨부는 잘림 안내 없이 그대로 보낸다", () => {
    const prefix: string = contextView({ "short.md": "짧은 본문" }).buildContextPrefix();

    expect(prefix).toBe(`${VIEW_I18N.ko.attachedFileLabel("short.md")}\n짧은 본문\n\n---\n\n`);
  });

  it("잘린 첨부의 칩에 잘린 범위를 툴팁으로 표시한다", () => {
    const view = contextView({ "long.md": long });

    view.renderFileChips();

    expect(ariaLabels(view.fileChipContainer)).toContain(
      VIEW_I18N.ko.attachmentTruncatedChip(8000, 9500),
    );
  });

  it("한도 이하 첨부의 칩에는 잘림 표시를 달지 않는다", () => {
    const view = contextView({ "short.md": "짧은 본문" });

    view.renderFileChips();

    expect(ariaLabels(view.fileChipContainer)).toEqual([VIEW_I18N.ko.removeAllFiles]);
  });
});
