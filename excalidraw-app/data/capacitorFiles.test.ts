import { Directory } from "@capacitor/filesystem";
import { describe, expect, it, vi } from "vitest";

import { fileSave } from "@excalidraw/excalidraw/data/filesystem";

import {
  buildAcceptAttribute,
  createCapacitorClipboardImageHandler,
  createCapacitorSaveHandler,
  registerCapacitorFileHandlers,
  sanitizeFileBaseName,
} from "./capacitorFiles";

describe("capacitorFiles", () => {
  it("sanitizes filenames and builds SAF-compatible accept filters", () => {
    expect(sanitizeFileBaseName('My / Sketch: "Test"?')).toBe(
      "My _ Sketch_ _Test__",
    );
    expect(sanitizeFileBaseName("   ")).toBe("Untitled");
    expect(buildAcceptAttribute(["excalidraw", "json"])).toBe("*/*");
    expect(buildAcceptAttribute(["png", "jpg"])).toContain("image/jpeg");
    expect(buildAcceptAttribute(["png", "jpg"])).not.toBe("*/*");
  });

  it("writes exports to Documents/Excalidraw and launches share sheet via Cache URI", async () => {
    const writeFile = vi
      .fn()
      .mockImplementation(async ({ directory, path }) => ({
        uri: `file:///android/${directory}/${path}`,
      }));
    const share = vi.fn().mockResolvedValue({ activityType: "share" });
    const onSavedToDevice = vi.fn();

    const saveHandler = createCapacitorSaveHandler({
      filesystem: { writeFile },
      share: { share },
      onSavedToDevice,
    });

    const payload = new Blob(['{"type":"excalidraw"}'], {
      type: "application/json",
    });
    await saveHandler(payload, {
      name: "architecture/diagram",
      extension: "excalidraw",
      description: "Save Excalidraw file",
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "Excalidraw/architecture_diagram.excalidraw",
        directory: Directory.Documents,
        recursive: true,
      }),
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "share/architecture_diagram.excalidraw",
        directory: Directory.Cache,
        recursive: true,
      }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "architecture_diagram.excalidraw",
        files: ["file:///android/CACHE/share/architecture_diagram.excalidraw"],
      }),
    );
    expect(onSavedToDevice).toHaveBeenCalledWith({
      fileName: "architecture_diagram.excalidraw",
      relativePath: "Documents/Excalidraw/architecture_diagram.excalidraw",
    });
  });

  it("keeps Documents export intact if the user dismisses the share dialog", async () => {
    const writeFile = vi.fn().mockResolvedValue({
      uri: "file:///android/CACHE/share/sketch.png",
    });
    const share = vi.fn().mockRejectedValue(new Error("Share canceled"));

    const unregister = registerCapacitorFileHandlers({
      filesystem: { writeFile },
      share: { share },
    });

    try {
      await expect(
        fileSave(new Blob(["png-bytes"], { type: "image/png" }), {
          name: "sketch",
          extension: "png",
          description: "Export PNG",
        }),
      ).resolves.toBeUndefined();
    } finally {
      unregister();
    }
  });

  it("provides clipboard image fallback using share sheet", async () => {
    const writeFile = vi.fn().mockResolvedValue({
      uri: "file:///android/CACHE/share/excalidraw-clipboard.png",
    });
    const share = vi.fn().mockResolvedValue({ activityType: "ok" });

    const handler = createCapacitorClipboardImageHandler({
      filesystem: { writeFile },
      share: { share },
    });

    await handler(new Blob(["img"], { type: "image/png" }));

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "share/excalidraw-clipboard.png",
        directory: Directory.Cache,
      }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ["file:///android/CACHE/share/excalidraw-clipboard.png"],
      }),
    );
  });
});
