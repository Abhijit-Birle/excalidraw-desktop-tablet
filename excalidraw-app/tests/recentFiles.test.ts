import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { newElementWith } from "@excalidraw/element";
import { createStore } from "idb-keyval";
import { describe, expect, it, vi } from "vitest";

import type { FileId } from "@excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  RECENT_CURRENT_SCENE_ID_KEY,
  createRecentFilesManager,
  formatLocalDate,
  getUniqueUntitledDateName,
} from "../data/recentFiles";

import type { UseStore } from "idb-keyval";

const makeAppState = (name: string | null = null) => ({
  ...getDefaultAppState(),
  name,
});

const createMemoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

let dbCounter = 0;
const createIsolatedManager = (
  overrides: Parameters<typeof createRecentFilesManager>[0] = {},
) => {
  dbCounter += 1;
  const store = createStore(
    `excalidraw-recent-files-test-${Date.now()}-${dbCounter}`,
    "recent-files-store",
  );
  const storage = createMemoryStorage();
  let currentTime = 1_700_000_000_000;
  let seq = 0;

  const pendingIdleTasks: Array<() => void> = [];

  const manager = createRecentFilesManager({
    store,
    storage,
    now: () => currentTime,
    generateId: () => {
      seq += 1;
      return `scene-uuid-${seq}`;
    },
    renderThumbnail: async () => "data:image/png;base64,stub-thumb",
    scheduleIdle: (cb) => {
      pendingIdleTasks.push(cb);
      return () => {
        const idx = pendingIdleTasks.indexOf(cb);
        if (idx >= 0) {
          pendingIdleTasks.splice(idx, 1);
        }
      };
    },
    ...overrides,
  });

  const advanceTime = (ms: number) => {
    currentTime += ms;
  };

  const flushIdle = async () => {
    while (pendingIdleTasks.length > 0) {
      const task = pendingIdleTasks.shift()!;
      task();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return { manager, storage, advanceTime, flushIdle };
};

describe("recentFiles", () => {
  it("upserts on the same scene id without creating duplicates and preserves createdAt", async () => {
    const { manager, advanceTime, flushIdle } = createIsolatedManager();
    const rect1 = API.createElement({ type: "rectangle", id: "r1" });

    const first = await manager.saveSnapshot({
      sceneId: "scene-a",
      elements: [rect1],
      appState: makeAppState("First title"),
      files: {},
    });
    expect(first).not.toBeNull();
    await flushIdle();

    advanceTime(5_000);
    const rect2 = API.createElement({ type: "ellipse", id: "e1" });

    const updated = await manager.saveSnapshot({
      sceneId: "scene-a",
      elements: [rect1, rect2],
      appState: makeAppState("Renamed title"),
      files: {},
    });

    expect(updated?.id).toBe("scene-a");
    expect(updated?.createdAt).toBe(first?.createdAt);
    expect(updated?.updatedAt).toBe(first!.createdAt + 5_000);
    expect(updated?.name).toBe("Renamed title");
    expect(updated?.thumbnail).toBe("data:image/png;base64,stub-thumb");

    const list = await manager.listRecentFiles();
    expect(list).toHaveLength(1);
    expect(list[0].elements).toHaveLength(2);
  });

  it("caps stored entries at 50 and evicts least-recent entries", async () => {
    const { manager, advanceTime } = createIsolatedManager();
    const rect = API.createElement({ type: "rectangle" });

    for (let i = 1; i <= 55; i += 1) {
      advanceTime(100);
      await manager.saveSnapshot({
        sceneId: `scene-${i}`,
        elements: [rect],
        appState: makeAppState(`Diagram ${i}`),
        files: {},
        skipThumbnail: true,
      });
    }

    const list = await manager.listRecentFiles();
    expect(list).toHaveLength(50);
    // Most recent first (55 down to 6); scenes 1..5 were evicted
    expect(list[0].id).toBe("scene-55");
    expect(list[49].id).toBe("scene-6");
    expect(await manager.getRecentFile("scene-1")).toBeNull();
    expect(await manager.getRecentFile("scene-5")).toBeNull();
    expect(await manager.getRecentFile("scene-6")).not.toBeNull();
  });

  it("deletes a single entry by id and clears all entries", async () => {
    const { manager, advanceTime } = createIsolatedManager();
    const rect = API.createElement({ type: "rectangle" });

    await manager.saveSnapshot({
      sceneId: "s1",
      elements: [rect],
      appState: makeAppState("One"),
      files: {},
      skipThumbnail: true,
    });
    advanceTime(1_000);
    await manager.saveSnapshot({
      sceneId: "s2",
      elements: [rect],
      appState: makeAppState("Two"),
      files: {},
      skipThumbnail: true,
    });

    await manager.deleteRecentFile("s1");
    let list = await manager.listRecentFiles();
    expect(list.map((r) => r.id)).toEqual(["s2"]);

    await manager.clearRecentFiles();
    list = await manager.listRecentFiles();
    expect(list).toHaveLength(0);
  });

  it("handles IndexedDB quota/write failures cleanly with console.warn and never throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
    const failingStore: UseStore = async () => {
      throw quotaError;
    };

    const { manager } = createIsolatedManager({
      store: failingStore,
      storage: {
        getItem: () => {
          throw quotaError;
        },
        setItem: () => {
          throw quotaError;
        },
      },
    });

    const rect = API.createElement({ type: "rectangle" });
    const saved = await manager.saveSnapshot({
      sceneId: "quota-scene",
      elements: [rect],
      appState: makeAppState("Quota test"),
      files: {},
      skipThumbnail: true,
    });

    expect(saved).toBeNull();
    expect(await manager.listRecentFiles()).toEqual([]);
    expect(await manager.deleteRecentFile("quota-scene")).toBe(false);
    expect(await manager.clearRecentFiles()).toBe(false);
    expect(() => manager.getCurrentSceneId()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("skips snapshots when canvas has zero non-deleted elements or when collaborating", async () => {
    const { manager } = createIsolatedManager();
    const deletedRect = {
      ...API.createElement({ type: "rectangle" }),
      isDeleted: true,
    };

    expect(
      await manager.saveSnapshot({
        sceneId: "empty-1",
        elements: [],
        appState: makeAppState("Empty"),
        files: {},
      }),
    ).toBeNull();

    expect(
      await manager.saveSnapshot({
        sceneId: "empty-deleted",
        elements: [deletedRect],
        appState: makeAppState("Only deleted"),
        files: {},
      }),
    ).toBeNull();

    const activeRect = API.createElement({ type: "rectangle" });
    expect(
      await manager.saveSnapshot({
        sceneId: "collab-scene",
        elements: [activeRect],
        appState: makeAppState("Collab"),
        files: {},
        isCollaborating: true,
      }),
    ).toBeNull();

    expect(await manager.listRecentFiles()).toHaveLength(0);
  });

  it("copies only referenced binary image files independently into snapshot", async () => {
    const { manager } = createIsolatedManager();
    const usedFileId = "file-used" as FileId;
    const unusedFileId = "file-unused" as FileId;

    const imageEl = API.createElement({
      type: "image",
      id: "img1",
      fileId: usedFileId,
      status: "saved",
    });

    const usedFile: BinaryFileData = {
      id: usedFileId,
      dataURL: "data:image/png;base64,used" as BinaryFileData["dataURL"],
      mimeType: "image/png",
      created: 1000,
    };
    const unusedFile: BinaryFileData = {
      id: unusedFileId,
      dataURL: "data:image/png;base64,unused" as BinaryFileData["dataURL"],
      mimeType: "image/png",
      created: 1000,
    };
    const files: BinaryFiles = {
      [usedFileId]: usedFile,
      [unusedFileId]: unusedFile,
    };

    const saved = await manager.saveSnapshot({
      sceneId: "img-scene",
      elements: [imageEl],
      appState: makeAppState("Images"),
      files,
      skipThumbnail: true,
    });

    // Mutate caller's files map afterward to confirm deep isolation
    delete files[usedFileId];

    expect(saved?.files[usedFileId]?.dataURL).toBe(
      "data:image/png;base64,used",
    );
    expect(saved?.files[unusedFileId]).toBeUndefined();
    const stored = await manager.getRecentFile("img-scene");
    expect(stored?.files[usedFileId]?.dataURL).toBe(
      "data:image/png;base64,used",
    );
  });

  it("throttles thumbnail generation to >=10s and skips when elements are unchanged", async () => {
    const renderThumbnail = vi.fn(
      async () => "data:image/png;base64,generated",
    );
    const { manager, advanceTime, flushIdle } = createIsolatedManager({
      renderThumbnail,
    });

    const rect = API.createElement({ type: "rectangle", id: "r-thumb" });

    // Initial snapshot schedules thumbnail
    await manager.saveSnapshot({
      sceneId: "thumb-scene",
      elements: [rect],
      appState: makeAppState("Thumb"),
      files: {},
    });
    await flushIdle();
    expect(renderThumbnail).toHaveBeenCalledTimes(1);

    // At +12s, appState changed WITHOUT changing elements -> skipped
    advanceTime(12_000);
    await manager.saveSnapshot({
      sceneId: "thumb-scene",
      elements: [rect],
      appState: { ...makeAppState("Thumb"), scrollX: 120 },
      files: {},
    });
    await flushIdle();
    expect(renderThumbnail).toHaveBeenCalledTimes(1);

    // At +12s, elements DID change -> thumbnail regenerates
    const updatedRect1 = newElementWith(rect, { width: 150 });
    await manager.saveSnapshot({
      sceneId: "thumb-scene",
      elements: [updatedRect1],
      appState: makeAppState("Thumb"),
      files: {},
    });
    await flushIdle();
    expect(renderThumbnail).toHaveBeenCalledTimes(2);

    // Elements changed at +2s (< 10s throttle window) -> throttled
    advanceTime(2_000);
    const updatedRect2 = newElementWith(updatedRect1, { width: 220 });
    await manager.saveSnapshot({
      sceneId: "thumb-scene",
      elements: [updatedRect2],
      appState: makeAppState("Thumb"),
      files: {},
    });
    await flushIdle();
    expect(renderThumbnail).toHaveBeenCalledTimes(2);

    // After >= 10s elapsed from last thumbnail, elements changed -> regenerates
    advanceTime(8_500);
    const updatedRect3 = newElementWith(updatedRect2, { width: 280 });
    await manager.saveSnapshot({
      sceneId: "thumb-scene",
      elements: [updatedRect3],
      appState: makeAppState("Thumb"),
      files: {},
    });
    await flushIdle();
    expect(renderThumbnail).toHaveBeenCalledTimes(3);
  });

  it("rotates and persists current scene id and bumps opened entries to the top", async () => {
    const { manager, storage, advanceTime } = createIsolatedManager();
    const id1 = manager.getCurrentSceneId();
    expect(storage.getItem(RECENT_CURRENT_SCENE_ID_KEY)).toBe(id1);

    const id2 = manager.rotateCurrentSceneId();
    expect(id2).not.toBe(id1);
    expect(storage.getItem(RECENT_CURRENT_SCENE_ID_KEY)).toBe(id2);

    const rect = API.createElement({ type: "rectangle" });
    await manager.saveSnapshot({
      sceneId: id1,
      elements: [rect],
      appState: makeAppState("Older"),
      files: {},
      skipThumbnail: true,
    });
    advanceTime(1_000);
    await manager.saveSnapshot({
      sceneId: id2,
      elements: [rect],
      appState: makeAppState("Newer"),
      files: {},
      skipThumbnail: true,
    });

    advanceTime(1_000);
    await manager.touchRecentFile(id1);
    const list = await manager.listRecentFiles();
    expect(list.map((r) => r.id)).toEqual([id1, id2]);
  });

  it("creates fresh dated untitled scenes with suffix deduplication at the top of the list", async () => {
    const fixedTime = new Date(2026, 10, 11, 14, 30, 0).getTime();
    const { manager, storage } = createIsolatedManager({
      now: () => fixedTime,
    });
    const expectedDate = formatLocalDate(fixedTime);

    const firstBlank = await manager.createNewSceneRecord({
      appState: makeAppState(),
    });
    expect(firstBlank).not.toBeNull();
    expect(firstBlank!.name).toBe(`Untitled-${expectedDate}`);
    expect(firstBlank!.elements).toEqual([]);
    expect(firstBlank!.thumbnail).toBeNull();
    expect(firstBlank!.appState.name).toBe(`Untitled-${expectedDate}`);
    expect(storage.getItem(RECENT_CURRENT_SCENE_ID_KEY)).toBe(firstBlank!.id);

    const secondBlank = await manager.createNewSceneRecord({
      appState: makeAppState(),
      minUpdatedAt: firstBlank!.updatedAt + 1,
    });
    expect(secondBlank!.name).toBe(`Untitled-${expectedDate}-2`);

    const thirdBlank = await manager.createNewSceneRecord({
      appState: makeAppState(),
      minUpdatedAt: secondBlank!.updatedAt + 1,
      extraExistingNames: [`Untitled-${expectedDate}-3`],
    });
    expect(thirdBlank!.name).toBe(`Untitled-${expectedDate}-4`);

    const blockedInCollab = await manager.createNewSceneRecord({
      appState: makeAppState(),
      isCollaborating: true,
    });
    expect(blockedInCollab).toBeNull();

    const list = await manager.listRecentFiles();
    expect(list.map((r) => r.name)).toEqual([
      `Untitled-${expectedDate}-4`,
      `Untitled-${expectedDate}-2`,
      `Untitled-${expectedDate}`,
    ]);
    expect(
      getUniqueUntitledDateName([`Untitled-${expectedDate}`], fixedTime),
    ).toBe(`Untitled-${expectedDate}-2`);
  });

  it("renames recent files while preserving updatedAt and ignores blank names", async () => {
    const { manager, advanceTime } = createIsolatedManager();
    const rect = API.createElement({ type: "rectangle" });

    const created = await manager.saveSnapshot({
      sceneId: "rename-scene",
      elements: [rect],
      appState: makeAppState("Untitled-2026-11-11"),
      files: {},
      skipThumbnail: true,
    });
    expect(created).not.toBeNull();

    advanceTime(5_000);
    const renamed = await manager.renameRecentFile(
      "rename-scene",
      "  Service Architecture  ",
    );
    expect(renamed).not.toBeNull();
    expect(renamed!.name).toBe("Service Architecture");
    expect(renamed!.appState.name).toBe("Service Architecture");
    expect(renamed!.updatedAt).toBe(created!.updatedAt);

    const blankRename = await manager.renameRecentFile("rename-scene", "   ");
    expect(blankRename).toBeNull();

    const fetched = await manager.getRecentFile("rename-scene");
    expect(fetched?.name).toBe("Service Architecture");
    expect(fetched?.appState.name).toBe("Service Architecture");
  });
});
