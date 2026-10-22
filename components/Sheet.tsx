"use client";

import { useEffect, useId, useRef } from "react";

// Only the top sheet is shown. Keeping a suspended sheet mounted preserves
// its inputs, scroll position and focused action when player details return.
const sheets: HTMLDialogElement[] = [];
let bodyLock: { scrollY: number; styles: { position: string; top: string; width: string; overflow: string } } | null = null;

export default function Sheet({
  title,
  onClose,
  children,
  tall = false,
  closeLabel = "Close",
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  tall?: boolean;
  closeLabel?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropPress = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = sheets.at(-1);
    previous?.close();
    sheets.push(dialog);

    // Fixing the body also prevents background scrolling in mobile Safari.
    const bodyStyle = document.body.style;
    if (!bodyLock) {
      bodyLock = { scrollY: window.scrollY, styles: { position: bodyStyle.position, top: bodyStyle.top, width: bodyStyle.width, overflow: bodyStyle.overflow } };
      bodyStyle.position = "fixed";
      bodyStyle.top = `-${bodyLock.scrollY}px`;
      bodyStyle.width = "100%";
      bodyStyle.overflow = "hidden";
    }
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const wasTop = sheets.at(-1) === dialog;
      sheets.splice(sheets.indexOf(dialog), 1);
      dialog.close();
      if (sheets.length === 0 && bodyLock) {
        const { scrollY, styles } = bodyLock;
        bodyLock = null;
        Object.assign(bodyStyle, styles);
        window.scrollTo({ top: scrollY, behavior: "instant" });
      }
      if (wasTop) {
        const next = sheets.at(-1);
        if (next?.isConnected) next.showModal();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`app-sheet ${tall ? "h-[85dvh]" : "max-h-[88dvh]"}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
        )].filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        backdropPress.current = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropPress.current) onClose();
        backdropPress.current = false;
      }}
    >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-2">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
            aria-label={closeLabel}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </dialog>
  );
}
