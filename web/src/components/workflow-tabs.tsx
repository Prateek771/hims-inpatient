"use client";

import { useRef, useState, type ReactNode } from "react";

export type WorkflowTab = { id: string; label: string; children: ReactNode };

export function WorkflowTabs({
  id,
  items,
  initialTab,
  beforeTabs,
}: {
  id: string;
  items: WorkflowTab[];
  initialTab?: string;
  beforeTabs?: ReactNode;
}) {
  const [selection, setSelection] = useState({
    initialTab,
    selected: initialTab ?? items[0]?.id,
  });
  // Same-record deep links change selection without replacing the mounted panels.
  if (selection.initialTab !== initialTab) {
    setSelection({ initialTab, selected: initialTab ?? items[0]?.id });
  }
  function setSelected(selected: string) {
    setSelection({ initialTab, selected });
  }
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const active = items.some((item) => item.id === selection.selected)
    ? selection.selected
    : items[0]?.id;

  if (!items.length) return null;
  return (
    <div
      className="workflow-tabs"
      onClickCapture={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!(event.target instanceof Element)) return;
        const link = event.target.closest<HTMLAnchorElement>("a[data-workflow-tab]");
        if (!link || !event.currentTarget.contains(link) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
        const index = items.findIndex((item) => item.id === link.dataset.workflowTab);
        if (index < 0) return;
        let targetId: string | undefined;
        try {
          const decoded = decodeURIComponent(link.hash.slice(1));
          if (decoded && !/[\u0000-\u001f\u007f]/.test(decoded)) targetId = decoded;
        } catch { /* A malformed fragment still opens its valid tab. */ }
        // Capture precedes Next Link's navigation handler, keeping the same-record drafts mounted.
        event.preventDefault();
        setSelected(items[index].id);
        buttons.current[index]?.focus({ preventScroll: Boolean(targetId) });
        if (targetId) {
          const fragmentId = targetId;
          const container = event.currentTarget;
          const panelId = `${id}-panel-${items[index].id}`;
          requestAnimationFrame(() => {
            const target = document.getElementById(fragmentId);
            const panel = document.getElementById(panelId);
            if (target && panel && container.contains(panel) && panel.contains(target) && target.getClientRects().length) {
              target.scrollIntoView({ block: "start", behavior: "auto" });
            }
          });
        }
      }}
    >
      {beforeTabs}
      <div className="workflow-tablist" role="tablist" aria-label="Work sections">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(button) => { buttons.current[index] = button; }}
            type="button"
            role="tab"
            id={`${id}-tab-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={active === item.id}
            tabIndex={active === item.id ? 0 : -1}
            onClick={() => setSelected(item.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % items.length;
              else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = items.length - 1;
              else return;
              event.preventDefault();
              setSelected(items[next].id);
              buttons.current[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          className="workflow-panel"
          key={item.id}
          role="tabpanel"
          id={`${id}-panel-${item.id}`}
          aria-labelledby={`${id}-tab-${item.id}`}
          hidden={active !== item.id}
          tabIndex={0}
        >
          {item.children}
        </div>
      ))}
    </div>
  );
}
