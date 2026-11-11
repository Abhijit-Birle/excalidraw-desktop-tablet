import {
  getNonDeletedElements,
  getSceneVersion,
  isInitializedImageElement,
} from "@excalidraw/element";
import { exportScene } from "@excalidraw/excalidraw";
import {
  clear,
  createStore,
  del,
  delMany,
  entries,
  get,
  set,
} from "idb-keyval";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import type { UseStore } from "idb-keyval";

export const RECENT_FILES_DB_NAME = "excalidraw-recent-files-db";
export const RECENT_FILES_STORE_NAME = "recent-files-store";
export const RECENT_CURRENT_SCENE_ID_KEY = "excalidraw-recent-current-id";

export const MAX_RECENT_FILES = 50;
export const THUMBNAIL_MAX_SIZE = 200;
export const THUMBNAIL_THROTTLE_MS = 10_000;

export type RecentFileAppState = {
  name: string | null;
  viewBackgroundColor: AppState["viewBackgroundColor"];
  gridSize: AppState["gridSize"];
  gridStep: AppState["gridStep"];
  gridModeEnabled: AppState["gridModeEnabled"];
  scrollX: AppState["scrollX"];
  scrollY: AppState["scrollY"];
  zoom: AppState["zoom"];
};

export type RecentFileRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
  elements: readonly NonDeletedExcalidrawElement[];
  appState: RecentFileAppState;
  files: BinaryFiles;
};

export type SnapshotInput = {
  elements: readonly ExcalidrawElement[];
  appState: Pick<
    AppState,
    | "name"
    | "viewBackgroundColor"
    | "gridSize"
    | "gridStep"
    | "gridModeEnabled"
    | "scrollX"
    | "scrollY"
    | "zoom"
    | "theme"
  >;
  files: BinaryFiles;
  sceneId?: string;
  isCollaborating?: boolean;
  hostWindow?: Window | typeof globalThis | null;
  skipThumbnail?: boolean;
};

export type CreateNewSceneInput = {
  appState: Pick<
    AppState,
    | "viewBackgroundColor"
    | "gridSize"
    | "gridStep"
    | "gridModeEnabled"
    | "scrollX"
    | "scrollY"
    | "zoom"
  >;
  isCollaborating?: boolean;
  minUpdatedAt?: number;
  extraExistingNames?: readonly (string | null | undefined)[];
};

export const formatLocalDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getUniqueUntitledDateName = (
  existingNames: Iterable<string>,
  timestamp: number,
): string => {
  const usedNames = new Set<string>();
  for (const name of existingNames) {
    const trimmed = name.trim();
    if (trimmed) {
      usedNames.add(trimmed);
    }
  }

  const baseName = `Untitled-${formatLocalDate(timestamp)}`;
  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}-${suffix}`;
};

export type ThumbnailRenderer = (params: {
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Pick<AppState, "viewBackgroundColor" | "theme">;
  files: BinaryFiles;
}) => Promise<string | null>;

export type RecentFilesManagerOptions = {
  store?: UseStore;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  maxEntries?: number;
  thumbnailThrottleMs?: number;
  now?: () => number;
  generateId?: () => string;
  renderThumbnail?: ThumbnailRenderer;
  scheduleIdle?: (
    callback: () => void,
    hostWindow?: Window | typeof globalThis | null,
  ) => () => void;
};

type ThumbnailTrackingEntry = {
  versionKey: string;
  generatedAt: number;
};

const createDefaultStore = (): UseStore =>
  createStore(RECENT_FILES_DB_NAME, RECENT_FILES_STORE_NAME);

const tryGetDefaultStorage = (): Pick<
  Storage,
  "getItem" | "setItem"
> | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (error) {
    console.warn("Recent files: unable to access localStorage", error);
    return null;
  }
};

const defaultGenerateId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `scene-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const defaultScheduleIdle = (
  callback: () => void,
  hostWindow?: Window | typeof globalThis | null,
): (() => void) => {
  const target = hostWindow ?? globalThis;
  const ric = (
    target as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  )?.requestIdleCallback;
  const cic = (
    target as Window & {
      cancelIdleCallback?: (id: number) => void;
    }
  )?.cancelIdleCallback;

  if (typeof ric === "function") {
    const idleId = ric(callback, { timeout: 2000 });
    return () => {
      try {
        cic?.(idleId);
      } catch {
        // ignore cancellation failure
      }
    };
  }

  const timerId = setTimeout(callback, 0);
  return () => clearTimeout(timerId);
};

