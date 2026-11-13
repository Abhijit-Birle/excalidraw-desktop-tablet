import {
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_STROKE_STREAMLINE_PRECISE,
  POINTER_BUTTON,
  type PenPressureSensitivity,
} from "@excalidraw/common";

/**
 * Streamline factor tuned for stylus/S Pen strokes (~0.35): dampens initial
 * and terminal digitizer jitter without lagging fast handwritten curves.
 */
export const PEN_STROKE_STREAMLINE = 0.35;

export type StylusButtonEvent = {
  button?: number;
  buttons?: number;
  pointerType?: string;
};

export type CoalescedPointerSample = {
  clientX: number;
  clientY: number;
  pressure: number;
};

type CoalescedEventLike = {
  clientX: number;
  clientY: number;
  pressure?: number;
  getCoalescedEvents?: () => ReadonlyArray<{
    clientX: number;
    clientY: number;
    pressure?: number;
  }>;
};

/**
 * Detects stylus tail-eraser events (`button === 5` / `buttons & 32`) as well
 * as S Pen side/barrel button presses (`pointerType === "pen"` with
 * `button === 2` or `buttons` bit 2 / 32) so pen buttons map to temporary
 * erasing instead of mouse right-click pan/context menus.
 */
export const isEraserOrBarrelButton = (event: StylusButtonEvent): boolean => {
  if (event.button === POINTER_BUTTON.ERASER) {
    return true;
  }

  if (event.pointerType !== "pen") {
    return false;
  }

  const buttons = event.buttons ?? 0;
  return (
    event.button === POINTER_BUTTON.SECONDARY ||
    (buttons & 32) !== 0 ||
    (buttons & 2) !== 0
  );
};

/**
 * Determines whether freedraw should fall back to velocity-based simulated
 * pressure. Stylus hardware (`pointerType === "pen"`) always uses real
 * hardware pressure samples, even if the initial contact reads `0.5`.
 */
export const shouldSimulatePressure = (
  pointerType: string | undefined,
  pressure: number | undefined,
): boolean => {
  if (pointerType === "pen") {
    return false;
  }
  return pressure === 0.5;
};

/**
 * Chooses freedraw streamline smoothing per pointer type.
 */
export const getFreedrawStreamlineForPointer = (
  pointerType: string | undefined,
): number => {
  if (pointerType === "pen") {
    return PEN_STROKE_STREAMLINE;
  }
  if (pointerType === "touch") {
    return DEFAULT_STROKE_STREAMLINE_PRECISE;
  }
  return DEFAULT_STROKE_STREAMLINE;
};

/**
 * Calibrates physical stylus/S Pen pressure according to the chosen sensitivity:
 * - "light" (flattest line): compresses dynamic range and damps high writing
 *   pressure so firm contact doesn't expand into thick lines. Behaves like a
 *   steady technical fineliner/gel pen.
 * - "standard" (default): raw 1:1 hardware digitizer pressure.
 * - "heavy" (dynamic / calligraphic): expands dynamic range with a power curve,
 *   so light touches stay razor thin and firm strokes swell richly.
 */
export const calibrateStylusPressure = (
  rawPressure: number | undefined,
  sensitivity: PenPressureSensitivity = "standard",
): number => {
  const p = typeof rawPressure === "number" ? rawPressure : 0.5;
  if (sensitivity === "light") {
    // Damps high handwriting pressure (e.g. 0.8 -> 0.48), keeping the stroke
    // slim and consistent across the stroke path.
    return Math.max(0.1, Math.min(0.55, 0.2 + 0.35 * p));
  }
  if (sensitivity === "heavy") {
    // Expands dynamic range: gentle sweeps stay razor-thin (0.1^1.6 = 0.025),
    // firm presses swell to full width (0.9^1.6 = 0.84, 1.0^1.6 = 1.0).
    return Math.max(0.05, Math.min(1.0, Math.pow(p, 1.6)));
  }
  return Math.max(0.0, Math.min(1.0, p));
};

/**
 * Extracts all sub-frame hardware samples from `getCoalescedEvents()`,
 * preserving each sample's individual calibrated `pressure` so high-rate pen
 * strokes retain accurate coordinates and pressure curves under frame throttling.
 */
export const extractCoalescedSamples = (
  event: CoalescedEventLike,
  sensitivity: PenPressureSensitivity = "standard",
): CoalescedPointerSample[] => {
  const rawFallback = typeof event.pressure === "number" ? event.pressure : 0.5;
  const fallbackPressure = calibrateStylusPressure(rawFallback, sensitivity);
  const coalesced = event.getCoalescedEvents?.();

  if (coalesced && coalesced.length > 0) {
    const samples: CoalescedPointerSample[] = [];
    for (let i = 0; i < coalesced.length; i++) {
      const sample = coalesced[i];
      const rawSamplePressure =
        typeof sample.pressure === "number" ? sample.pressure : rawFallback;
      samples.push({
        clientX: sample.clientX,
        clientY: sample.clientY,
        pressure: calibrateStylusPressure(rawSamplePressure, sensitivity),
      });
    }
    return samples;
  }

  return [
    {
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: fallbackPressure,
    },
  ];
};

/**
 * Returns true when a single-finger `"touch"` pointer interaction on the canvas
 * should be ignored for drawing/editing (palm rejection) while leaving multi-
 * touch pinch/pan gestures tracked via `gesture.pointers`.
 */
export const shouldRejectTouchInPenMode = ({
  penMode,
  isPenActiveOrHovering,
  pointerType,
  activeToolType,
}: {
  penMode: boolean;
  isPenActiveOrHovering: boolean;
  pointerType: string | undefined;
  activeToolType: string;
}): boolean => {
  if (pointerType !== "touch") {
    return false;
  }
  if (isPenActiveOrHovering) {
    return true;
  }
  if (!penMode) {
    return false;
  }
  return (
    activeToolType !== "selection" &&
    activeToolType !== "lasso" &&
    activeToolType !== "text" &&
    activeToolType !== "image"
  );
};
