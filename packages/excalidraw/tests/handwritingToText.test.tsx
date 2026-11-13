import React from "react";
import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import { Excalidraw } from "../index";
import { actionHandwritingToText } from "../actions/actionHandwritingToText";
import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

describe("handwriting to text conversion", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("checks predicate: only active when freedraw elements are selected", () => {
    // When nothing is selected
    expect(actionHandwritingToText.predicate!(h.elements, h.state, {} as any, h.app)).toBe(false);

    // When a rectangle is selected
    const rect = UI.createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 });
    API.setSelectedElements([rect.get()] as NonDeletedExcalidrawElement[]);
    expect(actionHandwritingToText.predicate!(h.elements, h.state, {} as any, h.app)).toBe(false);

    // When a freedraw element is selected
    const freedraw = UI.createElement("freedraw", { x: 20, y: 20 });
    API.setSelectedElements([freedraw.get()] as NonDeletedExcalidrawElement[]);
    expect(actionHandwritingToText.predicate!(h.elements, h.state, {} as any, h.app)).toBe(true);
  });

  it("opens handwriting to text dialog and converts strokes into a text element with undo capability", async () => {
    const freedraw = UI.createElement("freedraw", { x: 100, y: 150 });
    API.setSelectedElements([freedraw.get()] as NonDeletedExcalidrawElement[]);

    // Execute the action
    act(() => {
      h.app.actionManager.executeAction(actionHandwritingToText);
    });

    expect(h.state.openDialog?.name).toBe("handwritingToText");

    // Wait for the dialog to load the mock recognition
    const convertBtn = await screen.findByRole("button", { name: "Convert" });
    expect(convertBtn).not.toBeNull();

    // Verify textarea is present with recognized text
    const textarea = screen.getByLabelText("Recognized Text") as HTMLTextAreaElement;
    expect(textarea.value).toBeTruthy();

    // Click Convert
    fireEvent.click(convertBtn);

    // Dialog should be closed
    expect(h.state.openDialog).toBeNull();

    // The freedraw stroke should now be deleted, and a new text element should exist
    const elements = h.elements;
    const activeFreedraw = elements.find(
      (el) => el.type === "freedraw" && !el.isDeleted,
    );
    expect(activeFreedraw).toBeUndefined();

    const activeText = elements.find(
      (el) => el.type === "text" && !el.isDeleted,
    ) as ExcalidrawTextElement;
    expect(activeText).toBeDefined();
    expect(activeText.type).toBe("text");
    expect(activeText.x).toBeGreaterThanOrEqual(100);
    expect(activeText.y).toBeGreaterThanOrEqual(150);

    // Single undo step should restore the freedraw element and remove the text element
    act(() => {
      Keyboard.undo();
    });

    const elementsAfterUndo = h.elements;
    const restoredFreedraw = elementsAfterUndo.find(
      (el) => el.type === "freedraw" && !el.isDeleted,
    );
    expect(restoredFreedraw).toBeDefined();

    const textAfterUndo = elementsAfterUndo.find(
      (el) => el.type === "text" && !el.isDeleted,
    );
    expect(textAfterUndo).toBeUndefined();
  });
});
