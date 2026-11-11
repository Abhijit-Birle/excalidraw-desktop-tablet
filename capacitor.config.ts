import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.excalidraw.pen",
  appName: "Excalidraw Pen",
  webDir: "excalidraw-app/build",
  zoomEnabled: false,
  initialFocus: true,
  server: {
    hostname: "localhost",
    androidScheme: "https",
  },
  android: {
    path: "android-app",
    allowMixedContent: false,
    zoomEnabled: false,
    initialFocus: true,
    resolveServiceWorkerRequests: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      hidden: true,
    },
  },
};

export default config;
