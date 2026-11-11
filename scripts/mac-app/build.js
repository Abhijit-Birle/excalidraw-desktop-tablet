#!/usr/bin/env node
/* eslint-disable no-console */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const APP_DIR = path.join(ROOT_DIR, "excalidraw-app");
const WEB_BUILD_DIR = path.join(APP_DIR, "build");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const BUNDLE_DIR = path.join(DIST_DIR, "Excalidraw.app");
const CONTENTS_DIR = path.join(BUNDLE_DIR, "Contents");
const MACOS_DIR = path.join(CONTENTS_DIR, "MacOS");
const RESOURCES_DIR = path.join(CONTENTS_DIR, "Resources");
const WEB_DEST_DIR = path.join(RESOURCES_DIR, "web");

const args = new Set(process.argv.slice(2));
const skipWebBuild = args.has("--skip-web");
const installToApplications = args.has("--install");

function run(cmd, cmdArgs, options = {}) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", ...options });
}

function copyDirWithoutSourceMaps(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.endsWith(".map")) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirWithoutSourceMaps(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getAppVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"),
    );
    if (pkg.version) {
      return pkg.version;
    }
  } catch {
    // ignore
  }
  return "1.0.0";
}

function getBuildVersion() {
  try {
    const versionJson = JSON.parse(
      fs.readFileSync(path.join(WEB_BUILD_DIR, "version.json"), "utf8"),
    );
    if (versionJson.version) {
      return versionJson.version;
    }
  } catch {
    // ignore
  }
  return getAppVersion();
}

function writeInfoPlist() {
  const shortVersion = getAppVersion();
  const buildVersion = getBuildVersion();

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Excalidraw</string>
  <key>CFBundleExecutable</key>
  <string>Excalidraw</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.excalidraw.macapp</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Excalidraw</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${shortVersion}</string>
  <key>CFBundleVersion</key>
  <string>${buildVersion}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.graphics-design</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>excalidraw</string>
      </array>
      <key>CFBundleTypeName</key>
      <string>Excalidraw Drawing</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Owner</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>com.excalidraw.drawing</string>
      </array>
    </dict>
    <dict>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>excalidrawlib</string>
      </array>
      <key>CFBundleTypeName</key>
      <string>Excalidraw Library</string>
      <key>CFBundleTypeRole</key>
      <string>Viewer</string>
      <key>LSHandlerRank</key>
      <string>Owner</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>com.excalidraw.library</string>
      </array>
    </dict>
  </array>
  <key>UTImportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeConformsTo</key>
      <array>
        <string>public.json</string>
      </array>
      <key>UTTypeDescription</key>
      <string>Excalidraw Drawing</string>
      <key>UTTypeIdentifier</key>
      <string>com.excalidraw.drawing</string>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>excalidraw</string>
        </array>
        <key>public.mime-type</key>
        <array>
          <string>application/vnd.excalidraw+json</string>
        </array>
      </dict>
    </dict>
    <dict>
      <key>UTTypeConformsTo</key>
      <array>
        <string>public.json</string>
      </array>
      <key>UTTypeDescription</key>
      <string>Excalidraw Library</string>
      <key>UTTypeIdentifier</key>
      <string>com.excalidraw.library</string>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>excalidrawlib</string>
        </array>
        <key>public.mime-type</key>
        <array>
          <string>application/vnd.excalidrawlib+json</string>
        </array>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;

  fs.writeFileSync(path.join(CONTENTS_DIR, "Info.plist"), plist, "utf8");
}

function buildWebBundle() {
  const viteBin = path.join(ROOT_DIR, "node_modules", ".bin", "vite");
  const versionScript = path.join(ROOT_DIR, "scripts", "build-version.js");
  console.log("Building Excalidraw web bundle...");
  run(process.execPath, [viteBin, "build"], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      VITE_APP_DISABLE_SENTRY: "true",
      VITE_APP_ENABLE_TRACKING: "false",
    },
  });
  run(process.execPath, [versionScript], { cwd: APP_DIR });
}

function runSwiftc(tmpDir, moduleCacheDir, swiftArgs) {
  run("swiftc", ["-O", "-module-cache-path", moduleCacheDir, ...swiftArgs], {
    env: {
      ...process.env,
      TMPDIR: tmpDir,
      CLANG_MODULE_CACHE_PATH: moduleCacheDir,
    },
  });
}

function buildAppIcon(tmpDir, moduleCacheDir) {
  const sourcePng = path.join(ROOT_DIR, "public", "android-chrome-512x512.png");
  const iconMakerSwift = path.join(__dirname, "make-icon.swift");
  const iconMakerBin = path.join(tmpDir, "make-icon");
  const icnsOut = path.join(RESOURCES_DIR, "AppIcon.icns");

  console.log("Generating macOS app icon...");
  runSwiftc(tmpDir, moduleCacheDir, [
    "-framework",
    "AppKit",
    "-o",
    iconMakerBin,
    iconMakerSwift,
  ]);
  run(iconMakerBin, [sourcePng, icnsOut]);
}

function compileMacBinary(tmpDir, moduleCacheDir) {
  const swiftSrc = path.join(__dirname, "ExcalidrawApp.swift");
  const binaryOut = path.join(MACOS_DIR, "Excalidraw");

  console.log("Compiling native macOS wrapper...");
  runSwiftc(tmpDir, moduleCacheDir, [
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-framework",
    "UniformTypeIdentifiers",
    "-o",
    binaryOut,
    swiftSrc,
  ]);
}

function main() {
  if (process.platform !== "darwin") {
    console.error("macOS app build is only supported on macOS (darwin).");
    process.exit(1);
  }

  const indexHtml = path.join(WEB_BUILD_DIR, "index.html");
  if (!skipWebBuild || !fs.existsSync(indexHtml)) {
    buildWebBundle();
  } else {
    console.log("Using existing excalidraw-app/build (--skip-web).");
  }

  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(DIST_DIR, ".tmp-mac-app"), {
    recursive: true,
    force: true,
  });
  fs.mkdirSync(MACOS_DIR, { recursive: true });
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Keep swift module cache in a space-free /tmp path so clang modules compile reliably.
  const tmpDir = fs.mkdtempSync("/tmp/excalidraw-mac-");
  const moduleCacheDir = path.join(tmpDir, "swift-module-cache");
  fs.mkdirSync(moduleCacheDir, { recursive: true });

  try {
    console.log("Embedding web assets into Excalidraw.app...");
    copyDirWithoutSourceMaps(WEB_BUILD_DIR, WEB_DEST_DIR);

    buildAppIcon(tmpDir, moduleCacheDir);
    writeInfoPlist();
    compileMacBinary(tmpDir, moduleCacheDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("Signing Excalidraw.app (ad-hoc)...");
  run("codesign", ["--force", "--deep", "--sign", "-", BUNDLE_DIR]);

  console.log(`Built ${BUNDLE_DIR}`);

  if (installToApplications) {
    const targetApp = "/Applications/Excalidraw.app";
    console.log(`Installing to ${targetApp}...`);
    fs.rmSync(targetApp, { recursive: true, force: true });
    run("ditto", [BUNDLE_DIR, targetApp]);
    console.log(`Installed ${targetApp}`);
  }
}

main();
