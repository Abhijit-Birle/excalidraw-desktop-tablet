import React, { useCallback, useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import {
  historyIcon,
  TrashIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { getShortcutKey } from "@excalidraw/excalidraw/shortcut";

import { RecentFiles } from "../data/recentFiles";

import "./RecentFilesDialog.scss";

import type { RecentFileRecord } from "../data/recentFiles";

type RecentFilesDialogProps = {
  isOpen: boolean;
  isCollaborating: boolean;
  onClose: () => void;
  onNewDiagram: () => Promise<void> | void;
  onOpenRecord: (record: RecentFileRecord) => Promise<void> | void;
  onRenameRecord?: (
    id: string,
    nextName: string,
  ) => Promise<RecentFileRecord | null> | RecentFileRecord | null;
};

const formatRelativeTime = (
  timestamp: number,
  nowMs: number,
  langCode: string,
  justNowLabel: string,
): string => {
  const diffSeconds = Math.round((timestamp - nowMs) / 1000);
  if (Math.abs(diffSeconds) < 45) {
    return justNowLabel;
  }

  if (
    typeof Intl !== "undefined" &&
    typeof Intl.RelativeTimeFormat === "function"
  ) {
    try {
      const rtf = new Intl.RelativeTimeFormat(langCode || "en", {
        numeric: "auto",
      });
      const diffMinutes = Math.round(diffSeconds / 60);
      if (Math.abs(diffMinutes) < 60) {
        return rtf.format(diffMinutes, "minute");
      }
      const diffHours = Math.round(diffSeconds / 3600);
      if (Math.abs(diffHours) < 24) {
        return rtf.format(diffHours, "hour");
      }
      const diffDays = Math.round(diffSeconds / 86400);
      if (Math.abs(diffDays) < 30) {
        return rtf.format(diffDays, "day");
      }
      const diffMonths = Math.round(diffSeconds / 2592000);
      if (Math.abs(diffMonths) < 12) {
        return rtf.format(diffMonths, "month");
      }
      return rtf.format(Math.round(diffSeconds / 31536000), "year");
    } catch {
      // fall back to formatted date string below
    }
  }

  return new Date(timestamp).toLocaleDateString();
};

const SWIPE_LOCK_THRESHOLD = 14;
const SWIPE_DELETE_THRESHOLD = 96;

type RecentFileCardProps = {
  record: RecentFileRecord;
  displayName: string;
  elementCountLabel: string;
  updatedLabel: string;
  isBusy: boolean;
  isOpening: boolean;
  isEditing: boolean;
  editingName: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (record: RecentFileRecord) => void;
  onDelete: (id: string) => void;
  onStartEditing: (record: RecentFileRecord, displayName: string) => void;
  onChangeEditingName: (value: string) => void;
  onCommitEditing: (record: RecentFileRecord) => void;
  onCancelEditing: () => void;
};

const RecentFileCard = ({
  record,
  displayName,
  elementCountLabel,
  updatedLabel,
  isBusy,
  isOpening,
  isEditing,
  editingName,
  renameInputRef,
  onOpen,
  onDelete,
  onStartEditing,
  onChangeEditingName,
  onCommitEditing,
  onCancelEditing,
}: RecentFileCardProps) => {
  const { t } = useI18n();
  const swipeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lockedAxis: "none" | "x" | "y";
  } | null>(null);
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);

  const resetSwipe = () => {
    swipeStateRef.current = null;
    setSwipeOffsetX(0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || isEditing || isOpening) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea")) {
      return;
    }
    swipeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lockedAxis: "none",
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = swipeStateRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;

    if (swipe.lockedAxis === "none") {
      if (Math.abs(dy) > SWIPE_LOCK_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
        swipe.lockedAxis = "y";
        return;
      }
      if (
        Math.abs(dx) > SWIPE_LOCK_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        swipe.lockedAxis = "x";
      } else {
        return;
      }
    }

    if (swipe.lockedAxis === "x") {
      setSwipeOffsetX(Math.min(0, Math.max(-160, dx)));
    }
  };

  const handlePointerUpOrCancel = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const swipe = swipeStateRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) {
      return;
    }
    const finalOffset =
      swipe.lockedAxis === "x" ? Math.min(0, event.clientX - swipe.startX) : 0;
    const shouldDelete =
      event.type === "pointerup" &&
      swipe.lockedAxis === "x" &&
      finalOffset <= -SWIPE_DELETE_THRESHOLD;
    resetSwipe();
    if (shouldDelete) {
      onDelete(record.id);
    }
  };

  return (
    <div
      className={`RecentFilesDialog__item ${
        swipeOffsetX <= -SWIPE_DELETE_THRESHOLD
          ? "RecentFilesDialog__item--swipeReady"
          : ""
      }`}
      role="listitem"
      style={
        swipeOffsetX !== 0
          ? { transform: `translateX(${swipeOffsetX}px)` }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
    >
      <button
        type="button"
        className="RecentFilesDialog__thumbnailButton"
        onClick={() => onOpen(record)}
        disabled={isBusy}
        aria-label={`${t("recentFiles.open")} ${displayName}`}
      >
        <div className="RecentFilesDialog__thumbnail">
          {record.thumbnail ? (
            <img src={record.thumbnail} alt="" />
          ) : (
            historyIcon
          )}
        </div>
      </button>

      <div className="RecentFilesDialog__meta">
        {isEditing ? (
          <input
            ref={renameInputRef}
            type="text"
            className="RecentFilesDialog__nameInput"
            aria-label={t("recentFiles.renameLabel")}
            value={editingName}
            onChange={(event) => onChangeEditingName(event.target.value)}
            onBlur={() => onCommitEditing(record)}
            onKeyDown={(event) => {
              if (event.key === KEYS.ENTER) {
                event.preventDefault();
                event.stopPropagation();
                onCommitEditing(record);
              } else if (event.key === KEYS.ESCAPE) {
                event.preventDefault();
                event.stopPropagation();
                event.nativeEvent.stopImmediatePropagation();
                onCancelEditing();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="RecentFilesDialog__nameButton"
            title={t("recentFiles.renameHint")}
            aria-label={`${displayName} — ${t("recentFiles.renameLabel")}`}
            disabled={isBusy}
            onClick={() => onStartEditing(record, displayName)}
          >
            <span className="RecentFilesDialog__name">{displayName}</span>
          </button>
        )}

        <span className="RecentFilesDialog__details">
          <span>{updatedLabel}</span>
          <span>•</span>
          <span>{elementCountLabel}</span>
        </span>
      </div>

      <div className="RecentFilesDialog__actions">
        <FilledButton
          label={t("recentFiles.open")}
          onClick={() => onOpen(record)}
          disabled={isBusy}
          status={isOpening ? "loading" : null}
        />
        <button
          type="button"
          className="RecentFilesDialog__deleteButton"
          onClick={() => onDelete(record.id)}
          aria-label={t("recentFiles.delete")}
          title={t("recentFiles.delete")}
          disabled={isOpening}
        >
          {TrashIcon}
        </button>
      </div>
    </div>
  );
};

export const RecentFilesDialog: React.FC<RecentFilesDialogProps> = ({
  isOpen,
  isCollaborating,
  onClose,
  onNewDiagram,
  onOpenRecord,
  onRenameRecord,
}) => {
  const { t, langCode } = useI18n();
  const [records, setRecords] = useState<RecentFileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameRef = useRef(false);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await RecentFiles.listRecentFiles();
      setRecords(items);
      setNowMs(Date.now());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setConfirmClearAll(false);
      setOpeningId(null);
      setIsCreating(false);
      setEditingId(null);
      setEditingName("");
      cancelRenameRef.current = false;
      return;
    }
    void loadRecords();
  }, [isOpen, loadRecords]);

  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  if (!isOpen) {
    return null;
  }

  const isBusy = isCollaborating || openingId !== null || isCreating;

  const handleNew = async () => {
    if (isBusy) {
      return;
    }
    setIsCreating(true);
    try {
      await onNewDiagram();
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpen = async (record: RecentFileRecord) => {
    if (isBusy) {
      return;
    }
    setOpeningId(record.id);
    try {
      await onOpenRecord(record);
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    await RecentFiles.deleteRecentFile(id);
    setRecords((prev) => prev.filter((item) => item.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setEditingName("");
    }
  };

  const handleClearAll = async () => {
    await RecentFiles.clearRecentFiles();
    setRecords([]);
    setConfirmClearAll(false);
    setEditingId(null);
    setEditingName("");
  };

  const startEditing = (record: RecentFileRecord, displayName: string) => {
    cancelRenameRef.current = false;
    setEditingId(record.id);
    setEditingName(displayName);
  };

  const cancelEditing = () => {
    cancelRenameRef.current = true;
    setEditingId(null);
    setEditingName("");
  };

  const commitEditing = async (record: RecentFileRecord) => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    if (editingId !== record.id) {
      return;
    }

    const trimmed = editingName.trim();
    setEditingId(null);
    setEditingName("");

    if (!trimmed || trimmed === record.name) {
      return;
    }

    const updated = onRenameRecord
      ? await onRenameRecord(record.id, trimmed)
      : await RecentFiles.renameRecentFile(record.id, trimmed);
    if (updated) {
      setRecords((prev) =>
        prev.map((item) => (item.id === record.id ? updated : item)),
      );
    }
  };

  const shortcutLabel = getShortcutKey("CtrlOrCmd+Shift+O");

  return (
    <Dialog
      className="RecentFilesDialog__dialog"
      size="regular"
      title={
        <div className="RecentFilesDialog__header">
          <span className="RecentFilesDialog__headerTitle">
            {t("recentFiles.title")}
          </span>
          <FilledButton
            variant="filled"
            color="primary"
            label={t("recentFiles.newButton")}
            onClick={handleNew}
            disabled={isBusy}
            status={isCreating ? "loading" : null}
          />
        </div>
      }
      onCloseRequest={onClose}
    >
      <div className="RecentFilesDialog">
        {isCollaborating && (
          <div className="RecentFilesDialog__banner" role="alert">
            {t("recentFiles.collabBlocked")}
          </div>
        )}

        {records.length > 0 && (
          <div className="RecentFilesDialog__toolbar">
            {confirmClearAll ? (
              <>
                <FilledButton
                  variant="outlined"
                  color="muted"
                  label={t("recentFiles.cancel")}
                  onClick={() => setConfirmClearAll(false)}
                />
                <FilledButton
                  variant="filled"
                  color="danger"
                  label={t("recentFiles.clearAllConfirm")}
                  onClick={handleClearAll}
                />
              </>
            ) : (
              <FilledButton
                variant="outlined"
                color="danger"
                label={t("recentFiles.clearAll")}
                onClick={() => setConfirmClearAll(true)}
              />
            )}
          </div>
        )}

        {!isLoading && records.length === 0 ? (
          <div className="RecentFilesDialog__empty">
            <div className="RecentFilesDialog__empty-icon">{historyIcon}</div>
            <h3 className="RecentFilesDialog__empty-title">
              {t("recentFiles.emptyTitle")}
            </h3>
            <p className="RecentFilesDialog__empty-description">
              {t("recentFiles.emptyDescription", { shortcut: shortcutLabel })}
            </p>
          </div>
        ) : (
          <div className="RecentFilesDialog__list" role="list">
            {records.map((record) => {
              const displayName =
                record.name && record.name !== "Untitled"
                  ? record.name
                  : t("recentFiles.untitled");
              const elementCountLabel =
                record.elements.length === 1
                  ? t("recentFiles.elementsCountSingle")
                  : t("recentFiles.elementsCount", {
                      count: record.elements.length,
                    });
              const updatedLabel = formatRelativeTime(
                record.updatedAt,
                nowMs,
                langCode,
                t("recentFiles.justNow"),
              );
              const isActionDisabled = isBusy;
              const isEditing = editingId === record.id;

              return (
                <RecentFileCard
                  key={record.id}
                  record={record}
                  displayName={displayName}
                  elementCountLabel={elementCountLabel}
                  updatedLabel={updatedLabel}
                  isBusy={isActionDisabled}
                  isOpening={openingId === record.id}
                  isEditing={isEditing}
                  editingName={editingName}
                  renameInputRef={renameInputRef}
                  onOpen={(rec) => void handleOpen(rec)}
                  onDelete={(id) => void handleDelete(id)}
                  onStartEditing={startEditing}
                  onChangeEditingName={setEditingName}
                  onCommitEditing={(rec) => void commitEditing(rec)}
                  onCancelEditing={cancelEditing}
                />
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
};
