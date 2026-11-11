import { within } from "@testing-library/react";

import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { HelpDialog } from "@excalidraw/excalidraw/components/HelpDialog";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExcalidrawApp from "../App";
import { RecentFilesDialog } from "../components/RecentFilesDialog";
import { RecentFiles } from "../data/recentFiles";

const { h } = window;

const seedEntry = async (id: string, name: string) => {
  await RecentFiles.saveSnapshot({
    sceneId: id,
    elements: [API.createElement({ type: "rectangle", id: `rect-${id}` })],
    appState: {
      ...getDefaultAppState(),
      name,
    },
    files: {},
    skipThumbnail: true,
  });
};

describe("RecentFilesDialog & App integration", () => {
  beforeEach(async () => {
    await RecentFiles.clearRecentFiles();
    localStorage.clear();
  });

  it("renders friendly empty state and + New button when no recent files exist", async () => {
    const onNewDiagram = vi.fn();

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={false}
          onClose={() => {}}
          onNewDiagram={onNewDiagram}
          onOpenRecord={() => {}}
        />
      </Excalidraw>,
    );

    await waitFor(() => {
      expect(screen.getByText("No recent files yet")).toBeInTheDocument();
    });

    const newButton = screen.getByRole("button", { name: "+ New" });
    fireEvent.click(newButton);
    await waitFor(() => {
      expect(onNewDiagram).toHaveBeenCalledTimes(1);
    });
  });

  it("opens, deletes single entry, and clears all entries with confirmation", async () => {
    await seedEntry("first", "Architecture");
    await new Promise((r) => setTimeout(r, 5));
    await seedEntry("second", "Flowchart");

    const onOpenRecord = vi.fn();

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={false}
          onClose={() => {}}
          onNewDiagram={() => {}}
          onOpenRecord={onOpenRecord}
        />
      </Excalidraw>,
    );

    await waitFor(() => {
      expect(screen.getByText("Flowchart")).toBeInTheDocument();
      expect(screen.getByText("Architecture")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Flowchart");
    expect(items[1]).toHaveTextContent("Architecture");

    const openButtons = screen.getAllByRole("button", { name: "Open" });
    fireEvent.click(openButtons[0]);
    await waitFor(() => {
      expect(onOpenRecord).toHaveBeenCalledTimes(1);
    });
    expect(onOpenRecord.mock.calls[0][0].id).toBe("second");

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("Flowchart")).toBeNull();
    });
    expect(screen.getByText("Architecture")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all?" }));

    await waitFor(() => {
      expect(screen.getByText("No recent files yet")).toBeInTheDocument();
    });
  });

  it("supports inline rename via Enter/Blur and Escape cancellation without closing the dialog", async () => {
    await seedEntry("rename-1", "Draft One");
    const onClose = vi.fn();

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={false}
          onClose={onClose}
          onNewDiagram={() => {}}
          onOpenRecord={() => {}}
        />
      </Excalidraw>,
    );

    await waitFor(() => {
      expect(screen.getByText("Draft One")).toBeInTheDocument();
    });

    // Escape cancels inline edit and does NOT close dialog
    fireEvent.click(
      screen.getByRole("button", { name: "Draft One — Diagram name" }),
    );
    const cancelInput = screen.getByRole("textbox", {
      name: "Diagram name",
    });
    fireEvent.change(cancelInput, { target: { value: "Should Not Save" } });
    fireEvent.keyDown(cancelInput, { key: "Escape" });

    expect(screen.getByText("Draft One")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Enter commits new name and persists to RecentFiles
    fireEvent.click(
      screen.getByRole("button", { name: "Draft One — Diagram name" }),
    );
    const commitInput = screen.getByRole("textbox", {
      name: "Diagram name",
    });
    fireEvent.change(commitInput, { target: { value: "Final System Map" } });
    fireEvent.keyDown(commitInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Final System Map")).toBeInTheDocument();
    });
    const saved = await RecentFiles.getRecentFile("rename-1");
    expect(saved?.name).toBe("Final System Map");

    // Blur commits edited name as well
    fireEvent.click(
      screen.getByRole("button", {
        name: "Final System Map — Diagram name",
      }),
    );
    const blurInput = screen.getByRole("textbox", {
      name: "Diagram name",
    });
    fireEvent.change(blurInput, { target: { value: "Final v2" } });
    fireEvent.blur(blurInput);

    await waitFor(() => {
      expect(screen.getByText("Final v2")).toBeInTheDocument();
    });
    expect((await RecentFiles.getRecentFile("rename-1"))?.name).toBe(
      "Final v2",
    );
  });

  it("blocks opening and creating recent files while collaborating", async () => {
    await seedEntry("collab-test", "Saved Diagram");
    const onOpenRecord = vi.fn();
    const onNewDiagram = vi.fn();

    await render(
      <Excalidraw>
        <RecentFilesDialog
          isOpen={true}
          isCollaborating={true}
          onClose={() => {}}
          onNewDiagram={onNewDiagram}
          onOpenRecord={onOpenRecord}
        />
      </Excalidraw>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Stop the active collaboration session before opening a recent file.",
        ),
      ).toBeInTheDocument();
    });

    const newButton = screen.getByRole("button", { name: "+ New" });
    expect(newButton).toBeDisabled();
    fireEvent.click(newButton);
    expect(onNewDiagram).not.toHaveBeenCalled();

    const openButton = screen.getByRole("button", { name: "Open" });
    expect(openButton).toBeDisabled();
    fireEvent.click(openButton);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it("shows New diagram directly above Recent files in main menu and HelpDialog shortcuts", async () => {
    const { container } = await render(<ExcalidrawApp />);

    const menuButton = container.querySelector(
      ".dropdown-menu-button",
    ) as HTMLElement;
    expect(menuButton).not.toBeNull();
    fireEvent.click(menuButton);

    await waitFor(() => {
      const dropdownMenu = screen.getByTestId("dropdown-menu");
      expect(within(dropdownMenu).getByText("New diagram")).toBeInTheDocument();
      expect(
        within(dropdownMenu).getByText("Recent files"),
      ).toBeInTheDocument();
    });

    const dropdownMenu = screen.getByTestId("dropdown-menu");
    const newDiagramEl = within(dropdownMenu).getByText("New diagram");
    const recentFilesEl = within(dropdownMenu).getByText("Recent files");
    expect(
      // eslint-disable-next-line no-bitwise
      newDiagramEl.compareDocumentPosition(recentFilesEl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.keyDown(window, {
      key: "O",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(screen.getByText("No recent files yet")).toBeInTheDocument();
    });

    await render(
      <Excalidraw>
        <HelpDialog onClose={() => {}} />
      </Excalidraw>,
    );

    expect(screen.getAllByText("New diagram").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recent files").length).toBeGreaterThan(0);
  });

  it("creates dated blank diagram on Ctrl/Cmd+Alt+N, avoids duplicate blanks, focuses canvas, and persists name across reload & rename", async () => {
    const { container, unmount } = await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(h.app).toBeDefined();
    });

    API.updateScene({
      elements: [API.createElement({ type: "rectangle", id: "rect-1" })],
      appState: { name: "Drawn Canvas" },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(() => {
      expect(h.elements).toHaveLength(1);
    });

    // Trigger New diagram via Ctrl/Cmd+Alt+N (using macOS Option+N code="KeyN")
    fireEvent.keyDown(window, {
      key: "Dead",
      code: "KeyN",
      ctrlKey: true,
      metaKey: true,
      altKey: true,
    });

    await waitFor(async () => {
      const list = await RecentFiles.listRecentFiles();
      expect(list).toHaveLength(2);
    });

    expect(h.elements).toHaveLength(0);
    expect(h.state.name).toMatch(/^Untitled-\d{4}-\d{2}-\d{2}$/);

    const editorContainer = container.querySelector(".excalidraw-container");
    expect(editorContainer).not.toBeNull();
    expect(document.activeElement).toBe(editorContainer);

    const listAfterFirstNew = await RecentFiles.listRecentFiles();
    expect(listAfterFirstNew[0].name).toMatch(/^Untitled-\d{4}-\d{2}-\d{2}$/);
    expect(listAfterFirstNew[0].elements).toEqual([]);
    expect(listAfterFirstNew[1].name).toBe("Drawn Canvas");
    expect(listAfterFirstNew[1].elements).toHaveLength(1);

    // Pressing Ctrl/Cmd+Alt+N again on the untouched empty canvas must NOT create a duplicate blank
    fireEvent.keyDown(window, {
      key: "n",
      ctrlKey: true,
      altKey: true,
    });

    await new Promise((r) => setTimeout(r, 30));
    const listAfterSecondNew = await RecentFiles.listRecentFiles();
    expect(listAfterSecondNew).toHaveLength(2);

    // Reloading restores the newly created diagram
    const createdName = h.state.name;
    unmount();

    await render(<ExcalidrawApp />);
    await waitFor(() => {
      expect(h.state.name).toBe(createdName);
    });
    expect(h.elements).toHaveLength(0);

    // Open RecentFilesDialog, inline-rename active blank diagram, and verify persistence across reload
    fireEvent.keyDown(window, {
      key: "O",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(screen.getByText(createdName!)).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `${createdName!} — Diagram name`,
      }),
    );
    const renameInput = screen.getByRole("textbox", { name: "Diagram name" });
    fireEvent.change(renameInput, { target: { value: "Persisted Rename" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Persisted Rename")).toBeInTheDocument();
      expect(h.state.name).toBe("Persisted Rename");
    });

    const renamedEntries = await RecentFiles.listRecentFiles();
    expect(renamedEntries[0].name).toBe("Persisted Rename");

    unmount();
    await render(<ExcalidrawApp />);
    await waitFor(() => {
      expect(h.state.name).toBe("Persisted Rename");
    });
    expect((await RecentFiles.listRecentFiles())[0].name).toBe(
      "Persisted Rename",
    );
  });

  it("snapshots drawn diagram and creates dated empty scene on Reset the canvas", async () => {
    await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(h.app).toBeDefined();
    });

    API.updateScene({
      elements: [API.createElement({ type: "diamond", id: "dia-1" })],
      appState: { name: "Before Reset" },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(() => {
      expect(h.elements).toHaveLength(1);
    });

    // Clear canvas directly via Excalidraw scene reset path (simulates Reset the canvas confirmation)
    API.updateScene({
      elements: [],
      appState: {
        ...getDefaultAppState(),
        name: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(async () => {
      const list = await RecentFiles.listRecentFiles();
      expect(list).toHaveLength(2);
    });

    const listAfterReset = await RecentFiles.listRecentFiles();
    expect(listAfterReset[0].name).toMatch(/^Untitled-\d{4}-\d{2}-\d{2}$/);
    expect(listAfterReset[1].name).toBe("Before Reset");
    expect(listAfterReset[1].elements).toHaveLength(1);
  });
});
