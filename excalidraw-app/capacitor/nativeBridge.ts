import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar } from "@capacitor/status-bar";

import {
  getFormFactor as getDefaultFormFactor,
  loadDesktopUIModePreference,
  setDesktopUIMode,
} from "@excalidraw/common";

import type { PluginListenerHandle } from "@capacitor/core";

export const isCapacitorNative = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.Capacitor?.isNativePlatform?.() ?? window.Capacitor);
};

/**
 * Pins tablet viewports (>= 600 CSS px, covering Galaxy Tab S9 FE portrait and
 * landscape across DPI settings) to desktop UI mode so rotation does not flip
 * across Excalidraw's 1180px tablet threshold. Narrow split-screen panes
 * keep the compact layout.
 */
export const getCapacitorFormFactor = (
  editorWidth: number,
  editorHeight: number,
) => {
  if (editorWidth >= 600) {
    return "desktop" as const;
  }
  return getDefaultFormFactor(editorWidth, editorHeight);
};

export type CapacitorBridgeOptions = {
  isEnabled?: boolean;
  onFlushAndSnapshot: () => void | Promise<void>;
  onStoragePersistRefused?: () => void;
  onHandleBackButton: () => boolean;
};

export const initCapacitorBridge = (options: CapacitorBridgeOptions) => {
  const enabled = options.isEnabled ?? isCapacitorNative();
  if (!enabled) {
    return () => {};
  }

  // Ensure initial launch on tablet opens the full docked desktop layout
  // (respects subsequent explicit user overrides).
  if (!loadDesktopUIModePreference()) {
    setDesktopUIMode("full");
  }

  // Enter immersive fullscreen so stylus strokes reach near display edges;
  // SystemBars inset variables (--safe-area-inset-*) protect UI chrome.
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  void StatusBar.hide().catch(() => {});

  // Request persistent WebView origin storage to protect IndexedDB diagrams.
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage
      .persist()
      .then((persisted) => {
        if (!persisted) {
          console.warn(
            "Storage persistence was refused; device low-storage cleanup may clear WebView data.",
          );
          options.onStoragePersistRefused?.();
        }
      })
      .catch((error) => {
        console.warn("navigator.storage.persist() failed:", error);
        options.onStoragePersistRefused?.();
      });
  } else {
    console.warn("navigator.storage.persist() is unavailable in this runtime.");
    options.onStoragePersistRefused?.();
  }

  let disposed = false;
  const handles: PluginListenerHandle[] = [];

  const registerHandle = (promise: Promise<PluginListenerHandle>) => {
    void promise
      .then((handle) => {
        if (disposed) {
          void handle.remove().catch(() => {});
        } else {
          handles.push(handle);
        }
      })
      .catch(() => {});
  };

  registerHandle(
    CapacitorApp.addListener("pause", () => {
      void options.onFlushAndSnapshot();
    }),
  );

  registerHandle(
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        void options.onFlushAndSnapshot();
      }
    }),
  );

  registerHandle(
    CapacitorApp.addListener("backButton", () => {
      const handled = options.onHandleBackButton();
      if (!handled) {
        void CapacitorApp.minimizeApp().catch(() => {});
      }
    }),
  );

  return () => {
    disposed = true;
    while (handles.length > 0) {
      const handle = handles.pop();
      void handle?.remove().catch(() => {});
    }
  };
};
