import React from "react";
import { KEYS } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";
import { getSelectedElements } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  NonDeleted,
} from "@excalidraw/element/types";
import { IconButton } from "../components/IconButton";
import { HandwritingToTextIcon } from "../components/icons";
import { t } from "../i18n";
import { register } from "./register";

export const hasFreedrawSelection = (
  elements: readonly ExcalidrawElement[],
  appState: { selectedElementIds: Readonly<{ [id: string]: true }> },
): boolean => {
  const selected = getSelectedElements(elements, appState);
  return selected.some(
    (el): el is NonDeleted<ExcalidrawFreeDrawElement> =>
      el.type === "freedraw" && !el.isDeleted,
  );
};

export const actionHandwritingToText = register({
  name: "convertHandwritingToText",
  label: "labels.handwritingToText",
  icon: HandwritingToTextIcon,
  viewMode: false,
  trackEvent: {
    category: "element",
    action: "convert_handwriting_to_text",
  },
  keywords: ["handwriting", "ink", "convert", "text", "pen", "ocr"],
  keyTest: (event) =>
    event[KEYS.CTRL_OR_CMD] && event.altKey && event.key.toLowerCase() === "h",
  perform(_elements, appState) {
    const sourceElementIds = Object.keys(appState.selectedElementIds);
    return {
      appState: {
        ...appState,
        openDialog: {
          name: "handwritingToText",
          sourceElementIds,
        },
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  predicate: (elements, appState, _appProps, _app) =>
    hasFreedrawSelection(elements, appState),
  PanelComponent: ({ elements, appState, updateData }) => {
    return (
      <IconButton
        type="button"
        icon={HandwritingToTextIcon}
        title={t("labels.handwritingToText")}
        aria-label={t("labels.handwritingToText")}
        onClick={(event) => {
          event.stopPropagation();
          updateData(null);
        }}
        disabled={!hasFreedrawSelection(elements, appState)}
      />
    );
  },
});
