import {
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_STROKE_STREAMLINE_PRECISE,
  POINTER_BUTTON,
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
 * Extracts all sub-frame hardware samples from `getCoalescedEvents()`,
 * preserving each sample's individual `pressure` so high-rate pen strokes retain
 * accurate coordinates and pressure curves under frame throttling.
 */
export const extractCoalescedSamples = (
  event: CoalescedEventLike,
): CoalescedPointerSample[] => {
  const fallbackPressure =
    typeof event.pressure === "number" ? event.pressure : 0.5;
  const coalesced = event.getCoalescedEvents?.();

  if (coalesced && coalesced.length > 0) {
    const samples: CoalescedPointerSample[] = [];
    for (let i = 0; i < coalesced.length; i++) {
      const sample = coalesced[i];
      samples.push({
        clientX: sample.clientX,
        clientY: sample.clientY,
        pressure:
          typeof sample.pressure === "number"
            ? sample.pressure
            : fallbackPressure,
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
