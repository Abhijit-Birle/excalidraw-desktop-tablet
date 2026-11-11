import React from "react";
import { act, fireEvent } from "@testing-library/react";

import { POINTER_BUTTON } from "@excalidraw/common";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  PEN_STROKE_STREAMLINE,
  extractCoalescedSamples,
  getFreedrawStreamlineForPointer,
  isEraserOrBarrelButton,
  shouldRejectTouchInPenMode,
  shouldSimulatePressure,
} from "../stylus";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { GlobalTestState, render } from "./test-utils";

const { h } = window;
const canvas = () => GlobalTestState.interactiveCanvas;

describe("stylus helpers", () => {
  it("detects hardware eraser and S Pen barrel button without misclassifying mouse right-click", () => {
    expect(
      isEraserOrBarrelButton({
        button: POINTER_BUTTON.ERASER,
        buttons: 32,
        pointerType: "pen",
      }),
    ).toBe(true);
    expect(
      isEraserOrBarrelButton({
        button: POINTER_BUTTON.SECONDARY,
        buttons: 2,
        pointerType: "pen",
      }),
    ).toBe(true);
    expect(
      isEraserOrBarrelButton({
        button: POINTER_BUTTON.MAIN,
        buttons: 3, // tip + barrel held together
        pointerType: "pen",
      }),
    ).toBe(true);
    expect(
      isEraserOrBarrelButton({
        button: POINTER_BUTTON.SECONDARY,
        buttons: 2,
        pointerType: "mouse",
      }),
    ).toBe(false);
    expect(
      isEraserOrBarrelButton({
        button: POINTER_BUTTON.MAIN,
        buttons: 1,
        pointerType: "pen",
      }),
    ).toBe(false);
  });

  it("never simulates pressure for pen even when initial contact reads 0.5", () => {
    expect(shouldSimulatePressure("pen", 0.5)).toBe(false);
    expect(shouldSimulatePressure("pen", 0.12)).toBe(false);
    expect(shouldSimulatePressure("touch", 0.5)).toBe(true);
    expect(shouldSimulatePressure("mouse", 0.5)).toBe(true);
    expect(shouldSimulatePressure("mouse", 0)).toBe(false);
  });

  it("extracts coalesced samples carrying per-sample hardware pressure", () => {
    const samples = extractCoalescedSamples({
      clientX: 300,
      clientY: 300,
      pressure: 0.9,
      getCoalescedEvents: () => [
        { clientX: 100, clientY: 100, pressure: 0.2 },
        { clientX: 200, clientY: 200, pressure: 0.65 },
        { clientX: 300, clientY: 300, pressure: 0.9 },
      ],
    });

    expect(samples).toEqual([
      { clientX: 100, clientY: 100, pressure: 0.2 },
      { clientX: 200, clientY: 200, pressure: 0.65 },
      { clientX: 300, clientY: 300, pressure: 0.9 },
    ]);

    expect(
      extractCoalescedSamples({
        clientX: 40,
        clientY: 50,
        pressure: 0.4,
      }),
    ).toEqual([{ clientX: 40, clientY: 50, pressure: 0.4 }]);
  });

  it("applies pen streamline and palm rejection rules", () => {
    expect(getFreedrawStreamlineForPointer("pen")).toBe(PEN_STROKE_STREAMLINE);
    expect(
      shouldRejectTouchInPenMode({
        penMode: true,
        isPenActiveOrHovering: false,
        pointerType: "touch",
        activeToolType: "freedraw",
      }),
    ).toBe(true);
    expect(
      shouldRejectTouchInPenMode({
        penMode: true,
        isPenActiveOrHovering: false,
        pointerType: "touch",
        activeToolType: "selection",
      }),
    ).toBe(false);
    expect(
      shouldRejectTouchInPenMode({
        penMode: true,
        isPenActiveOrHovering: true,
        pointerType: "touch",
        activeToolType: "selection",
      }),
    ).toBe(true);
    expect(
      shouldRejectTouchInPenMode({
        penMode: true,
        isPenActiveOrHovering: true,
        pointerType: "pen",
        activeToolType: "freedraw",
      }),
    ).toBe(false);
  });
});

