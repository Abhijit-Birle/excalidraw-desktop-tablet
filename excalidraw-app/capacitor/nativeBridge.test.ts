import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar } from "@capacitor/status-bar";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDesktopUIModePreference } from "@excalidraw/common";

import { getCapacitorFormFactor, initCapacitorBridge } from "./nativeBridge";

vi.mock("@capacitor/app", () => {
  const listeners = new Map<string, Array<(payload?: any) => void>>();
  return {
    App: {
      addListener: vi.fn(
        async (eventName: string, cb: (payload?: any) => void) => {
          const list = listeners.get(eventName) ?? [];
          list.push(cb);
          listeners.set(eventName, list);
          return {
            remove: vi.fn(async () => {
              const next = (listeners.get(eventName) ?? []).filter(
                (fn) => fn !== cb,
              );
              listeners.set(eventName, next);
            }),
          };
        },
      ),
      minimizeApp: vi.fn(async () => {}),
      __emit: (eventName: string, payload?: any) => {
        for (const cb of listeners.get(eventName) ?? []) {
          cb(payload);
        }
      },
      __clearListeners: () => {
        listeners.clear();
      },
    },
  };
});

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setOverlaysWebView: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
  },
}));

const CapacitorAppMock = CapacitorApp as typeof CapacitorApp & {
  __emit: (eventName: string, payload?: any) => void;
  __clearListeners: () => void;
};

describe("Capacitor nativeBridge", () => {
  beforeEach(() => {
    localStorage.clear();
    CapacitorAppMock.__clearListeners();
    vi.clearAllMocks();
  });

  it("pins tablet viewports (>= 600px) across portrait & landscape to desktop mode", () => {
    // Tab S9 FE portrait (~720-800px) & landscape (~1024-1316px)
    expect(getCapacitorFormFactor(720, 1152)).toBe("desktop");
    expect(getCapacitorFormFactor(1024, 640)).toBe("desktop");
    expect(getCapacitorFormFactor(1152, 720)).toBe("desktop");
    expect(getCapacitorFormFactor(1316, 823)).toBe("desktop");

    // Narrow split-screen phone layout falls back cleanly
    expect(getCapacitorFormFactor(480, 800)).toBe("phone");
  });

  it("seeds full desktop UI mode, requests persistent storage, flushes on background, and handles back button", async () => {
    const persistMock = vi.fn(async () => false);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist: persistMock },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFlushAndSnapshot = vi.fn();
    const onStoragePersistRefused = vi.fn();
    const onHandleBackButton = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const cleanup = initCapacitorBridge({
      isEnabled: true,
      onFlushAndSnapshot,
      onStoragePersistRefused,
      onHandleBackButton,
    });

    await vi.waitFor(() => {
      expect(persistMock).toHaveBeenCalledTimes(1);
      expect(onStoragePersistRefused).toHaveBeenCalledTimes(1);
    });

    expect(loadDesktopUIModePreference()).toBe("full");
    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledWith({
      overlay: true,
    });
    expect(StatusBar.hide).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    CapacitorAppMock.__emit("pause");
    CapacitorAppMock.__emit("appStateChange", { isActive: false });
    CapacitorAppMock.__emit("appStateChange", { isActive: true });
    expect(onFlushAndSnapshot).toHaveBeenCalledTimes(2);

    // First back press closes open UI; second back press minimizes app
    CapacitorAppMock.__emit("backButton", { canGoBack: false });
    expect(CapacitorApp.minimizeApp).not.toHaveBeenCalled();

    CapacitorAppMock.__emit("backButton", { canGoBack: false });
    expect(CapacitorApp.minimizeApp).toHaveBeenCalledTimes(1);

    cleanup();
    warnSpy.mockRestore();
  });
});
