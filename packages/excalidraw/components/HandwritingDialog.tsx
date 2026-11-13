import React, { useEffect, useState, useCallback, useRef } from "react";
import { DEFAULT_FONT_FAMILY, FONT_FAMILY } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  isFreeDrawElement,
  newElementWith,
  newTextElement,
} from "@excalidraw/element";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  FontFamilyValues,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppClassProperties } from "../types";
import { Dialog } from "./Dialog";
import { clusterFreedrawElements } from "../handwriting/clustering";
import { getHandwritingEngine } from "../handwriting/engine";
import "./HandwritingDialog.scss";

type HandwritingDialogProps = {
  app: AppClassProperties;
  onClose: () => void;
};

export const HandwritingDialog = ({ app, onClose }: HandwritingDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [candidateList, setCandidateList] = useState<string[]>([]);
  const [fontFamily, setFontFamily] = useState<FontFamilyValues>(DEFAULT_FONT_FAMILY);
  const [fontSize, setFontSize] = useState<number>(20);
  const [overallBounds, setOverallBounds] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  }>({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });

  const freedrawElementsRef = useRef<NonDeleted<ExcalidrawFreeDrawElement>[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runRecognition = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const openDialog = app.state.openDialog;
      const targetIds =
        openDialog?.name === "handwritingToText" &&
        openDialog.sourceElementIds &&
        openDialog.sourceElementIds.length > 0
          ? new Set(openDialog.sourceElementIds)
          : null;

      const allElements = app.scene.getElementsIncludingDeleted();
      const selectedElements: NonDeleted<ExcalidrawFreeDrawElement>[] = [];
      for (const el of allElements) {
        if (!el.isDeleted && isFreeDrawElement(el)) {
          if (targetIds ? targetIds.has(el.id) : Boolean(app.state.selectedElementIds[el.id])) {
            selectedElements.push(el as NonDeleted<ExcalidrawFreeDrawElement>);
          }
        }
      }

      if (selectedElements.length === 0) {
        setError("No freedraw handwriting strokes selected.");
        setLoading(false);
        return;
      }

      freedrawElementsRef.current = selectedElements;

      const clustered = clusterFreedrawElements(selectedElements);
      setOverallBounds(clustered.overallBounds);
      setFontSize(clustered.derivedFontSize);

      const engine = await getHandwritingEngine();

      // Recognize each line cluster sequentially or in parallel
      const linePromises = clustered.lines.map(async (lineCluster) => {
        const result = await engine.recognize(lineCluster.strokes);
        return result.candidates[0] || "";
      });

      const recognizedLines = await Promise.all(linePromises);
      const combinedText = recognizedLines.join("\n").trim();

      // Also get alternative candidate suggestions for the entire ink set
      const allStrokes = clustered.lines.flatMap((l) => l.strokes);
      const fullResult = await engine.recognize(allStrokes);
      const filteredCandidates = (fullResult.candidates || []).filter(
        (c) => Boolean(c) && c !== combinedText,
      );

      setRecognizedText(combinedText || "Recognized Text");
      setCandidateList(filteredCandidates.slice(0, 5));
      setLoading(false);
    } catch (err: any) {
      console.error("Handwriting recognition failed:", err);
      setError(
        err?.message ||
          "Recognition failed. Please make sure the handwriting model is available.",
      );
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    runRecognition();
  }, [runRecognition]);

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  const handleConvert = () => {
    if (!recognizedText.trim() || freedrawElementsRef.current.length === 0) {
      onClose();
      return;
    }

    const firstElement = freedrawElementsRef.current[0];
    const strokeColor = firstElement.strokeColor || "#000000";

    const textElement = newTextElement({
      text: recognizedText,
      fontSize,
      fontFamily,
      x: overallBounds.minX,
      y: overallBounds.minY,
      strokeColor,
    });

    const deletedIds = new Set(freedrawElementsRef.current.map((el) => el.id));
    const allElements = app.scene.getElementsIncludingDeleted();

    const nextElements: readonly ExcalidrawElement[] = [
      ...allElements.map((el) => {
        if (deletedIds.has(el.id)) {
          return newElementWith(el, { isDeleted: true });
        }
        return el;
      }),
      textElement,
    ];

    // Atomically commit to scene as exactly ONE undo/redo history entry
    app.api.updateScene({
      elements: nextElements,
      appState: {
        selectedElementIds: { [textElement.id]: true },
        openDialog: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  return (
    <Dialog
      className="HandwritingDialog"
      size="small"
      title="Convert Handwriting to Text"
      onCloseRequest={onClose}
    >
      {loading ? (
        <div className="HandwritingDialog__loading">
          <div className="spinner" />
          <div>Recognizing handwriting on-device...</div>
        </div>
      ) : error ? (
        <div className="HandwritingDialog__error">
          <div>{error}</div>
          <div className="HandwritingDialog__actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={runRecognition}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="HandwritingDialog__editor">
            <label htmlFor="handwriting-text-input">Recognized Text</label>
            <textarea
              id="handwriting-text-input"
              ref={textareaRef}
              value={recognizedText}
              onChange={(e) => setRecognizedText(e.target.value)}
              placeholder="Enter recognized text"
            />
          </div>

          {candidateList.length > 0 && (
            <div className="HandwritingDialog__candidates">
              <div className="HandwritingDialog__candidates-title">
                Alternative suggestions:
              </div>
              <div className="HandwritingDialog__candidates-list">
                {candidateList.map((cand, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="HandwritingDialog__candidates-chip"
                    onClick={() => setRecognizedText(cand)}
                  >
                    {cand}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="HandwritingDialog__options">
            <div className="HandwritingDialog__options-group">
              <label htmlFor="handwriting-font-family">Font Family</label>
              <select
                id="handwriting-font-family"
                value={fontFamily}
                onChange={(e) => setFontFamily(Number(e.target.value) as FontFamilyValues)}
              >
                <option value={FONT_FAMILY.Excalifont}>Excalifont (Hand-drawn)</option>
                <option value={FONT_FAMILY.Nunito}>Nunito</option>
                <option value={FONT_FAMILY["Comic Shanns"]}>Comic Shanns</option>
              </select>
            </div>

            <div className="HandwritingDialog__options-group">
              <label htmlFor="handwriting-font-size">Font Size (px)</label>
              <input
                id="handwriting-font-size"
                type="number"
                min={12}
                max={96}
                value={fontSize}
                onChange={(e) => setFontSize(Math.max(10, Number(e.target.value)))}
              />
            </div>
          </div>

          <div className="HandwritingDialog__actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!recognizedText.trim()}
              onClick={handleConvert}
            >
              Convert
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
};