const defaultRenderThumbnail: ThumbnailRenderer = async ({
  elements,
  appState,
  files,
}) => {
  const canvas = await exportScene({
    type: "canvas",
    data: {
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files,
    },
    config: {
      maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
      padding: 10,
      theme: appState.theme,
    },
  });

  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }

  return canvas.toDataURL("image/png");
};

const cloneJsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const copyReferencedFiles = (
  nonDeletedElements: readonly NonDeletedExcalidrawElement[],
  files: BinaryFiles,
): BinaryFiles => {
  const copied: BinaryFiles = {};
  for (const element of nonDeletedElements) {
    if (isInitializedImageElement(element) && element.fileId) {
      const fileData = files[element.fileId];
      if (fileData && !copied[element.fileId]) {
        copied[element.fileId] = { ...fileData };
      }
    }
  }
  return copied;
};

const extractAppStateSubset = (
  appState: Omit<SnapshotInput["appState"], "theme">,
): RecentFileAppState => ({
  name: appState.name ?? null,
  viewBackgroundColor: appState.viewBackgroundColor,
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  gridModeEnabled: appState.gridModeEnabled,
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  zoom: { ...appState.zoom },
});

const getSceneVersionKey = (
  nonDeletedElements: readonly NonDeletedExcalidrawElement[],
): string =>
  `${nonDeletedElements.length}:${getSceneVersion(nonDeletedElements)}`;

