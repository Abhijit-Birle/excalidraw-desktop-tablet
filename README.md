# excalidraw-desktop-tablet

> Unofficial personal, offline-first fork of [Excalidraw](https://github.com/excalidraw/excalidraw) packaged for **macOS** (`Excalidraw.app`) and **Android tablets / S Pen** (`Excalidraw Pen`), with built-in **Recent Files** and **New Diagram** workflows.

---

## New Features & Enhancements in This Fork

### 1. Recent Files & Local Snapshots

- **Isolated IndexedDB history** (`excalidraw-recent-files-db` in [`excalidraw-app/data/recentFiles.ts`](./excalidraw-app/data/recentFiles.ts)) storing up to **50** recent diagrams with `~200px` PNG thumbnails, relative last-edited timestamps, and copied image binaries.
- **Quick access**: open from the main menu, the always-visible top-right **Recent files** toolbar button, or **`Ctrl/Cmd + Shift + O`**.
- **Manage diagrams easily**: inline click-to-rename, open any snapshot with automatic save-before-switch, swipe-left or button delete, two-step **Clear all** confirmation, friendly empty state, and automatic snapshot on scene save, canvas reset, and app backgrounding.
- **Safe during collaboration**: blocks switching scenes mid-collaboration session.

### 2. Quick New Diagram (`+ New`)

- Start a fresh diagram from **`+ New`** inside Recent files, **New diagram** in the main menu, or **`Ctrl/Cmd + Alt + N`**.
- Snapshots your current work first, avoids inserting duplicate entries when starting from an untouched blank canvas, assigns a dated title (`Untitled-YYYY-MM-DD`, deduplicated with `-2`, `-3`, ...), and focuses the canvas immediately without a page reload.

### 3. Native macOS Desktop App (`Excalidraw.app`)

- Native Swift `WKWebView` wrapper in [`scripts/mac-app/`](./scripts/mac-app) embedding the built web app behind a deterministic local loopback server (`127.0.0.1` ports `49191`–`49195`) so `localStorage` and IndexedDB persist across launches.
- Registers macOS document handling for `.excalidraw` drawings and `.excalidrawlib` libraries (macOS 13.0+).

### 4. Offline Android Tablet & S Pen App (`Excalidraw Pen`)

- **Offline Capacitor 8 wrapper** ([`android-app/`](./android-app), [`capacitor.config.ts`](./capacitor.config.ts)): bundles all `.woff2` fonts locally with zero external CDN runtime dependencies and skips service-worker registration inside Capacitor.
- **S Pen input & palm rejection** ([`packages/excalidraw/stylus.ts`](./packages/excalidraw/stylus.ts)):
  - Preserves real stylus pressure (`simulatePressure: false` for `pointerType === "pen"`).
  - Buffers coalesced high-rate pointer samples (`getCoalescedEvents()`) per animation frame without layout thrash and smooths pen strokes (`PEN_STROKE_STREAMLINE = 0.35`).
  - Auto-enables palm rejection on pen contact and hover while keeping two-finger pinch-zoom/pan and UI taps working.
  - Enlarges pen transform handles (`24px`) and maps stylus secondary/eraser buttons where exposed by Android WebView.
- **Tablet-tuned UI** ([`excalidraw-app/capacitor/`](./excalidraw-app/capacitor)):
  - Pins desktop layout across portrait and landscape rotation (`>= 600px` width) so rotating the tablet never switches UI modes.
  - `>= 44px` touch targets across controls, `48px` Undo/Redo buttons, scrollable portrait toolbar, system dark mode support, edge-to-edge fullscreen with display-cutout safe areas, and Android hardware Back button dismissal for open dialogs/menus before minimizing.
- **Native save, share & autosave** ([`excalidraw-app/data/capacitorFiles.ts`](./excalidraw-app/data/capacitorFiles.ts)):
  - Exports `.excalidraw`, PNG, and SVG directly into `Documents/Excalidraw` (`@capacitor/filesystem`) and launches the Android Share sheet (`@capacitor/share`), bypassing unreliable WebView blob downloads.
  - Imports diagrams, libraries, and images via the Android file picker.
  - Flushes local saves and recent-file snapshots on `@capacitor/app` pause/background transitions and `visibilitychange`.

---

## Prerequisites

- **Common**: Node.js `>= 18.0.0`, Yarn (`yarn install`)
- **macOS App**: macOS 13.0+ with Xcode Command Line Tools (`xcode-select --install`)
- **Android App**: JDK 21 (e.g., Android Studio's bundled JBR or Temurin 21) and Android SDK (`platform-tools`, `platforms;android-36`, `build-tools;35.0.0`)

---

## Build & Install on macOS (`Excalidraw.app`)

1. Install workspace dependencies (first time only):

   ```bash
   yarn install
   ```

2. Build into `dist/Excalidraw.app`, **or** build and install directly into `/Applications/Excalidraw.app`:

   ```bash
   # Build dist/Excalidraw.app
   yarn build:mac

   # Build and install to /Applications/Excalidraw.app
   yarn build:mac:install
   ```

3. Launch **Excalidraw** from **Applications** or Spotlight.

> **Tip**: If `excalidraw-app/build` is already built and you only changed files under `scripts/mac-app/`, run `node ./scripts/mac-app/build.js --skip-web --install`.

---

## Build & Install on Android (`Excalidraw Pen`)

1. Install workspace dependencies (first time only):

   ```bash
   yarn install
   ```

2. Build the offline Capacitor bundle and sync web assets & plugins to [`android-app/`](./android-app):

   ```bash
   yarn build:android
   ```

3. Export `JAVA_HOME` and `ANDROID_HOME` / `ANDROID_SDK_ROOT`:

   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export ANDROID_SDK_ROOT="$ANDROID_HOME"
   ```

   _(Without Android Studio on macOS, you can install just the CLI tools via Homebrew:)_

   ```bash
   brew install --cask android-commandlinetools
   export ANDROID_HOME="$HOME/android-sdk"
   mkdir -p "$ANDROID_HOME"
   yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
   sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;35.0.0"
   ```

4. Build the debug APK:

   ```bash
   ./android-app/gradlew -p android-app assembleDebug
   ```

   Output APK: `android-app/app/build/outputs/apk/debug/app-debug.apk`.

5. **Install on your tablet / Android device**:

   - **Option A — USB (`adb`)**:

     1. Enable **Settings → About tablet → Software information → tap Build number 7 times**.
     2. Enable **Settings → Developer options → USB debugging** and accept **Allow USB debugging?** on the tablet.
     3. Install:

        ```bash
        adb install -r android-app/app/build/outputs/apk/debug/app-debug.apk
        ```

   - **Option B — Manual sideload (no USB)**: Copy `android-app/app/build/outputs/apk/debug/app-debug.apk` onto the tablet, tap it in **My Files / Files**, and allow installing unknown apps when prompted.

---

## Browser Development Mode

To run the standard web dev server in your browser instead of the native wrappers:

```bash
yarn install
yarn start
```

---

## Core Whiteboard Features (Upstream Excalidraw)

- Infinite canvas with hand-drawn aesthetic, dark mode, shape libraries, i18n, PNG/SVG/clipboard export, and `.excalidraw` JSON format.
- Full toolset: rectangles, diamonds, ellipses, bound arrows & labeled arrows, text, freedraw, eraser, undo/redo, image embeds, laser pointer, and zoom/pan.

## License & Attribution

Based on [Excalidraw](https://github.com/excalidraw/excalidraw). Released under the [MIT License](./LICENSE).
