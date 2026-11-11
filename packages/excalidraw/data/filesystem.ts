import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from "browser-fs-access";

import { MIME_TYPES } from "@excalidraw/common";

import { normalizeFile } from "./blob";

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, "binary">;

export type NativeFileSaveHandler = (
  blob: Blob | Promise<Blob>,
  opts: {
    name: string;
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
  },
) => Promise<void>;

export type NativeFileOpenHandler = <
  M extends boolean | undefined = false,
>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}) => Promise<File | File[]>;

let nativeSaveHandler: NativeFileSaveHandler | null = null;
let nativeOpenHandler: NativeFileOpenHandler | null = null;

/**
 * Allows host shells (e.g. Capacitor on Android) to replace browser anchor
 * downloads and fs-access pickers with native filesystem/share APIs without
 * coupling `@excalidraw/excalidraw` to native runtime dependencies.
 */
export const registerNativeFileHandlers = (handlers: {
  save?: NativeFileSaveHandler | null;
  open?: NativeFileOpenHandler | null;
}) => {
  if ("save" in handlers) {
    nativeSaveHandler = handlers.save ?? null;
  }
  if ("open" in handlers) {
    nativeOpenHandler = handlers.open ?? null;
  }
};

export const fileOpen = async <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  if (nativeOpenHandler) {
    const nativeFiles = await nativeOpenHandler(opts);
    if (Array.isArray(nativeFiles)) {
      return (await Promise.all(
        nativeFiles.map((file) => normalizeFile(file)),
      )) as RetType;
    }
    return (await normalizeFile(nativeFiles)) as RetType;
  }

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === "jpg") {
      return acc.concat(".jpg", ".jpeg");
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  const files = await _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  });

  if (Array.isArray(files)) {
    return (await Promise.all(
      files.map((file) => normalizeFile(file)),
    )) as RetType;
  }
  return (await normalizeFile(files)) as RetType;
};

export const fileSave = async (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
    /** existing FileSystemFileHandle */
    fileHandle?: FileSystemFileHandle | null;
  },
) => {
  if (nativeSaveHandler) {
    await nativeSaveHandler(blob, {
      name: opts.name,
      extension: opts.extension,
      mimeTypes: opts.mimeTypes,
      description: opts.description,
    });
    return undefined;
  }

  return _fileSave(
    blob,
    {
      fileName: `${opts.name}.${opts.extension}`,
      description: opts.description,
      extensions: [`.${opts.extension}`],
      mimeTypes: opts.mimeTypes,
    },
    opts.fileHandle,
    false,
  );
};

export { nativeFileSystemSupported };