describe("S Pen canvas integration", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("records real pressure (including initial 0.5) and coalesced pressure samples on freedraw strokes", () => {
    UI.clickTool("freedraw");

    fireEvent.pointerDown(canvas(), {
      pointerId: 10,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      pressure: 0.5,
    });

    const moveEvent = new Event("pointermove", {
      bubbles: true,
    }) as PointerEvent & {
      getCoalescedEvents: () => Array<{
        clientX: number;
        clientY: number;
        pressure: number;
      }>;
    };
    Object.assign(moveEvent, {
      pointerId: 10,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 110,
      clientY: 110,
      pressure: 0.85,
      getCoalescedEvents: () => [
        { clientX: 70, clientY: 70, pressure: 0.25 },
        { clientX: 90, clientY: 90, pressure: 0.6 },
        { clientX: 110, clientY: 110, pressure: 0.85 },
      ],
    });
    act(() => {
      canvas().dispatchEvent(moveEvent);
    });

    const upEvent = new Event("pointerup", { bubbles: true });
    Object.assign(upEvent, {
      pointerId: 10,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 130,
      clientY: 130,
      pressure: 0.1,
    });
    act(() => {
      canvas().dispatchEvent(upEvent);
    });

    expect(h.elements.length).toBe(1);
    const stroke = h.elements[0] as ExcalidrawFreeDrawElement;
    expect(stroke.type).toBe("freedraw");
    expect(stroke.simulatePressure).toBe(false);
    expect(stroke.pressures).toEqual([0.5, 0.25, 0.6, 0.85, 0.1]);
    expect(stroke.points.length).toBe(5);
  });

  it("enables penMode on hover, rejects resting palm mid-stroke, and keeps 2-finger pinch zoom working", () => {
    UI.clickTool("freedraw");
    expect(h.state.penMode).toBe(false);

    // Pen hover auto-enables penMode
    fireEvent.pointerMove(canvas(), {
      pointerId: 11,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 80,
      clientY: 80,
    });
    expect(h.state.penMode).toBe(true);
    expect(h.state.penDetected).toBe(true);

    // Start stroke with S Pen while resting palm touches the glass
    fireEvent.pointerDown(canvas(), {
      pointerId: 11,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 40,
      clientY: 40,
      pressure: 0.4,
    });
    fireEvent.pointerDown(canvas(), {
      pointerId: 99,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(window, {
      pointerId: 11,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 90,
      clientY: 90,
      pressure: 0.7,
    });
    fireEvent.pointerUp(window, {
      pointerId: 11,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 90,
      clientY: 90,
      pressure: 0,
    });
    fireEvent.pointerUp(canvas(), {
      pointerId: 99,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 300,
      clientY: 300,
    });

    expect(h.elements.length).toBe(1);

    // Two-finger pinch zoom still works even with freedraw + penMode active
    const initialZoom = h.state.zoom.value;
    fireEvent.pointerDown(canvas(), {
      pointerId: 21,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerDown(canvas(), {
      pointerId: 22,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 140,
      clientY: 100,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 21,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 1,
      clientX: 60,
      clientY: 100,
    });
    expect(h.state.zoom.value).toBeGreaterThan(initialZoom);

    fireEvent.pointerUp(canvas(), {
      pointerId: 21,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 60,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas(), {
      pointerId: 22,
      pointerType: "touch",
      button: POINTER_BUTTON.MAIN,
      buttons: 0,
      clientX: 140,
      clientY: 100,
    });
  });

  it("maps S Pen barrel button to temporary eraser without opening pan or context menu", () => {
    UI.clickTool("freedraw");
    const rect = API.createElement({
      type: "rectangle",
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });
    h.elements = [rect];

    const startScrollX = h.state.scrollX;

    fireEvent.pointerDown(canvas(), {
      pointerId: 12,
      pointerType: "pen",
      button: POINTER_BUTTON.SECONDARY,
      buttons: 2,
      clientX: 80,
      clientY: 80,
    });

    expect(h.state.activeTool.type).toBe("eraser");

    // Native contextmenu event fired by WebView on secondary button must be suppressed
    fireEvent.contextMenu(canvas(), {
      button: POINTER_BUTTON.SECONDARY,
      clientX: 80,
      clientY: 80,
    });
    expect(h.state.contextMenu).toBeNull();

    fireEvent.pointerMove(window, {
      pointerId: 12,
      pointerType: "pen",
      button: POINTER_BUTTON.MAIN,
      buttons: 2,
      clientX: 120,
      clientY: 120,
    });
    act(() => {
      fireEvent.pointerUp(window, {
        pointerId: 12,
        pointerType: "pen",
        button: POINTER_BUTTON.SECONDARY,
        buttons: 0,
        clientX: 120,
        clientY: 120,
      });
    });

    expect(h.state.scrollX).toBe(startScrollX);
    expect(h.state.activeTool.type).toBe("freedraw");
  });
});
