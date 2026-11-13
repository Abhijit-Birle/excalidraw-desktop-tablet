import { describe, expect, it } from "vitest";
import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";
import { clusterFreedrawElements, freedrawElementToInkStroke } from "./clustering";

const makeMockFreedraw = (
  id: string,
  x: number,
  y: number,
  points: [number, number][],
): ExcalidrawFreeDrawElement => {
  return {
    id,
    type: "freedraw",
    x,
    y,
    width: 100,
    height: 30,
    angle: 0 as any,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    index: "a0" as any,
    created: 1,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: undefined,
    points: points as any,
    pressures: points.map(() => 0.5),
    simulatePressure: true,
    strokeOptions: {
      variability: 1 as any,
      streamline: 0.5,
    },
  };
};

describe("handwriting clustering", () => {
  it("converts freedraw points to absolute canvas coordinates with timestamps", () => {
    const el = makeMockFreedraw("f1", 100, 200, [
      [0, 0],
      [10, 5],
      [20, 10],
    ]);
    const stroke = freedrawElementToInkStroke(el, 1000);

    expect(stroke.points).toHaveLength(3);
    expect(stroke.points[0]).toEqual({ x: 100, y: 200, t: 1000 });
    expect(stroke.points[1]).toEqual({ x: 110, y: 205, t: 1016 });
    expect(stroke.points[2]).toEqual({ x: 120, y: 210, t: 1032 });
  });

  it("clusters strokes into lines top-to-bottom and sorts left-to-right", () => {
    // Line 1: two words ("Hello" at x=100, "World" at x=200, y=100)
    const el1 = makeMockFreedraw("word2", 200, 100, [
      [0, 0],
      [50, 30],
    ]);
    const el2 = makeMockFreedraw("word1", 100, 105, [
      [0, 0],
      [40, 25],
    ]);

    // Line 2: one word ("Second" at x=120, y=200)
    const el3 = makeMockFreedraw("word3", 120, 200, [
      [0, 0],
      [60, 28],
    ]);

    const result = clusterFreedrawElements([el1, el2, el3]);

    expect(result.lines).toHaveLength(2);
    // Line 1 should be first because y ~ 100
    expect(result.lines[0].bounds.minY).toBeLessThan(result.lines[1].bounds.minY);
    // Line 1 should have 2 strokes sorted left-to-right (el2 at 100 before el1 at 200)
    expect(result.lines[0].strokes).toHaveLength(2);
    expect(result.lines[0].strokes[0].points[0].x).toBe(100);
    expect(result.lines[0].strokes[1].points[0].x).toBe(200);

    // Line 2 has el3
    expect(result.lines[1].strokes).toHaveLength(1);
    expect(result.lines[1].strokes[0].points[0].x).toBe(120);

    // Font size should be derived within reasonable range
    expect(result.derivedFontSize).toBeGreaterThanOrEqual(16);
    expect(result.derivedFontSize).toBeLessThanOrEqual(48);
  });
});

