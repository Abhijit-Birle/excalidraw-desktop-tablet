import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  KEYS,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { getShortcutKey } from "@excalidraw/excalidraw/shortcut";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  usersIcon,
  share,
  youtubeIcon,
  historyIcon,
  PlusIcon,
} from "@excalidraw/excalidraw/components/icons";
import {
  getNonDeletedElements,
  isElementLink,
  isInitializedImageElement,
  newElementWith,
} from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
  userToFollowAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { RecentFilesDialog } from "./components/RecentFilesDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { getUniqueUntitledDateName, RecentFiles } from "./data/recentFiles";

import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { AppSidebar } from "./components/AppSidebar";
import {
  getCapacitorFormFactor,
  initCapacitorBridge,
  isCapacitorNative,
} from "./capacitor/nativeBridge";
import { registerCapacitorFileHandlers } from "./data/capacitorFiles";

import type { RecentFileRecord } from "./data/recentFiles";
import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const snapshotRestoredLocalSceneAndRotate = async (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
) => {
  const nonDeleted = getNonDeletedElements(elements);
  if (nonDeleted.length > 0) {
    const fileIds = nonDeleted.reduce((acc, el) => {
      if (isInitializedImageElement(el) && el.fileId) {
        acc.push(el.fileId);
      }
      return acc;
    }, [] as FileId[]);
    const files: BinaryFiles = {};
    if (fileIds.length > 0) {
      try {
        const { loadedFiles } = await LocalData.fileStorage.getFiles(fileIds);
        loadedFiles.forEach((file) => {
          files[file.id] = file;
        });
      } catch (error) {
        console.warn("Recent files: failed loading files for snapshot", error);
      }
    }
    await RecentFiles.saveSnapshot({
      sceneId: RecentFiles.getCurrentSceneId(),
      elements: nonDeleted,
      appState,
      files,
    });
  }
  RecentFiles.rotateCurrentSceneId();
};

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        if (!roomLinkData) {
          await snapshotRestoredLocalSceneAndRotate(
            scene.elements,
            scene.appState as AppState,
          );
        }
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        await snapshotRestoredLocalSceneAndRotate(
          scene.elements,
          scene.appState as AppState,
        );
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const appContainerRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [isRecentFilesOpen, setIsRecentFilesOpen] = useState(false);
  const isRecentFilesOpenRef = useRef(isRecentFilesOpen);
  isRecentFilesOpenRef.current = isRecentFilesOpen;
  const isNativeCapacitor = isCapacitorNative();
  const pendingClearCanvasConfirmRef = useRef(false);
  const isSceneUntouchedRef = useRef(true);
  const isTransitioningSceneRef = useRef(false);
  type OutgoingSceneSnapshot = {
    sceneId: string;
    elements: readonly ExcalidrawElement[];
    elementIds: Set<string>;
    appState: AppState;
    files: BinaryFiles;
    nonDeletedCount: number;
  };
  const emptyBaselineRef = useRef<{
    elementsCount: number;
    name: string | null;
    viewBackgroundColor: AppState["viewBackgroundColor"];
    gridModeEnabled: AppState["gridModeEnabled"];
  } | null>(null);
  const newSceneRef = useRef<
    (options?: {
      outgoingScene?: OutgoingSceneSnapshot;
      fromReset?: boolean;
    }) => Promise<void> | void
  >(() => {});
  const lastSceneRef = useRef<OutgoingSceneSnapshot | null>(null);

  const getHostWindow = useCallback(
    () => appContainerRef.current?.ownerDocument?.defaultView ?? undefined,
    [],
  );

  const focusEditorCanvas = useCallback(() => {
    const container =
      editorContainerRef.current ??
      appContainerRef.current?.querySelector<HTMLElement>(
        ".excalidraw-container",
      );
    if (!container) {
      return;
    }
    const win =
      container.ownerDocument?.defaultView ??
      appContainerRef.current?.ownerDocument?.defaultView;
    container.focus({ preventScroll: true });
    win?.requestAnimationFrame(() => {
      container.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const unsubscribe = excalidrawAPI.onEvent(
      "editor:mount",
      ({ container }) => {
        editorContainerRef.current = container;
      },
    );
    return () => {
      unsubscribe();
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [shareDialogState, setShareDialogState] = useAtom(shareDialogStateAtom);
  const shareDialogStateRef = useRef(shareDialogState);
  shareDialogStateRef.current = shareDialogState;
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const isCollaboratingRef = useRef(isCollaborating);
  isCollaboratingRef.current =
    isCollaborating || Boolean(collabAPI?.isCollaborating());

  useEffect(() => {
    const unsubscribe = LocalData.onAfterSave((elements, appState, files) => {
      if (isCollaboratingRef.current) {
        return;
      }
      void RecentFiles.saveSnapshot({
        elements,
        appState,
        files,
        isCollaborating: isCollaboratingRef.current,
        hostWindow: getHostWindow(),
      });
    });

    return () => {
      unsubscribe();
      RecentFiles.cancelPendingThumbnails();
    };
  }, [getHostWindow]);

  useEffect(() => {
    if (!isNativeCapacitor) {
      return;
    }

    const unregisterFiles = registerCapacitorFileHandlers({
      getOwnerNode: () => appContainerRef.current,
      onSavedToDevice: ({ fileName }) => {
        excalidrawAPI?.setToast({
          message: t("recentFiles.savedToDocuments", { filename: fileName }),
          closable: true,
          duration: 3500,
        });
      },
    });

    const cleanupBridge = initCapacitorBridge({
      onFlushAndSnapshot: () => {
        LocalData.flushSave();
        if (excalidrawAPI && !isCollaboratingRef.current) {
          void RecentFiles.saveSnapshot({
            elements: excalidrawAPI.getSceneElements(),
            appState: excalidrawAPI.getAppState(),
            files: excalidrawAPI.getFiles(),
            isCollaborating: isCollaboratingRef.current,
            hostWindow: getHostWindow(),
          });
        }
      },
      onStoragePersistRefused: () => {
        excalidrawAPI?.setToast({
          message: t("recentFiles.storageNotPersisted"),
          closable: true,
          duration: 5000,
        });
      },
      onHandleBackButton: () => {
        if (isRecentFilesOpenRef.current) {
          setIsRecentFilesOpen(false);
          return true;
        }
        if (shareDialogStateRef.current.isOpen) {
          setShareDialogState({ isOpen: false });
          return true;
        }

        const appState = excalidrawAPI?.getAppState();
        const doc = appContainerRef.current?.ownerDocument;
        const win = doc?.defaultView;
        const hasOpenOverlay = Boolean(
          appState?.openDialog ||
            appState?.openMenu ||
            appState?.openPopup ||
            appState?.openSidebar ||
            appState?.contextMenu ||
            doc?.querySelector(".Modal, .Dialog, .popover, .dropdown-menu"),
        );
        if (hasOpenOverlay && doc && win) {
          const dispatchTarget = doc.activeElement ?? doc;
          dispatchTarget.dispatchEvent(
            new win.KeyboardEvent(EVENT.KEYDOWN, {
              key: KEYS.ESCAPE,
              bubbles: true,
              cancelable: true,
            }),
          );
          return true;
        }
        return false;
      },
    });

    return () => {
      cleanupBridge();
      unregisterFiles();
    };
  }, [excalidrawAPI, getHostWindow, isNativeCapacitor, setShareDialogState]);

  useEffect(() => {
    const doc = appContainerRef.current?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
      return;
    }

    let resetConfirmTimer: number | null = null;
    const markClearConfirmPending = () => {
      if (doc.querySelector(".confirm-dialog")) {
        pendingClearCanvasConfirmRef.current = true;
        if (resetConfirmTimer !== null) {
          win.clearTimeout(resetConfirmTimer);
        }
        resetConfirmTimer = win.setTimeout(() => {
          pendingClearCanvasConfirmRef.current = false;
          resetConfirmTimer = null;
        }, 0);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event[KEYS.CTRL_OR_CMD] &&
        event.altKey &&
        !event.shiftKey &&
        (event.code === "KeyN" || event.key.toLowerCase() === KEYS.N)
      ) {
        event.preventDefault();
        event.stopPropagation();
        void newSceneRef.current();
        return;
      }
      if (
        event[KEYS.CTRL_OR_CMD] &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === KEYS.O
      ) {
        event.preventDefault();
        event.stopPropagation();
        setIsRecentFilesOpen((open) => !open);
        return;
      }
      markClearConfirmPending();
    };

    win.addEventListener(EVENT.KEYDOWN, handleKeyDown, true);
    win.addEventListener("click", markClearConfirmPending, true);

    return () => {
      win.removeEventListener(EVENT.KEYDOWN, handleKeyDown, true);
      win.removeEventListener("click", markClearConfirmPending, true);
      if (resetConfirmTimer !== null) {
        win.clearTimeout(resetConfirmTimer);
      }
    };
  }, []);
  const collabError = useAtomValue(collabErrorIndicatorAtom);
  const userToFollow = useAtomValue(userToFollowAtom);

  const viewportStatusFrame = useMemo(
    () =>
      userToFollow
        ? {
            border: "var(--color-primary-hover)",
            label: {
              label: (
                <>
                  Following{" "}
                  <span
                    style={{
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 100,
                    }}
                    title={userToFollow.username}
                  >
                    {userToFollow.username}
                  </span>
                </>
              ),
              onClose: () => collabAPI?.setUserToFollow(null),
            },
          }
        : null,
    [userToFollow, collabAPI],
  );

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(excalidrawAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
      if (!collabAPI?.isCollaborating()) {
        const initialElements = (data.scene?.elements ??
          []) as readonly ExcalidrawElement[];
        const nonDeleted = getNonDeletedElements(initialElements);
        const currentAppState = (data.scene?.appState ||
          excalidrawAPI.getAppState()) as AppState;
        if (nonDeleted.length > 0) {
          isSceneUntouchedRef.current = false;
          emptyBaselineRef.current = null;
          lastSceneRef.current = {
            sceneId: RecentFiles.getCurrentSceneId(),
            elements: nonDeleted,
            elementIds: new Set(nonDeleted.map((el) => el.id)),
            appState: currentAppState,
            files: data.scene?.files || {},
            nonDeletedCount: nonDeleted.length,
          };
        } else {
          const defaults = getDefaultAppState();
          isSceneUntouchedRef.current = true;
          emptyBaselineRef.current = {
            elementsCount: initialElements.length,
            name: currentAppState.name ?? null,
            viewBackgroundColor:
              currentAppState.viewBackgroundColor ??
              defaults.viewBackgroundColor,
            gridModeEnabled:
              currentAppState.gridModeEnabled ?? defaults.gridModeEnabled,
          };
          lastSceneRef.current = null;
        }
      }
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        const isCollabUrl = isCollaborationLink(window.location.href);
        if (!collabAPI?.isCollaborating() && !isCollabUrl) {
          const outgoingElements = excalidrawAPI.getSceneElements();
          if (outgoingElements.length > 0) {
            await RecentFiles.saveSnapshot({
              sceneId: RecentFiles.getCurrentSceneId(),
              elements: outgoingElements,
              appState: excalidrawAPI.getAppState(),
              files: excalidrawAPI.getFiles(),
              hostWindow: getHostWindow(),
            });
            RecentFiles.rotateCurrentSceneId();
          }
        }
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            const restored = restoreElements(data.scene.elements, null, {
              repairBindings: true,
            });
            const restoredAppState = restoreAppState(data.scene.appState, null);
            if (!isCollabUrl) {
              const nonDeleted = getNonDeletedElements(restored);
              if (nonDeleted.length > 0) {
                isSceneUntouchedRef.current = false;
                emptyBaselineRef.current = null;
                lastSceneRef.current = {
                  sceneId: RecentFiles.getCurrentSceneId(),
                  elements: nonDeleted,
                  elementIds: new Set(nonDeleted.map((el) => el.id)),
                  appState: restoredAppState as AppState,
                  files: data.scene.files || {},
                  nonDeletedCount: nonDeleted.length,
                };
              } else {
                const defaults = getDefaultAppState();
                isSceneUntouchedRef.current = true;
                emptyBaselineRef.current = {
                  elementsCount: restored.length,
                  name: restoredAppState.name ?? null,
                  viewBackgroundColor:
                    restoredAppState.viewBackgroundColor ??
                    defaults.viewBackgroundColor,
                  gridModeEnabled:
                    restoredAppState.gridModeEnabled ??
                    defaults.gridModeEnabled,
                };
                lastSceneRef.current = null;
              }
            }
            excalidrawAPI.updateScene({
              elements: restored,
              appState: restoredAppState,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      const ownerDoc = appContainerRef.current?.ownerDocument ?? document;
      if (event.type === EVENT.BLUR || ownerDoc.hidden) {
        LocalData.flushSave();
        if (ownerDoc.hidden && excalidrawAPI && !isCollaboratingRef.current) {
          void RecentFiles.saveSnapshot({
            elements: excalidrawAPI.getSceneElements(),
            appState: excalidrawAPI.getAppState(),
            files: excalidrawAPI.getFiles(),
            isCollaborating: isCollaboratingRef.current,
            hostWindow: getHostWindow(),
          });
        }
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    loadImages,
    getHostWindow,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    const currentIsCollab = Boolean(collabAPI?.isCollaborating());
    isCollaboratingRef.current = currentIsCollab;

    if (currentIsCollab) {
      collabAPI?.syncElements(elements);
    } else {
      const nonDeletedElements = getNonDeletedElements(elements);
      const prevScene = lastSceneRef.current;

      if (nonDeletedElements.length > 0) {
        isSceneUntouchedRef.current = false;
        emptyBaselineRef.current = null;
      } else if (isSceneUntouchedRef.current) {
        const baseline = emptyBaselineRef.current;
        if (baseline) {
          const didModifyEmptyScene =
            elements.length !== baseline.elementsCount ||
            appState.name !== baseline.name ||
            appState.viewBackgroundColor !== baseline.viewBackgroundColor ||
            appState.gridModeEnabled !== baseline.gridModeEnabled;
          if (didModifyEmptyScene) {
            isSceneUntouchedRef.current = false;
            emptyBaselineRef.current = null;
          }
        } else if (elements.length > 0) {
          isSceneUntouchedRef.current = false;
        }
      }

      if (prevScene && prevScene.nonDeletedCount > 0) {
        if (nonDeletedElements.length === 0) {
          const defaultAppState = getDefaultAppState();
          const didResetAppState =
            appState.name === null &&
            appState.scrollX === defaultAppState.scrollX &&
            appState.scrollY === defaultAppState.scrollY &&
            appState.zoom.value === defaultAppState.zoom.value &&
            appState.viewBackgroundColor ===
              defaultAppState.viewBackgroundColor &&
            (prevScene.appState.name !== null ||
              prevScene.appState.scrollX !== defaultAppState.scrollX ||
              prevScene.appState.scrollY !== defaultAppState.scrollY ||
              prevScene.appState.zoom.value !== defaultAppState.zoom.value ||
              prevScene.appState.viewBackgroundColor !==
                defaultAppState.viewBackgroundColor ||
              prevScene.appState.fileHandle !== null);

          if (
            pendingClearCanvasConfirmRef.current ||
            didResetAppState ||
            elements.length === 0
          ) {
            pendingClearCanvasConfirmRef.current = false;
            lastSceneRef.current = {
              sceneId: prevScene.sceneId,
              elements,
              elementIds: new Set(),
              appState,
              files,
              nonDeletedCount: 0,
            };
            void newSceneRef.current({
              outgoingScene: prevScene,
              fromReset: true,
            });
          } else {
            lastSceneRef.current = {
              sceneId: prevScene.sceneId,
              elements,
              elementIds: new Set(),
              appState,
              files,
              nonDeletedCount: 0,
            };
          }
        } else {
          const hasAnyPreviousElement = elements.some((el) =>
            prevScene.elementIds.has(el.id),
          );
          if (!hasAnyPreviousElement) {
            void RecentFiles.saveSnapshot({
              sceneId: prevScene.sceneId,
              elements: prevScene.elements,
              appState: prevScene.appState,
              files: prevScene.files,
              hostWindow: getHostWindow(),
            });
            const nextSceneId = RecentFiles.rotateCurrentSceneId();
            lastSceneRef.current = {
              sceneId: nextSceneId,
              elements,
              elementIds: new Set(nonDeletedElements.map((el) => el.id)),
              appState,
              files,
              nonDeletedCount: nonDeletedElements.length,
            };
          } else {
            lastSceneRef.current = {
              sceneId: RecentFiles.getCurrentSceneId(),
              elements,
              elementIds: new Set(nonDeletedElements.map((el) => el.id)),
              appState,
              files,
              nonDeletedCount: nonDeletedElements.length,
            };
          }
        }
      } else if (nonDeletedElements.length > 0) {
        lastSceneRef.current = {
          sceneId: RecentFiles.getCurrentSceneId(),
          elements,
          elementIds: new Set(nonDeletedElements.map((el) => el.id)),
          appState,
          files,
          nonDeletedCount: nonDeletedElements.length,
        };
      }
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const isCollabAvailable =
    !isCollabDisabled && (!isOffline || isCollaborating);

  useEffect(() => {
    if (!isCollabAvailable) {
      setShareDialogState({ isOpen: false });
    }
  }, [isCollabAvailable, setShareDialogState]);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  const applySceneToEditor = useCallback(
    async (options: {
      sceneId: string;
      elements: readonly ExcalidrawElement[];
      appState: Partial<AppState>;
      files?: BinaryFiles;
      untouched?: boolean;
      closeRecentFiles?: boolean;
      focusCanvas?: boolean;
    }) => {
      if (!excalidrawAPI) {
        return;
      }

      const restoredElements = restoreElements(options.elements, null, {
        repairBindings: true,
        deleteInvisibleElements: true,
      });
      const restoredAppState = {
        ...restoreAppState(options.appState, excalidrawAPI.getAppState()),
        selectedElementIds: {},
        selectedGroupIds: {},
        editingGroupId: null,
        fileHandle: null,
        openMenu: null,
        openDialog: null,
      } as AppState;

      const restoredFiles = Object.values(options.files || {});
      if (restoredFiles.length > 0) {
        excalidrawAPI.addFiles(restoredFiles);
      }

      RecentFiles.setCurrentSceneId(options.sceneId);

      const nonDeleted = getNonDeletedElements(restoredElements);
      lastSceneRef.current = {
        sceneId: options.sceneId,
        elements: restoredElements,
        elementIds: new Set(nonDeleted.map((el) => el.id)),
        appState: restoredAppState,
        files: options.files || {},
        nonDeletedCount: nonDeleted.length,
      };

      const isUntouched = Boolean(options.untouched && nonDeleted.length === 0);
      isSceneUntouchedRef.current = isUntouched;
      emptyBaselineRef.current = isUntouched
        ? {
            elementsCount: restoredElements.length,
            name: restoredAppState.name ?? null,
            viewBackgroundColor: restoredAppState.viewBackgroundColor,
            gridModeEnabled: restoredAppState.gridModeEnabled,
          }
        : null;

      excalidrawAPI.updateScene({
        elements: restoredElements,
        appState: restoredAppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      excalidrawAPI.history.clear();
      LocalData.save(
        restoredElements,
        restoredAppState,
        excalidrawAPI.getFiles(),
        () => {},
      );
      LocalData.flushSave();

      if (options.closeRecentFiles) {
        setIsRecentFilesOpen(false);
      }
      if (options.focusCanvas) {
        focusEditorCanvas();
      }
    },
    [excalidrawAPI, focusEditorCanvas],
  );

  const newScene = useCallback(
    async (options?: {
      outgoingScene?: OutgoingSceneSnapshot;
      fromReset?: boolean;
    }) => {
      if (!excalidrawAPI || isTransitioningSceneRef.current) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (!options?.fromReset) {
          excalidrawAPI.setToast({
            message: t("recentFiles.newCollabBlocked"),
            closable: true,
            duration: 4000,
          });
        }
        return;
      }

      isTransitioningSceneRef.current = true;
      try {
        const hostWindow = getHostWindow();
        const defaults = getDefaultAppState();
        const currentEditorAppState = excalidrawAPI.getAppState();
        const outgoingElements =
          options?.outgoingScene?.elements ?? excalidrawAPI.getSceneElements();
        const outgoingAppState =
          options?.outgoingScene?.appState ?? currentEditorAppState;
        const outgoingFiles =
          options?.outgoingScene?.files ?? excalidrawAPI.getFiles();
        const outgoingSceneId =
          options?.outgoingScene?.sceneId ?? RecentFiles.getCurrentSceneId();
        const nonDeletedOutgoing = getNonDeletedElements(outgoingElements);

        const savedOutgoing =
          nonDeletedOutgoing.length > 0
            ? await RecentFiles.saveSnapshot({
                sceneId: outgoingSceneId,
                elements: outgoingElements,
                appState: outgoingAppState,
                files: outgoingFiles,
                hostWindow,
              })
            : null;

        if (
          !options?.fromReset &&
          nonDeletedOutgoing.length === 0 &&
          isSceneUntouchedRef.current
        ) {
          await applySceneToEditor({
            sceneId: outgoingSceneId,
            elements: [],
            appState: {
              ...defaults,
              name: currentEditorAppState.name,
              theme: currentEditorAppState.theme,
            },
            files: {},
            untouched: true,
            closeRecentFiles: true,
            focusCanvas: true,
          });
          return;
        }

        const createdRecord = await RecentFiles.createNewSceneRecord({
          appState: {
            viewBackgroundColor: defaults.viewBackgroundColor,
            gridSize: defaults.gridSize,
            gridStep: defaults.gridStep,
            gridModeEnabled: defaults.gridModeEnabled,
            scrollX: defaults.scrollX,
            scrollY: defaults.scrollY,
            zoom: defaults.zoom,
          },
          isCollaborating: isCollaboratingRef.current,
          minUpdatedAt: savedOutgoing ? savedOutgoing.updatedAt + 1 : 0,
          extraExistingNames: savedOutgoing ? [savedOutgoing.name] : [],
        });

        const nextSceneId =
          createdRecord?.id ?? RecentFiles.getCurrentSceneId();
        const nextName =
          createdRecord?.name ??
          getUniqueUntitledDateName(
            savedOutgoing ? [savedOutgoing.name] : [],
            Date.now(),
          );

        await applySceneToEditor({
          sceneId: nextSceneId,
          elements: [],
          appState: {
            ...defaults,
            ...(createdRecord?.appState ?? {}),
            name: nextName,
            theme: currentEditorAppState.theme,
          },
          files: {},
          untouched: true,
          closeRecentFiles: true,
          focusCanvas: true,
        });
      } finally {
        isTransitioningSceneRef.current = false;
      }
    },
    [excalidrawAPI, collabAPI, getHostWindow, applySceneToEditor],
  );
  newSceneRef.current = newScene;

  const handleOpenRecentFile = useCallback(
    async (record: RecentFileRecord) => {
      if (!excalidrawAPI || isTransitioningSceneRef.current) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        excalidrawAPI.setToast({
          message: t("recentFiles.collabBlocked"),
          closable: true,
          duration: 4000,
        });
        return;
      }

      isTransitioningSceneRef.current = true;
      try {
        const hostWindow = getHostWindow();
        const outgoingElements = excalidrawAPI.getSceneElements();
        if (outgoingElements.length > 0) {
          await RecentFiles.saveSnapshot({
            sceneId: RecentFiles.getCurrentSceneId(),
            elements: outgoingElements,
            appState: excalidrawAPI.getAppState(),
            files: excalidrawAPI.getFiles(),
            hostWindow,
          });
        }

        await RecentFiles.touchRecentFile(record.id);
        await applySceneToEditor({
          sceneId: record.id,
          elements: record.elements,
          appState: record.appState,
          files: record.files,
          untouched: false,
          closeRecentFiles: true,
          focusCanvas: true,
        });
      } finally {
        isTransitioningSceneRef.current = false;
      }
    },
    [excalidrawAPI, collabAPI, getHostWindow, applySceneToEditor],
  );

  const handleRenameRecentFile = useCallback(
    async (id: string, nextName: string): Promise<RecentFileRecord | null> => {
      const updated = await RecentFiles.renameRecentFile(id, nextName);
      if (!updated) {
        return null;
      }

      if (id === RecentFiles.getCurrentSceneId() && excalidrawAPI) {
        const currentAppState = excalidrawAPI.getAppState();
        const syncedAppState = {
          ...currentAppState,
          name: updated.name,
        };
        if (lastSceneRef.current && lastSceneRef.current.sceneId === id) {
          lastSceneRef.current = {
            ...lastSceneRef.current,
            appState: syncedAppState,
          };
        }
        if (emptyBaselineRef.current) {
          emptyBaselineRef.current = {
            ...emptyBaselineRef.current,
            name: updated.name,
          };
        }
        excalidrawAPI.updateScene({
          appState: { name: updated.name },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        LocalData.save(
          excalidrawAPI.getSceneElements(),
          syncedAppState,
          excalidrawAPI.getFiles(),
          () => {},
        );
        LocalData.flushSave();
      }

      return updated;
    },
    [excalidrawAPI],
  );

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }


  return (
    <div
      ref={appContainerRef}
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        viewportStatusFrame={viewportStatusFrame}
        userToFollow={userToFollow}
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          getFormFactor: isNativeCapacitor ? getCapacitorFormFactor : undefined,
          canvasActions: {
            toggleTheme: true,
            export: isNativeCapacitor
              ? undefined
              : {
                  onExportToBackend,
                },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              <button
                type="button"
                className="excalidraw-recent-topbar-btn"
                onClick={() => setIsRecentFilesOpen(true)}
                title={`${t("recentFiles.menuItem")} (${getShortcutKey(
                  "CtrlOrCmd+Shift+O",
                )})`}
                aria-label={t("recentFiles.menuItem")}
              >
                {historyIcon}
                <span>{t("recentFiles.menuItem")}</span>
              </button>


              {collabAPI && isCollabAvailable && (
                <>
                  {collabError.message && (
                    <CollabError collabError={collabError} />
                  )}
                  <LiveCollaborationTrigger
                    isCollaborating={isCollaborating}
                    onSelect={() =>
                      setShareDialogState({ isOpen: true, type: "share" })
                    }
                    editorInterface={editorInterface}
                  />
                </>
              )}
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          onNewDiagram={() => void newScene()}
          onRecentFilesDialogOpen={() => setIsRecentFilesOpen(true)}
          isCollaborating={isCollaborating}
          isCollabEnabled={isCollabAvailable}
          theme={appTheme}
          refresh={() => forceRefresh((prev) => !prev)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={isCollabAvailable}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />

        <RecentFilesDialog
          isOpen={isRecentFilesOpen}
          isCollaborating={isCollaborating}
          onClose={() => setIsRecentFilesOpen(false)}
          onNewDiagram={newScene}
          onOpenRecord={handleOpenRecentFile}
          onRenameRecord={handleRenameRecentFile}
        />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("recentFiles.newDiagram"),
              category: DEFAULT_CATEGORIES.app,
              shortcut: getShortcutKey("CtrlOrCmd+Alt+N"),
              icon: PlusIcon,
              keywords: ["new", "diagram", "blank", "empty", "create"],
              perform: () => {
                void newScene();
              },
            },
            {
              label: t("recentFiles.menuItem"),
              category: DEFAULT_CATEGORIES.app,
              shortcut: getShortcutKey("CtrlOrCmd+Shift+O"),
              icon: historyIcon,
              keywords: ["recent", "files", "history", "open", "diagrams"],
              perform: () => {
                setIsRecentFilesOpen(true);
              },
            },
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
