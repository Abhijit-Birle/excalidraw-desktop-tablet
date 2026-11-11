import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import { MIME_TYPES } from "@excalidraw/common";
import { registerNativeClipboardImageHandler } from "@excalidraw/excalidraw/clipboard";
import {
  registerNativeFileHandlers,
  type NativeFileOpenHandler,
  type NativeFileSaveHandler,
} from "@excalidraw/excalidraw/data/filesystem";

const EXPORT_DIR = "Excalidraw";
const SHARE_CACHE_DIR = "share";

export const sanitizeFileBaseName = (name: string): string => {
  const withoutControlChars = Array.from(name, (ch) =>
    ch.charCodeAt(0) <= 0x1f ? "_" : ch,
  ).join("");
  const cleaned = withoutControlChars.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "Untitled";
};

export const buildAcceptAttribute = (extensions?: string[]): string => {
  if (!extensions || extensions.length === 0) {
    return "";
  }

  // Android's Storage Access Framework grays out `.excalidraw` and
  // `.excalidrawlib` if restricted strictly by extension because Android lacks
  // a built-in MIME mapping for them. Allow all files whenever project/library
  // extensions are requested; filter image pickers strictly.
  const hasCustomDiagramExtension = extensions.some(
    (ext) =>
      ext === "excalidraw" ||
      ext === "excalidrawlib" ||
      ext === "excalidraw.png" ||
      ext === "excalidraw.svg" ||
      ext === "json",
  );
  if (hasCustomDiagramExtension) {
    return "*/*";
  }

  const tokens = new Set<string>();
  for (const ext of extensions) {
    if (ext === "jpg") {
      tokens.add(".jpg");
      tokens.add(".jpeg");
      tokens.add("image/jpeg");
    } else {
      tokens.add(`.${ext}`);
      const mime = MIME_TYPES[ext as keyof typeof MIME_TYPES];
      if (mime) {
        tokens.add(mime);
      }
    }
  }
  return Array.from(tokens).join(",");
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("Failed to encode blob as base64."));
      };
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const isShareCanceledError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  const name = error instanceof Error ? error.name : "";
  return (
    name === "AbortError" ||
    message.includes("cancel") ||
    message.includes("dismiss")
  );
};

export type CapacitorFileDeps = {
  filesystem?: Pick<typeof Filesystem, "writeFile">;
  share?: Pick<typeof Share, "share">;
  getOwnerNode?: () => HTMLElement | null;
  onSavedToDevice?: (info: { fileName: string; relativePath: string }) => void;
};

export const createCapacitorSaveHandler = (
  deps: CapacitorFileDeps = {},
): NativeFileSaveHandler => {
  const fs = deps.filesystem ?? Filesystem;
  const shareApi = deps.share ?? Share;

  return async (blobOrPromise, opts) => {
    const resolvedBlob = await blobOrPromise;
    const base64Data = await blobToBase64(resolvedBlob);
    const fileName = `${sanitizeFileBaseName(opts.name)}.${opts.extension}`;
    const relativePath = `${EXPORT_DIR}/${fileName}`;

    await fs.writeFile({
      path: relativePath,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    });

    deps.onSavedToDevice?.({
      fileName,
      relativePath: `Documents/${relativePath}`,
    });

    // Write a temporary shareable copy in Cache (always exposed by Android
    // FileProvider) and launch the system Share sheet. User dismissal is normal.
    try {
      const cacheWrite = await fs.writeFile({
        path: `${SHARE_CACHE_DIR}/${fileName}`,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      await shareApi.share({
        title: fileName,
        files: [cacheWrite.uri],
        dialogTitle: opts.description || fileName,
      });
    } catch (error) {
      if (!isShareCanceledError(error)) {
        console.warn(
          "Share sheet unavailable after saving to Documents:",
          error,
        );
      }
    }
  };
};

export const createCapacitorOpenHandler = (
  deps: CapacitorFileDeps = {},
): NativeFileOpenHandler => {
  return <M extends boolean | undefined = false>(opts: {
    extensions?: Array<Exclude<keyof typeof MIME_TYPES, "binary">>;
    description: string;
    multiple?: M;
  }) => {
    const ownerNode = deps.getOwnerNode?.();
    const doc = ownerNode?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;

    return new Promise<File | File[]>((resolve, reject) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.multiple = Boolean(opts.multiple);
      const accept = buildAcceptAttribute(opts.extensions);
      if (accept) {
        input.accept = accept;
      }
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.opacity = "0";

      let settled = false;
      let focusTimer = 0;

      const cleanup = () => {
        if (focusTimer) {
          win.clearTimeout(focusTimer);
          focusTimer = 0;
        }
        input.removeEventListener("change", handleChange);
        input.removeEventListener("cancel", handleCancel);
        win.removeEventListener("focus", handleWindowFocus);
        input.remove();
      };

      const abort = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new DOMException("The user aborted a request.", "AbortError"));
      };

      const handleChange = () => {
        if (settled) {
          return;
        }
        const selected = input.files ? Array.from(input.files) : [];
        if (selected.length === 0) {
          abort();
          return;
        }
        settled = true;
        cleanup();
        resolve(opts.multiple ? selected : selected[0]);
      };

      const handleCancel = () => {
        abort();
      };

      const handleWindowFocus = () => {
        // Older Android WebViews do not always fire `cancel` on file input
        // dismissal; check briefly after focus returns if any files arrived.
        focusTimer = win.setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) {
            abort();
          }
        }, 450);
      };

      input.addEventListener("change", handleChange);
      input.addEventListener("cancel", handleCancel);
      win.addEventListener("focus", handleWindowFocus, { once: true });

      (doc.body ?? doc.documentElement).appendChild(input);
      input.click();
    });
  };
};

export const createCapacitorClipboardImageHandler = (
  deps: CapacitorFileDeps = {},
) => {
  const fs = deps.filesystem ?? Filesystem;
  const shareApi = deps.share ?? Share;

  return async (blob: Blob) => {
    const base64Data = await blobToBase64(blob);
    const cacheWrite = await fs.writeFile({
      path: `${SHARE_CACHE_DIR}/excalidraw-clipboard.png`,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    await shareApi.share({
      title: "Excalidraw image",
      files: [cacheWrite.uri],
      dialogTitle: "Share image",
    });
  };
};

export const registerCapacitorFileHandlers = (deps: CapacitorFileDeps = {}) => {
  registerNativeFileHandlers({
    save: createCapacitorSaveHandler(deps),
    open: createCapacitorOpenHandler(deps),
  });
  registerNativeClipboardImageHandler(
    createCapacitorClipboardImageHandler(deps),
  );

  return () => {
    registerNativeFileHandlers({ save: null, open: null });
    registerNativeClipboardImageHandler(null);
  };
};
