import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";
import type { InkData, InkPoint, InkStroke, StrokeLineCluster } from "./types";

export type ClusteredInkResult = {
  lines: StrokeLineCluster[];
  overallBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  derivedFontSize: number;
};

type StrokeWithBounds = {
  element: ExcalidrawFreeDrawElement;
  stroke: InkStroke;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  height: number;
  centerY: number;
};

export const freedrawElementToInkStroke = (
  element: ExcalidrawFreeDrawElement,
  startEpochMs = 0,
): InkStroke => {
  const points: InkPoint[] = [];
  const originX = element.x;
  const originY = element.y;
  let currentTimestamp = startEpochMs;

  for (let i = 0; i < element.points.length; i++) {
    const pt = element.points[i];
    points.push({
      x: originX + pt[0],
      y: originY + pt[1],
      t: currentTimestamp,
    });
    // Synthesize evenly spaced 16ms timestamps (approx 60Hz) for digital ink APIs
    currentTimestamp += 16;
  }

  return { points };
};

export const clusterFreedrawElements = (
  elements: readonly ExcalidrawFreeDrawElement[],
): ClusteredInkResult => {
  if (elements.length === 0) {
    return {
      lines: [],
      overallBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      derivedFontSize: 20,
    };
  }

  let totalEpoch = 0;
  const strokeData: StrokeWithBounds[] = [];
  let globalMinX = Infinity;
  let globalMinY = Infinity;
  let globalMaxX = -Infinity;
  let globalMaxY = -Infinity;

  for (const element of elements) {
    if (!element.points || element.points.length === 0) {
      continue;
    }

    const stroke = freedrawElementToInkStroke(element, totalEpoch);
    totalEpoch += stroke.points.length * 16 + 50; // brief gap between strokes

    let sMinX = Infinity;
    let sMinY = Infinity;
    let sMaxX = -Infinity;
    let sMaxY = -Infinity;

    for (const p of stroke.points) {
      if (p.x < sMinX) { sMinX = p.x; }
      if (p.x > sMaxX) { sMaxX = p.x; }
      if (p.y < sMinY) { sMinY = p.y; }
      if (p.y > sMaxY) { sMaxY = p.y; }
    }

    const height = Math.max(1, sMaxY - sMinY);
    const centerY = (sMinY + sMaxY) / 2;

    if (sMinX < globalMinX) { globalMinX = sMinX; }
    if (sMinY < globalMinY) { globalMinY = sMinY; }
    if (sMaxX > globalMaxX) { globalMaxX = sMaxX; }
    if (sMaxY > globalMaxY) { globalMaxY = sMaxY; }

    strokeData.push({
      element,
      stroke,
      minX: sMinX,
      minY: sMinY,
      maxX: sMaxX,
      maxY: sMaxY,
      height,
      centerY,
    });
  }

  if (strokeData.length === 0) {
    return {
      lines: [],
      overallBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      derivedFontSize: 20,
    };
  }

  // Calculate median stroke height (ignoring dots < 3px)
  const nonDotHeights = strokeData
    .map((s) => s.height)
    .filter((h) => h >= 3)
    .sort((a, b) => a - b);
  const medianHeight =
    nonDotHeights.length > 0
      ? nonDotHeights[Math.floor(nonDotHeights.length / 2)]
      : 24;

  // Sort strokes vertically by their center Y
  const sortedStrokes = [...strokeData].sort((a, b) => a.centerY - b.centerY);

  // Group into line clusters by vertical overlap
  type MutableLineCluster = {
    strokes: StrokeWithBounds[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };

  const lineClusters: MutableLineCluster[] = [];

  for (const item of sortedStrokes) {
    let matchedCluster: MutableLineCluster | null = null;

    for (const cluster of lineClusters) {
      const clusterHeight = cluster.maxY - cluster.minY;
      const clusterCenterY = (cluster.minY + cluster.maxY) / 2;
      const overlapTop = Math.max(cluster.minY, item.minY);
      const overlapBottom = Math.min(cluster.maxY, item.maxY);
      const overlap = Math.max(0, overlapBottom - overlapTop);
      const minSpan = Math.min(clusterHeight, item.height);

      const hasSignificantOverlap = minSpan > 0 && overlap / minSpan >= 0.35;
      const isWithinVerticalDistance =
        Math.abs(clusterCenterY - item.centerY) <=
        0.55 * Math.max(medianHeight, clusterHeight);

      if (hasSignificantOverlap || isWithinVerticalDistance) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.strokes.push(item);
      if (item.minX < matchedCluster.minX) { matchedCluster.minX = item.minX; }
      if (item.minY < matchedCluster.minY) { matchedCluster.minY = item.minY; }
      if (item.maxX > matchedCluster.maxX) { matchedCluster.maxX = item.maxX; }
      if (item.maxY > matchedCluster.maxY) { matchedCluster.maxY = item.maxY; }
    } else {
      lineClusters.push({
        strokes: [item],
        minX: item.minX,
        minY: item.minY,
        maxX: item.maxX,
        maxY: item.maxY,
      });
    }
  }

  // Sort line clusters top-to-bottom by top Y
  lineClusters.sort((a, b) => a.minY - b.minY);

  // For each line cluster, sort strokes left-to-right by start X
  const finalClusters: StrokeLineCluster[] = lineClusters.map((cluster) => {
    cluster.strokes.sort((a, b) => a.minX - b.minX);
    return {
      strokes: cluster.strokes.map((s) => s.stroke),
      bounds: {
        minX: cluster.minX,
        minY: cluster.minY,
        maxX: cluster.maxX,
        maxY: cluster.maxY,
        width: Math.max(1, cluster.maxX - cluster.minX),
        height: Math.max(1, cluster.maxY - cluster.minY),
      },
    };
  });

  const overallBounds = {
    minX: globalMinX,
    minY: globalMinY,
    maxX: globalMaxX,
    maxY: globalMaxY,
    width: Math.max(1, globalMaxX - globalMinX),
    height: Math.max(1, globalMaxY - globalMinY),
  };

  // Derive font size: median line height divided by Excalifont ratio ~1.25, clamped to 16..48px
  const lineHeights = finalClusters.map((c) => c.bounds.height);
  const avgLineHeight =
    lineHeights.reduce((acc, h) => acc + h, 0) / Math.max(1, lineHeights.length);
  const rawSize = Math.round(avgLineHeight / 1.25);
  const derivedFontSize = Math.min(48, Math.max(16, rawSize));

  return {
    lines: finalClusters,
    overallBounds,
    derivedFontSize,
  };
};

