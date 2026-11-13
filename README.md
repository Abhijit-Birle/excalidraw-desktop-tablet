# excalidraw-desktop-tablet

> **Unofficial, offline-first fork of [Excalidraw](https://github.com/excalidraw/excalidraw)** packaged as a native macOS app (`Excalidraw.app`) and an Android tablet app (`Excalidraw Pen`, S Pen first) — with built-in **Recent Files**, one-tap **New Diagram**, and pen-tuned input.

![Platform: macOS 13+](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey) ![Platform: Android (Capacitor 8)](https://img.shields.io/badge/platform-Android%20%28Capacitor%208%29-green) ![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Upstream: excalidraw/excalidraw](https://img.shields.io/badge/upstream-excalidraw%2Fexcalidraw-6965db)

Everything is **local-first**: diagrams, history, and thumbnails live in on-device storage. No account, no cloud storage, works fully offline.

---

## What this fork adds over upstream

| Capability | Upstream (excalidraw.com) | This fork |
| --- | --- | --- |
| Recent Files (50-item history, thumbnails, rename, delete) | — | Yes (macOS, Android, browser) |
| Quick New Diagram (`+ New`, auto-titled, no blank spam) | — | Yes |
| Quick Pen Size & Pressure (Hairline 0.25px, Light/Flattest sensitivity) | — | Yes (Toolbar popover) |
| Native macOS app with `.excalidraw` / `.excalidrawlib` document handling | — | Yes (`Excalidraw.app`) |
| Android APK with real S Pen pressure, palm rejection, coalesced-event smoothing | Browser-dependent | Yes |
| Native save/share (files land in `Documents/Excalidraw`, Android Share sheet) | Browser download | Yes |
| Fully offline bundle (local `.woff2` fonts, no CDN) | Service worker | Yes |
| Tablet-stable desktop layout (rotation-safe, pinned >= 600px) | Auto (may switch to mobile UI) | Yes |
| Touch-friendly UI (>= 44px targets, 48px Undo/Redo, back-button handling) | — | Yes |

## User guide

### Recent Files

Every diagram you work on is automatically snapshotted into an on-device history (up to **50** entries with ~200px PNG thumbnails and relative last-edited times).

- **Open it**: main menu → **Recent files**, the always-visible top-right **Recent files** toolbar button, or `Ctrl/Cmd + Shift + O`.
- **Reopen a diagram**: tap/click its card. Your current scene is saved first, so nothing is lost.
- **Rename**: click the entry title inline.
- **Delete**: swipe left (Android) or use the entry's delete button; **Clear all** asks twice before wiping.
- **Automatic snapshots** are taken when: the scene is saved, the canvas is reset, the app is backgrounded (Android), and before any scene switch.
- **Collaboration safety**: switching scenes mid-collaboration session is blocked on purpose.

### New Diagram (`+ New`)

Start a fresh canvas from **`+ New`** inside Recent Files, **New diagram** in the main menu, or `Ctrl/Cmd + Alt + N`. Your current work is snapshotted first; the new diagram gets a dated title (`Untitled-YYYY-MM-DD`, deduplicated as `-2`, `-3`, ...). Starting from an untouched blank canvas never creates duplicate empty entries.

### Keyboard shortcuts (this fork)

| Action       | macOS             | Android / Samsung DeX |
| ------------ | ----------------- | --------------------- |
| Recent Files | `Cmd + Shift + O` | `Ctrl + Shift + O`    |
| New diagram  | `Cmd + Alt + N`   | `Ctrl + Alt + N`      |

All other Excalidraw shortcuts work unchanged (useful with an external keyboard or DeX).

### Using the Android app with the S Pen

- **Pressure**: real stylus pressure drives stroke width (`simulatePressure` is disabled for pens).
- **Quick Pen Size & Pressure**: a dedicated quick control appears beside the Draw tool in the toolbar:
  - **4 Size Presets**: Hairline (`0.25px`), Thin (`0.5px`), Medium (`1.0px`), Bold (`2.0px`) with a fine-tune thickness slider.
  - **Pressure Sensitivity Modes**: **Light (Flattest)** (damps writing pressure to eliminate fat strokes for notes/math), **Standard** (1:1 hardware), and **Heavy (Dynamic)** (expressive calligraphic flair).
  - **Ergonomics**: >= 44px touch targets; outside taps close the popover cleanly without leaving stray canvas strokes.
- **Palm rejection**: auto-enables on pen contact and hover — rest your palm on the screen while drawing. Two-finger pinch-zoom/pan and UI taps stay active.
- **Smoothness**: high-rate pointer samples are coalesced per frame and smoothed (`PEN_STROKE_STREAMLINE = 0.35`), keeping strokes smooth at 90Hz.
- **Stylus buttons**: secondary/eraser buttons are mapped where the Android WebView exposes them.
- **Layout**: desktop layout is pinned in both portrait and landscape; rotating never switches UI modes or loses your scene.
- **Back button**: closes open dialogs/menus first, then minimizes the app.
- **Export**: `.excalidraw`, PNG, and SVG land in `Documents/Excalidraw` or go through the Android Share sheet; import diagrams/libraries/images via the Android file picker.

### Where your data lives

| Platform | Current scene + Recent Files history | Images | Exports |
| --- | --- | --- | --- |
| Browser | `localStorage` (elements + app state) and IndexedDB `excalidraw-recent-files-db` | Live canvas in `files-db`; Recent Files snapshots copy referenced images into `excalidraw-recent-files-db` | Browser download |
| macOS app | Same as browser, persisted across launches by the local loopback server (`127.0.0.1`, ports `49191`–`49195`) | Same as browser (`files-db` + `excalidraw-recent-files-db` copies) | Native Save dialog (`NSSavePanel` via `WKDownloadDelegate`) |
| Android app | App-sandboxed WebView storage (`navigator.storage.persist()` is requested, though Android WebView may refuse it and log a warning) | Same as browser (`files-db` + `excalidraw-recent-files-db` copies) | `Documents/Excalidraw` (`@capacitor/filesystem`) or Share sheet (`@capacitor/share`) |

**Backup tip**: clearing app/browser data deletes the history. For anything important, export a `.excalidraw` file regularly — that file is a complete, portable backup.

---

## Build & install

### Prerequisites

- **Common**: Node.js >= 18.0.0, Yarn (`yarn install`)
- **macOS app**: macOS 13.0+ with Xcode Command Line Tools (`xcode-select --install`)
- **Android app**: JDK 21 (e.g. Android Studio's bundled JBR or Temurin 21) and Android SDK (`platform-tools`, `platforms;android-36`, `build-tools;35.0.0`)

### macOS (`Excalidraw.app`)

1. Install workspace dependencies (first time only):

   ```bash
   yarn install
   ```

2. Build into `dist/Excalidraw.app`, or build **and** install into `/Applications/Excalidraw.app`:

   ```bash
   # Build dist/Excalidraw.app
   yarn build:mac

   # Build and install to /Applications/Excalidraw.app
   yarn build:mac:install
   ```

3. Launch **Excalidraw** from Applications or Spotlight.

> **Tip**: if `excalidraw-app/build` is already built and you only changed files under `scripts/mac-app/`, run `node ./scripts/mac-app/build.js --skip-web --install`.

### Android (`Excalidraw Pen`)

1. Install workspace dependencies (first time only):

   ```bash
   yarn install
   ```

2. Build the offline Capacitor bundle and sync web assets and plugins into [`android-app/`](./android-app):

   ```bash
   yarn build:android
   ```

3. Export `JAVA_HOME` and `ANDROID_HOME` / `ANDROID_SDK_ROOT`:

   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export ANDROID_SDK_ROOT="$ANDROID_HOME"
   ```

   Without Android Studio on macOS, install just the CLI tools via Homebrew:

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

   - **Option B — manual sideload (no USB)**: copy `android-app/app/build/outputs/apk/debug/app-debug.apk` onto the tablet, tap it in **My Files / Files**, and allow installing unknown apps when prompted.

### Browser development mode

```bash
yarn install
yarn start
```

The fork's features (Recent Files, `+ New`) work in the browser too — handy for quick iteration before packaging.

---

## How it's implemented

| Area | Key files |
| --- | --- |
| Recent Files store + dialog | [`excalidraw-app/data/recentFiles.ts`](./excalidraw-app/data/recentFiles.ts), [`excalidraw-app/components/RecentFilesDialog.tsx`](./excalidraw-app/components/RecentFilesDialog.tsx) |
| Quick Pen Size & pressure control | [`packages/excalidraw/components/PenSizePopover.tsx`](./packages/excalidraw/components/PenSizePopover.tsx), [`packages/excalidraw/components/PenSizePopover.scss`](./packages/excalidraw/components/PenSizePopover.scss) |
| S Pen input, palm rejection, stroke smoothing | [`packages/excalidraw/stylus.ts`](./packages/excalidraw/stylus.ts) (`PEN_STROKE_STREAMLINE = 0.35`) |
| Android shell (layout pinning, back button, background flush) | [`excalidraw-app/capacitor/nativeBridge.ts`](./excalidraw-app/capacitor/nativeBridge.ts), [`excalidraw-app/App.tsx`](./excalidraw-app/App.tsx) |
| Native export/share/import | [`excalidraw-app/data/capacitorFiles.ts`](./excalidraw-app/data/capacitorFiles.ts) |
| Capacitor project + config | [`android-app/`](./android-app), [`capacitor.config.ts`](./capacitor.config.ts) |
| macOS wrapper + loopback server | [`scripts/mac-app/`](./scripts/mac-app) |

The diff is kept **additive** (new files and small hooks) so the fork stays easy to rebase onto upstream releases.

## Known limitations

- Recent Files is capped at **50** entries; thumbnails are captured at snapshot time (they don't live-update).
- S Pen hover and barrel/eraser-button behavior depend on what the Android WebView on your device exposes — unexposed features are skipped, not faked.
- Scene switching is blocked during an active collaboration session by design.
- Inside the Android app the service worker is skipped (offline comes from the bundled assets instead).
- The tablet pins the **desktop** layout (>= 600px); the upstream mobile layout is not used on tablets.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `adb` says "device unauthorized" | Accept the **Allow USB debugging?** prompt on the tablet, then retry. |
| Tablet refuses the APK ("unknown apps") | Settings → Apps → Special access → **Install unknown apps** → allow for My Files / Chrome. |
| Gradle fails on `JAVA_HOME` | Point `JAVA_HOME` at Android Studio's bundled JBR (see step 3 above) or install Temurin 21. |
| `gradlew: Permission denied` | `chmod +x android-app/gradlew` and re-run. |
| Play Protect flags the debug APK | It is a self-signed debug build from your own machine — choose **Install anyway**. |
| Recent Files empty after clearing browser/app data | On-device history was wiped with the storage. Restore by importing your exported `.excalidraw` files. |

## Keeping the fork in sync with upstream

```bash
# If you haven't added the upstream remote yet:
git remote add upstream https://github.com/excalidraw/excalidraw.git

git fetch upstream
git merge upstream/master   # or rebase
yarn install && yarn test:app --watch=false
```

Expect conflicts around `excalidraw-app/App.tsx`, `excalidraw-app/data/*`, and `packages/excalidraw/components/*` — the fork's hooks touch those.

## Ideas / roadmap

Not committed, in rough order of usefulness:

- Hover previews (full-size canvas) in the Recent Files grid
- Optional auto-backup of the Recent Files history to a `.zip` / cloud of your choice
- More S Pen capabilities (tilt) if/when WebView exposes them
- iOS wrapper (same Capacitor approach)

## Core whiteboard features (upstream Excalidraw)

Infinite canvas with hand-drawn aesthetic, dark mode, shape libraries, i18n, PNG/SVG/clipboard export, `.excalidraw` JSON format, full toolset (rectangles, diamonds, ellipses, bound arrows, text, freedraw, eraser, undo/redo, image embeds, laser pointer, zoom/pan).

## Contributing & development notes

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers the upstream dev workflow (lint, tests, PRs).
- [`AGENTS.md`](./AGENTS.md) / [`CLAUDE.md`](./CLAUDE.md) document conventions for AI-assisted development used in this repository.
- [`dev-docs/`](./dev-docs) contains upstream developer documentation.

## License & attribution

Based on [Excalidraw](https://github.com/excalidraw/excalidraw). Released under the [MIT License](./LICENSE). Not affiliated with or endorsed by the Excalidraw team.