export const createRecentFilesManager = (
  options: RecentFilesManagerOptions = {},
) => {
  const store = options.store ?? createDefaultStore();
  const maxEntries = options.maxEntries ?? MAX_RECENT_FILES;
  const thumbnailThrottleMs =
    options.thumbnailThrottleMs ?? THUMBNAIL_THROTTLE_MS;
  const now = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? defaultGenerateId;
  const renderThumbnail = options.renderThumbnail ?? defaultRenderThumbnail;
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;

  const getStorage = () =>
    options.storage !== undefined ? options.storage : tryGetDefaultStorage();

  let fallbackCurrentSceneId: string | null = null;
  let writeQueue: Promise<unknown> = Promise.resolve();
  const thumbnailState = new Map<string, ThumbnailTrackingEntry>();
  const pendingThumbnailCancels = new Map<string, () => void>();
  const deletedOrClearedEpochs = new Map<string, number>();
  let globalClearEpoch = 0;

  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T | null> => {
    const run = writeQueue.then(task, task).catch((error) => {
      console.warn("Recent files: persistence error", error);
      return null;
    });
    writeQueue = run;
    return run;
  };

  const cancelPendingThumbnail = (sceneId?: string) => {
    if (sceneId !== undefined) {
      const cancel = pendingThumbnailCancels.get(sceneId);
      if (cancel) {
        cancel();
        pendingThumbnailCancels.delete(sceneId);
      }
      return;
    }

    for (const cancel of pendingThumbnailCancels.values()) {
      cancel();
    }
    pendingThumbnailCancels.clear();
  };

  const getCurrentSceneId = (): string => {
    const storage = getStorage();
    if (storage) {
      try {
        const stored = storage.getItem(RECENT_CURRENT_SCENE_ID_KEY);
        if (stored && stored.trim()) {
          fallbackCurrentSceneId = stored;
          return stored;
        }
      } catch (error) {
        console.warn("Recent files: failed reading current scene id", error);
      }
    }

    if (fallbackCurrentSceneId) {
      return fallbackCurrentSceneId;
    }

    const createdId = generateId();
    setCurrentSceneId(createdId);
    return createdId;
  };

  const setCurrentSceneId = (id: string): void => {
    fallbackCurrentSceneId = id;
    const storage = getStorage();
    if (storage) {
      try {
        storage.setItem(RECENT_CURRENT_SCENE_ID_KEY, id);
      } catch (error) {
        console.warn("Recent files: failed saving current scene id", error);
      }
    }
  };

  const rotateCurrentSceneId = (): string => {
    const nextId = generateId();
    setCurrentSceneId(nextId);
    return nextId;
  };

  const evictExcessEntries = async () => {
    if (maxEntries <= 0) {
      await clear(store);
      return;
    }
    const allEntries = await entries<string, RecentFileRecord>(store);
    if (allEntries.length <= maxEntries) {
      return;
    }
    allEntries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const excessKeys = allEntries.slice(maxEntries).map(([key]) => key);
    if (excessKeys.length > 0) {
      await delMany(excessKeys, store);
      for (const evictedId of excessKeys) {
        cancelPendingThumbnail(evictedId);
        thumbnailState.delete(evictedId);
      }
    }
  };

  const scheduleThumbnailUpdate = (params: {
    sceneId: string;
    versionKey: string;
    elements: readonly NonDeletedExcalidrawElement[];
    viewBackgroundColor: AppState["viewBackgroundColor"];
    theme: AppState["theme"];
    files: BinaryFiles;
    hostWindow?: Window | typeof globalThis | null;
  }) => {
    const {
      sceneId,
      versionKey,
      elements,
      viewBackgroundColor,
      theme,
      files,
      hostWindow,
    } = params;

    cancelPendingThumbnail(sceneId);
    const scheduledClearEpoch = globalClearEpoch;
    const scheduledDeleteEpoch = deletedOrClearedEpochs.get(sceneId) ?? 0;

    const cancel = scheduleIdle(() => {
      pendingThumbnailCancels.delete(sceneId);
      if (
        globalClearEpoch !== scheduledClearEpoch ||
        (deletedOrClearedEpochs.get(sceneId) ?? 0) !== scheduledDeleteEpoch
      ) {
        return;
      }

      thumbnailState.set(sceneId, {
        versionKey,
        generatedAt: now(),
      });

      void (async () => {
        try {
          const dataUrl = await renderThumbnail({
            elements,
            appState: { viewBackgroundColor, theme },
            files,
          });
          if (
            !dataUrl ||
            globalClearEpoch !== scheduledClearEpoch ||
            (deletedOrClearedEpochs.get(sceneId) ?? 0) !== scheduledDeleteEpoch
          ) {
            return;
          }

          await enqueueWrite(async () => {
            if (
              globalClearEpoch !== scheduledClearEpoch ||
              (deletedOrClearedEpochs.get(sceneId) ?? 0) !==
                scheduledDeleteEpoch
            ) {
              return;
            }
            const current = await get<RecentFileRecord>(sceneId, store);
            if (!current) {
              return;
            }
            await set(
              sceneId,
              {
                ...current,
                thumbnail: dataUrl,
              },
              store,
            );
          });
        } catch (error) {
          console.warn("Recent files: thumbnail generation failed", error);
        }
      })();
    }, hostWindow);

    pendingThumbnailCancels.set(sceneId, cancel);
  };

  const saveSnapshot = async (
    input: SnapshotInput,
  ): Promise<RecentFileRecord | null> => {
    if (input.isCollaborating) {
      return null;
    }

    const nonDeletedElements = getNonDeletedElements(input.elements);
    if (nonDeletedElements.length === 0) {
      return null;
    }

    const sceneId = input.sceneId ?? getCurrentSceneId();
    const versionKey = getSceneVersionKey(nonDeletedElements);

    let clonedElements: readonly NonDeletedExcalidrawElement[];
    let clonedAppState: RecentFileAppState;
    let clonedFiles: BinaryFiles;

    try {
      clonedElements = cloneJsonValue(nonDeletedElements);
      clonedAppState = cloneJsonValue(extractAppStateSubset(input.appState));
      clonedFiles = cloneJsonValue(
        copyReferencedFiles(nonDeletedElements, input.files),
      );
    } catch (error) {
      console.warn("Recent files: failed to serialize scene snapshot", error);
      return null;
    }

    const trimmedName = input.appState.name?.trim();
    const displayName = trimmedName || "Untitled";
    const timestamp = now();

    const saveResult = await enqueueWrite(async () => {
      const existing = await get<RecentFileRecord>(sceneId, store);
      const existingVersionKey = existing
        ? getSceneVersionKey(existing.elements)
        : null;
      const record: RecentFileRecord = {
        id: sceneId,
        name: displayName,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        thumbnail: existing?.thumbnail ?? null,
        elements: clonedElements,
        appState: clonedAppState,
        files: clonedFiles,
      };
      await set(sceneId, record, store);
      await evictExcessEntries();
      return { record, existingVersionKey };
    });

    if (!saveResult) {
      return null;
    }

    const { record: savedRecord, existingVersionKey } = saveResult;

    if (!input.skipThumbnail) {
      const prevThumb = thumbnailState.get(sceneId);
      const hasThumbnailOnRecord = Boolean(savedRecord.thumbnail);
      const elementsChanged = prevThumb
        ? prevThumb.versionKey !== versionKey || !hasThumbnailOnRecord
        : !hasThumbnailOnRecord || existingVersionKey !== versionKey;
      const throttleElapsed =
        !prevThumb ||
        !hasThumbnailOnRecord ||
        now() - prevThumb.generatedAt >= thumbnailThrottleMs;

      if (elementsChanged && throttleElapsed) {
        scheduleThumbnailUpdate({
          sceneId,
          versionKey,
          elements: clonedElements,
          viewBackgroundColor: clonedAppState.viewBackgroundColor,
          theme: input.appState.theme,
          files: clonedFiles,
          hostWindow: input.hostWindow,
        });
      }
    }

    return savedRecord;
  };

  const listRecentFiles = async (): Promise<RecentFileRecord[]> => {
    try {
      const allEntries = await entries<string, RecentFileRecord>(store);
      return allEntries
        .map(([, record]) => record)
        .filter(
          (record): record is RecentFileRecord =>
            !!record &&
            typeof record.id === "string" &&
            Array.isArray(record.elements),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.warn("Recent files: failed listing entries", error);
      return [];
    }
  };

  const getRecentFile = async (
    id: string,
  ): Promise<RecentFileRecord | null> => {
    try {
      return (await get<RecentFileRecord>(id, store)) ?? null;
    } catch (error) {
      console.warn("Recent files: failed reading entry", error);
      return null;
    }
  };

  const touchRecentFile = async (
    id: string,
  ): Promise<RecentFileRecord | null> => {
    return enqueueWrite(async () => {
      const existing = await get<RecentFileRecord>(id, store);
      if (!existing) {
        return null;
      }
      const updated: RecentFileRecord = {
        ...existing,
        updatedAt: now(),
      };
      await set(id, updated, store);
      const versionKey = getSceneVersionKey(existing.elements);
      if (existing.thumbnail) {
        thumbnailState.set(id, { versionKey, generatedAt: updated.updatedAt });
      }
      return updated;
    });
  };

  const createNewSceneRecord = async (
    input: CreateNewSceneInput,
  ): Promise<RecentFileRecord | null> => {
    if (input.isCollaborating) {
      return null;
    }

    let clonedAppState: RecentFileAppState;
    try {
      clonedAppState = cloneJsonValue(
        extractAppStateSubset({
          ...input.appState,
          name: null,
        }),
      );
    } catch (error) {
      console.warn("Recent files: failed to serialize new scene state", error);
      return null;
    }

    const sceneId = rotateCurrentSceneId();

    return enqueueWrite(async () => {
      const allEntries = await entries<string, RecentFileRecord>(store);
      const existingNames = new Set<string>();
      for (const [, existingRecord] of allEntries) {
        if (existingRecord?.name) {
          existingNames.add(existingRecord.name);
        }
      }
      for (const extraName of input.extraExistingNames ?? []) {
        if (extraName) {
          existingNames.add(extraName);
        }
      }

      const currentTime = now();
      const timestamp = Math.max(currentTime, input.minUpdatedAt ?? 0);
      const name = getUniqueUntitledDateName(existingNames, currentTime);

      const record: RecentFileRecord = {
        id: sceneId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        thumbnail: null,
        elements: [],
        appState: {
          ...clonedAppState,
          name,
        },
        files: {},
      };

      await set(sceneId, record, store);
      await evictExcessEntries();
      return record;
    });
  };

  const renameRecentFile = async (
    id: string,
    nextName: string,
  ): Promise<RecentFileRecord | null> => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      return null;
    }

    return enqueueWrite(async () => {
      const existing = await get<RecentFileRecord>(id, store);
      if (!existing) {
        return null;
      }

      const updated: RecentFileRecord = {
        ...existing,
        name: trimmed,
        appState: {
          ...existing.appState,
          name: trimmed,
        },
      };
      await set(id, updated, store);
      return updated;
    });
  };

  const deleteRecentFile = async (id: string): Promise<boolean> => {
    deletedOrClearedEpochs.set(id, (deletedOrClearedEpochs.get(id) ?? 0) + 1);
    cancelPendingThumbnail(id);
    thumbnailState.delete(id);

    const result = await enqueueWrite(async () => {
      await del(id, store);
      return true;
    });
    return result === true;
  };

  const clearRecentFiles = async (): Promise<boolean> => {
    globalClearEpoch += 1;
    cancelPendingThumbnail();
    thumbnailState.clear();

    const result = await enqueueWrite(async () => {
      await clear(store);
      return true;
    });
    return result === true;
  };

  return {
    getCurrentSceneId,
    setCurrentSceneId,
    rotateCurrentSceneId,
    saveSnapshot,
    createNewSceneRecord,
    listRecentFiles,
    getRecentFile,
    touchRecentFile,
    renameRecentFile,
    deleteRecentFile,
    clearRecentFiles,
    cancelPendingThumbnails: cancelPendingThumbnail,
  };
};

export const RecentFiles = createRecentFilesManager();
