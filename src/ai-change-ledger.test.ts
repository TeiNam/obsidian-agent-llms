import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { AI_CHANGE_LEDGER_LIMIT, AiChangeLedger } from "./ai-change-ledger";

function makeApp(initial: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, text]) => [path, Buffer.from(text)])
  );
  const folders = new Set<string>();
  const storage = new Map<string, string>();

  const addParents = (path: string) => {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  };
  for (const path of files.keys()) addParents(path);

  const getAbstractFileByPath = (path: string): TFile | TFolder | null => {
    if (files.has(path)) {
      const file = new TFile();
      file.path = path;
      file.basename = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
      return file;
    }
    if (folders.has(path)) {
      const folder = new TFolder();
      folder.path = path;
      folder.children = [
        ...[...folders]
          .filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/"))
          .map((child) => getAbstractFileByPath(child) as TFolder),
        ...[...files.keys()]
          .filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/"))
          .map((child) => getAbstractFileByPath(child) as TFile),
      ];
      return folder;
    }
    return null;
  };

  const remove = (path: string) => {
    files.delete(path);
    for (const file of [...files.keys()]) if (file.startsWith(`${path}/`)) files.delete(file);
    folders.delete(path);
    for (const folder of [...folders]) if (folder.startsWith(`${path}/`)) folders.delete(folder);
  };

  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => storage.has(path),
        read: async (path: string) => storage.get(path) ?? "",
        write: async (path: string, data: string) => {
          storage.set(path, data);
        },
      },
      getAbstractFileByPath,
      readBinary: async (file: TFile) => {
        const bytes = files.get(file.path) ?? new Uint8Array();
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      createBinary: async (path: string, data: ArrayBuffer) => {
        addParents(path);
        files.set(path, new Uint8Array(data));
        return getAbstractFileByPath(path);
      },
      createFolder: async (path: string) => {
        addParents(`${path}/x`);
        folders.add(path);
      },
      delete: async (target: TFile | TFolder) => remove(target.path),
    },
    // 원복 시 삭제는 사용자 삭제 설정을 따르는 fileManager.trashFile 로 한다.
    fileManager: {
      trashFile: async (target: TFile | TFolder) => remove(target.path),
    },
  } as any;

  return {
    app,
    text: (path: string) => Buffer.from(files.get(path) ?? []).toString(),
    write: (path: string, text: string) => {
      addParents(path);
      files.set(path, Buffer.from(text));
    },
    exists: (path: string) => files.has(path) || folders.has(path),
  };
}

describe("AiChangeLedger", () => {
  it("수정 작업을 기록하고 마지막 상태를 원복한다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("edit_note", ["note.md"], async () => fs.write("note.md", "after"));
    expect(ledger.list()).toHaveLength(1);

    expect((await ledger.undoLast()).ok).toBe(true);
    expect(fs.text("note.md")).toBe("before");
    expect(ledger.list()).toHaveLength(0);
  });

  it("생성된 파일은 되돌릴 때 제거한다", async () => {
    const fs = makeApp();
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("create_note", ["new.md"], async () => fs.write("new.md", "new"));
    await ledger.undoLast();

    expect(fs.exists("new.md")).toBe(false);
  });

  it("작업 뒤 사용자가 다시 편집했으면 덮어쓰지 않는다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("edit_note", ["note.md"], async () => fs.write("note.md", "after"));
    fs.write("note.md", "user edit");

    expect(await ledger.undoLast()).toMatchObject({ ok: false, reason: "conflict" });
    expect(fs.text("note.md")).toBe("user edit");
  });

  it("최근 20건만 유지한다", async () => {
    const fs = makeApp({ "note.md": "0" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    for (let i = 1; i <= AI_CHANGE_LEDGER_LIMIT + 3; i++) {
      await ledger.run(`edit ${i}`, ["note.md"], async () => fs.write("note.md", String(i)));
    }

    expect(ledger.list()).toHaveLength(AI_CHANGE_LEDGER_LIMIT);
    expect(ledger.list().at(-1)?.label).toBe("edit 4");
  });

  it("쓰기 전에 멈춘 결과는 그사이 사용자가 저장해도 AI 변경으로 기록하지 않는다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    const result = await ledger.run(
      "edit_note",
      ["note.md"],
      async () => {
        fs.write("note.md", "user edit");
        return "failed";
      },
      (value) => value === "failed",
    );

    expect(result).toBe("failed");
    expect(ledger.list()).toHaveLength(0);
  });

  it("작업이 예외로 끝나면 부분 변경을 기록하고 원래 예외를 올린다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await expect(
      ledger.run(
        "move_file",
        ["note.md"],
        async () => {
          fs.write("note.md", "partial");
          throw new Error("boom");
        },
        () => true,
      ),
    ).rejects.toThrow("boom");
    expect(ledger.list()).toHaveLength(1);
  });

  it("원장 저장이 실패해도 끝난 작업의 결과를 그대로 돌려준다", async () => {
    const fs = makeApp({ "note.md": "before" });
    fs.app.vault.adapter.write = async () => {
      throw new Error("EACCES");
    };
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ledger.run("append_to_note", ["note.md"], async () => {
      fs.write("note.md", "before\nadded");
      return "appended";
    });

    expect(result).toBe("appended");
    // 파일에 못 남겨도 메모리 기록은 유지해 이번 세션에서는 되돌릴 수 있다.
    expect(ledger.list()).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
