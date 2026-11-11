import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Excalidraw } from "../../packages/excalidraw";

import { RecentFiles, type RecentFileRecord } from "../data/recentFiles";

import { render } from "../../packages/excalidraw/tests/test-utils";

import { RecentFilesDialog } from "./RecentFilesDialog";

import type { AppState } from "../../packages/excalidraw/types";

const makeRecord = (id: string, name: string): RecentFileRecord => ({
  id,
  name,
  createdAt: 1_700_000_000_000,
  updatedAt: Date.now() - 60_000,
  thumbnail: null,
  elements: [],
  appState: {
    name,
    viewBackgroundColor: "#ffffff",
    gridSize: 20,
    gridStep: 5,
    gridModeEnabled: false,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as AppState["zoom"]["value"] },
  },
  files: {},
});

describe("RecentFilesDialog touch/tablet interactions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a card on leftward touch/pen swipe past threshold and ignores short swipes", async () => {
    const first = makeRecord("scene-1", "Diagram One");
    const second = makeRecord("scene-2", "Diagram Two");

    vi.spyOn(RecentFiles, "listRecentFiles").mockResolvedValue([first, second]);
    const deleteSpy = vi
      .spyOn(RecentFiles, "deleteRecentFile")
      .mockResolvedValue(true);

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={false}
          onClose={vi.fn()}
          onNewDiagram={vi.fn()}
          onOpenRecord={vi.fn()}
          onRenameRecord={vi.fn()}
        />
      </Excalidraw>,
    );

    const cards = await screen.findAllByRole("listitem");
    expect(cards).toHaveLength(2);

    // Short horizontal drag (< 96px) must NOT delete
    fireEvent.pointerDown(cards[0], {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerMove(cards[0], {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 100,
    });
    fireEvent.pointerUp(cards[0], {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 100,
    });
    expect(deleteSpy).not.toHaveBeenCalled();

    // Deep left swipe (>= 96px) deletes the record cleanly
    fireEvent.pointerDown(cards[0], {
      pointerId: 2,
      pointerType: "pen",
      clientX: 250,
      clientY: 100,
    });
    fireEvent.pointerMove(cards[0], {
      pointerId: 2,
      pointerType: "pen",
      clientX: 120,
      clientY: 102,
    });
    fireEvent.pointerUp(cards[0], {
      pointerId: 2,
      pointerType: "pen",
      clientX: 120,
      clientY: 102,
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("scene-1");
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
  });

  it("requires confirmation before Clear all deletes entries", async () => {
    vi.spyOn(RecentFiles, "listRecentFiles").mockResolvedValue([
      makeRecord("scene-1", "Diagram One"),
    ]);
    const clearSpy = vi
      .spyOn(RecentFiles, "clearRecentFiles")
      .mockResolvedValue(true);

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={false}
          onClose={vi.fn()}
          onNewDiagram={vi.fn()}
          onOpenRecord={vi.fn()}
          onRenameRecord={vi.fn()}
        />
      </Excalidraw>,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear all/i,
    });
    fireEvent.click(clearButton);
    expect(clearSpy).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole("button", {
      name: /delete all\?/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });
  });
});
