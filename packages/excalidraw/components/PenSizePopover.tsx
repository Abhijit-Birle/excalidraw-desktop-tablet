import React, { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import { Popover } from "radix-ui";

import {
  FREEDRAW_STROKE_WIDTH,
  type StrokeWidthKey,
  type PenPressureSensitivity,
} from "@excalidraw/common";

import { actionChangeStrokeWidth } from "../actions/actionProperties";
import { t } from "../i18n";

import { useExcalidrawContainer, useExcalidrawActionManager } from "./App";
import { Range } from "./Range";

import "./PenSizePopover.scss";

import type { AppClassProperties, UIAppState, AppState } from "../types";

type PenSizePopoverProps = {
  app: AppClassProperties;
  appState: UIAppState;
  setAppState: React.Component<any, AppState>["setState"];
};

const PRESETS: Array<{
  key: StrokeWidthKey;
  label: string;
  dotPx: number;
  width: number;
}> = [
  {
    key: "hairline",
    label: "Hairline",
    dotPx: 3,
    width: 0.25,
  },
  {
    key: "thin",
    label: "Thin",
    dotPx: 5,
    width: 0.5,
  },
  {
    key: "medium",
    label: "Medium",
    dotPx: 8,
    width: 1.0,
  },
  {
    key: "bold",
    label: "Bold",
    dotPx: 12,
    width: 2.0,
  },
];

const SENSITIVITIES: Array<{
  key: PenPressureSensitivity;
  label: string;
  desc: string;
}> = [
  { key: "light", label: "Light", desc: "Flattest" },
  { key: "standard", label: "Standard", desc: "1:1" },
  { key: "heavy", label: "Heavy", desc: "Dynamic" },
];

export const PenSizePopover = ({
  app,
  appState,
  setAppState,
}: PenSizePopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { container } = useExcalidrawContainer();
  const actionManager = useExcalidrawActionManager();
  const currentKey = appState.currentItemStrokeWidthKey ?? "thin";
  const currentSensitivity = appState.penPressureSensitivity ?? "standard";

  // Dismiss popover on canvas pointer down so it doesn't linger
  useEffect(() => {
    const unsubscribe = app.onPointerDownEmitter?.on(() => {
      setIsOpen(false);
    });
    return () => unsubscribe?.();
  }, [app]);

  const applyStrokeWidth = useCallback(
    (key: StrokeWidthKey) => {
      const selectedElements = app.scene.getSelectedElements(appState);
      if (selectedElements.length > 0) {
        actionManager.executeAction(actionChangeStrokeWidth, "ui", key);
      } else {
        setAppState({ currentItemStrokeWidthKey: key });
      }
    },
    [actionManager, app, appState, setAppState],
  );

  const applySensitivity = useCallback(
    (sensitivity: PenPressureSensitivity) => {
      setAppState({ penPressureSensitivity: sensitivity });
    },
    [setAppState],
  );

  const currentPresetWidth = FREEDRAW_STROKE_WIDTH[currentKey] ?? 0.5;

  const handleSliderChange = useCallback(
    (val: number) => {
      // Map continuous slider (0.25 - 2.0) to the nearest preset
      let targetKey: StrokeWidthKey = "thin";
      if (val <= 0.35) {
        targetKey = "hairline";
      } else if (val <= 0.75) {
        targetKey = "thin";
      } else if (val <= 1.5) {
        targetKey = "medium";
      } else {
        targetKey = "bold";
      }
      applyStrokeWidth(targetKey);
    },
    [applyStrokeWidth],
  );

  const triggerIndicatorDotSize =
    currentKey === "hairline"
      ? 4
      : currentKey === "thin"
      ? 6
      : currentKey === "medium"
      ? 9
      : 12;

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={clsx(
            "ToolIcon_type_button ToolIcon_size_medium ToolIcon__pen-size-trigger",
            {
              "ToolIcon_type_button--active": isOpen,
            },
          )}
          title={t("toolBar.penSize") || "Pen size & pressure"}
          aria-label={t("toolBar.penSize") || "Pen size & pressure"}
          data-testid="toolbar-pen-size"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
        >
          <div className="ToolIcon__icon">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Stylus / pen nib icon */}
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              {/* Dynamic dot preview */}
              <circle
                cx="19"
                cy="5"
                r={triggerIndicatorDotSize / 2}
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </div>
        </button>
      </Popover.Trigger>

      <Popover.Content
        className="pen-size-popover-content"
        sideOffset={14}
        collisionBoundary={container ?? undefined}
        onPointerDownOutside={(event) => {
          // Prevent the outside tap from initiating drawing on canvas
          event.preventDefault();
          setIsOpen(false);
        }}
      >
        {/* Size Presets */}
        <div className="pen-size-popover__section">
          <span className="pen-size-popover__section-header">
            {t("labels.strokeWidth") || "Pen Size"}
          </span>
          <div className="pen-size-popover__presets">
            {PRESETS.map((preset) => {
              const active = currentKey === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={clsx("pen-size-popover__preset-btn", {
                    active,
                  })}
                  data-testid={`pen-size-preset-${preset.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    applyStrokeWidth(preset.key);
                  }}
                  title={`${preset.label} (${preset.width}px)`}
                >
                  <span
                    className="preset-dot"
                    style={{
                      width: `${preset.dotPx}px`,
                      height: `${preset.dotPx}px`,
                    }}
                  />
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thickness Slider */}
        <div className="pen-size-popover__section pen-size-popover__slider">
          <Range
            label={
              <span>
                Thickness: <strong>{currentPresetWidth.toFixed(2)}px</strong>
              </span>
            }
            value={currentPresetWidth}
            onChange={handleSliderChange}
            min={0.25}
            max={2.0}
            step={0.05}
            minLabel="0.25"
            testId="pen-size-range-slider"
          />
        </div>

        {/* Pressure Sensitivity */}
        <div className="pen-size-popover__section">
          <span className="pen-size-popover__section-header">
            Pressure Sensitivity
          </span>
          <div className="pen-size-popover__sensitivities">
            {SENSITIVITIES.map((sens) => {
              const active = currentSensitivity === sens.key;
              return (
                <button
                  key={sens.key}
                  type="button"
                  className={clsx("pen-size-popover__sensitivity-btn", {
                    active,
                  })}
                  data-testid={`pen-pressure-${sens.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    applySensitivity(sens.key);
                  }}
                >
                  <span className="sensitivity-name">{sens.label}</span>
                  <span className="sensitivity-desc">{sens.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};
