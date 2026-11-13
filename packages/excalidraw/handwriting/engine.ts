import { Capacitor, registerPlugin } from "@capacitor/core";
import type { HandwritingEngine, InkData, RecognitionResult } from "./types";

interface NativeDigitalInkPlugin {
  checkAvailability(options?: {
    languageTag?: string;
  }): Promise<{ available: boolean; downloaded: boolean }>;
  downloadModel(options?: { languageTag?: string }): Promise<{ success: boolean }>;
  recognize(options: {
    strokes: { points: { x: number; y: number; t?: number }[] }[];
    languageTag?: string;
  }): Promise<{ candidates: string[] }>;
}

let nativePluginInstance: NativeDigitalInkPlugin | null = null;

const getNativePlugin = (): NativeDigitalInkPlugin => {
  if (!nativePluginInstance) {
    nativePluginInstance = registerPlugin<NativeDigitalInkPlugin>("DigitalInk");
  }
  return nativePluginInstance;
};

// ---------------------------------------------------------------------------
// Native Capacitor ML Kit Engine (Android)
// ---------------------------------------------------------------------------
export class NativeHandwritingEngine implements HandwritingEngine {
  readonly id = "native" as const;

  async isAvailable(locale = "en-US"): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }
    try {
      const plugin = getNativePlugin();
      const status = await plugin.checkAvailability({ languageTag: locale });
      return status.available;
    } catch (e) {
      console.warn("DigitalInk native plugin check failed:", e);
      return false;
    }
  }

  async downloadModel(locale = "en-US"): Promise<void> {
    const plugin = getNativePlugin();
    await plugin.downloadModel({ languageTag: locale });
  }

  async recognize(ink: InkData, locale = "en-US"): Promise<RecognitionResult> {
    const plugin = getNativePlugin();
    const result = await plugin.recognize({
      strokes: ink,
      languageTag: locale,
    });
    return {
      candidates: result.candidates && result.candidates.length > 0
        ? result.candidates
        : [""],
    };
  }
}

// ---------------------------------------------------------------------------
// Web Handwriting API Engine (Browser dev, ChromeOS/flags)
// ---------------------------------------------------------------------------
export class WebHandwritingEngine implements HandwritingEngine {
  readonly id = "web" as const;

  async isAvailable(locale = "en"): Promise<boolean> {
    if (
      typeof navigator === "undefined" ||
      !("createHandwritingRecognizer" in (navigator as any))
    ) {
      return false;
    }
    try {
      const queryResult = await (navigator as any).queryHandwritingRecognizer({
        languages: [locale],
      });
      return !!queryResult;
    } catch {
      return false;
    }
  }

  async recognize(ink: InkData, locale = "en"): Promise<RecognitionResult> {
    const recognizer = await (navigator as any).createHandwritingRecognizer({
      languages: [locale],
    });
    const drawing = recognizer.startDrawing();
    for (const stroke of ink) {
      drawing.addStroke(stroke.points);
    }
    const predictions = await drawing.getPrediction();
    const candidates = predictions.map((p: any) => p.text);
    return {
      candidates: candidates.length > 0 ? candidates : [""],
    };
  }
}

// ---------------------------------------------------------------------------
// Mock Engine (For browser development & testing when no native ML Kit is attached)
// ---------------------------------------------------------------------------
export class MockHandwritingEngine implements HandwritingEngine {
  readonly id = "mock" as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async recognize(ink: InkData): Promise<RecognitionResult> {
    const strokeCount = ink.length;
    const pointCount = ink.reduce((acc, s) => acc + s.points.length, 0);

    // Provide predictable mock candidates based on stroke count
    const primary = `Handwritten Text (${strokeCount} stroke${strokeCount === 1 ? "" : "s"})`;
    return {
      candidates: [
        primary,
        "Meeting Notes",
        "Idea #1",
        "Action items",
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Engine Selector
// ---------------------------------------------------------------------------
export const getHandwritingEngine = async (locale = "en-US"): Promise<HandwritingEngine> => {
  if (Capacitor.isNativePlatform()) {
    const nativeEngine = new NativeHandwritingEngine();
    if (await nativeEngine.isAvailable(locale)) {
      return nativeEngine;
    }
  }

  const webEngine = new WebHandwritingEngine();
  if (await webEngine.isAvailable(locale)) {
    return webEngine;
  }

  return new MockHandwritingEngine();
};

