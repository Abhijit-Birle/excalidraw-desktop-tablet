import React from "react";

import type {
  ExcalidrawFreeDrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

describe("pen size and pressure sensitivity", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("surfaces the pen size trigger when freedraw is active and adjusts presets", async () => {
    // Activate freedraw tool
    UI.clickTool("freedraw");
    expect(h.state.activeTool.type).toBe("freedraw");

    const penSizeTrigger = screen.getByTestId("toolbar-pen-size");
    expect(penSizeTrigger).not.toBeNull();

    // Open the pen size popover
    fireEvent.click(penSizeTrigger);

    // Verify all 4 size presets are rendered
    const hairlineBtn = screen.getByTestId("pen-size-preset-hairline");
    const thinBtn = screen.getByTestId("pen-size-preset-thin");
    const mediumBtn = screen.getByTestId("pen-size-preset-medium");
    const boldBtn = screen.getByTestId("pen-size-preset-bold");

    expect(hairlineBtn).not.toBeNull();
    expect(thinBtn).not.toBeNull();
    expect(mediumBtn).not.toBeNull();
    expect(boldBtn).not.toBeNull();

    // Select hairline preset
    fireEvent.click(hairlineBtn);
    expect(h.state.currentItemStrokeWidthKey).toBe("hairline");

    // Creating a freedraw element with hairline should produce strokeWidth 0.25
    const el = UI.createElement("freedraw", { x: 10, y: 10 });
    expect(
      (el.get() as unknown as ExcalidrawFreeDrawElement).strokeWidth,
    ).toBe(0.25);
  });

  it("updates stroke width on selected freedraw elements", async () => {
    const element = UI.createElement("freedraw", { x: 50, y: 50 });
    API.setSelectedElements([element.get()] as NonDeletedExcalidrawElement[]);

    UI.clickTool("freedraw");
    const penSizeTrigger = screen.getByTestId("toolbar-pen-size");
    fireEvent.click(penSizeTrigger);

    const boldBtn = screen.getByTestId("pen-size-preset-bold");
    fireEvent.click(boldBtn);

    expect((h.elements[0] as ExcalidrawFreeDrawElement).strokeWidth).toBe(2.0);
    expect(h.state.currentItemStrokeWidthKey).toBe("bold");

    const hairlineBtn = screen.getByTestId("pen-size-preset-hairline");
    fireEvent.click(hairlineBtn);

    expect((h.elements[0] as ExcalidrawFreeDrawElement).strokeWidth).toBe(0.25);
    expect(h.state.currentItemStrokeWidthKey).toBe("hairline");
  });

  it("switches pressure sensitivity mode between light, standard, and heavy", async () => {
    UI.clickTool("freedraw");
    const penSizeTrigger = screen.getByTestId("toolbar-pen-size");
    fireEvent.click(penSizeTrigger);

    const lightBtn = screen.getByTestId("pen-pressure-light");
    const heavyBtn = screen.getByTestId("pen-pressure-heavy");
    const standardBtn = screen.getByTestId("pen-pressure-standard");

    expect(h.state.penPressureSensitivity).toBe("standard");

    fireEvent.click(lightBtn);
    expect(h.state.penPressureSensitivity).toBe("light");

    fireEvent.click(heavyBtn);
    expect(h.state.penPressureSensitivity).toBe("heavy");

    fireEvent.click(standardBtn);
    expect(h.state.penPressureSensitivity).toBe("standard");
  });
});
