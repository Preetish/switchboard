"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./FormView.module.css";

/**
 * Lists longer than this get a search box at the top of the panel, so a
 * 200-entry country list stays usable; short lists open as a plain list.
 */
const SEARCH_THRESHOLD = 10;

/**
 * Custom dropdown for the form's select fields. The native <select> picker
 * looks and behaves differently on every device, and its long lists cannot
 * be searched on desktop. This follows the ARIA listbox pattern: a button
 * that opens a listbox, arrow-key navigation, Enter to choose, Escape to
 * close, and focus back on the button afterwards.
 */
export default function SelectField({
  id,
  options,
  value,
  onChange,
  invalid = false,
  describedBy,
  embedded = false,
  placeholder = "Choose one…",
}: {
  id: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  /** In an embed iframe the panel flows in the page instead of floating,
   *  so the host page's auto-height can grow with it instead of clipping. */
  embedded?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef("");

  const searchable = options.length > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || q === "") return options;
    return options.filter((option) => option.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const activeOption = visible[active];
  const activeId =
    open && activeOption ? `${id}-opt-${options.indexOf(activeOption)}` : undefined;

  function openPanel() {
    setQuery("");
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }

  function closePanel(focusButton = false) {
    setOpen(false);
    setQuery("");
    if (focusButton) buttonRef.current?.focus();
  }

  function choose(option: string) {
    onChange(option);
    closePanel(true);
  }

  // Focus the search box on open (long lists) and close on outside clicks.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        closePanel();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchable]);

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
        event.preventDefault();
        openPanel();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (visible.length > 0) setActive((a) => Math.min(a + 1, visible.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (visible.length > 0) setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        if (visible.length > 0) setActive(visible.length - 1);
        break;
      case "Enter":
        // Also stops Enter in the search box from submitting the form.
        event.preventDefault();
        if (activeOption) choose(activeOption);
        break;
      case "Escape":
        event.preventDefault();
        closePanel(true);
        break;
      case "Tab":
        closePanel();
        break;
      default:
        // Type-ahead on short lists: jump to the next matching option.
        if (!searchable && event.key.length === 1) {
          typeAhead.current += event.key.toLowerCase();
          const match = visible.findIndex((option) =>
            option.toLowerCase().startsWith(typeAhead.current),
          );
          if (match >= 0) setActive(match);
          window.setTimeout(() => (typeAhead.current = ""), 600);
        }
    }
  }

  return (
    <div className={styles.selectWrap} ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className={`${styles.input} ${styles.selectButton} sb-input`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={searchable ? undefined : activeId}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <span className={value ? undefined : styles.selectPlaceholder}>
          {value || placeholder}
        </span>
        <svg
          className={styles.selectChevron}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          className={`${styles.selectPanel} ${embedded ? styles.selectPanelEmbed : ""}`}
        >
          {searchable ? (
            <input
              ref={searchRef}
              className={styles.selectSearch}
              type="text"
              value={query}
              placeholder="Search…"
              aria-label="Search options"
              aria-activedescendant={activeId}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}
          <div role="listbox" ref={listRef} aria-labelledby={id}>
            {visible.length === 0 ? (
              <p className={styles.selectEmpty}>No matches</p>
            ) : (
              visible.map((option, index) => (
                <div
                  key={option}
                  id={`${id}-opt-${options.indexOf(option)}`}
                  data-index={index}
                  role="option"
                  aria-selected={option === value}
                  className={`${styles.selectOption} ${
                    index === active ? styles.selectOptionActive : ""
                  }`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onPointerEnter={() => setActive(index)}
                >
                  <span className={styles.selectCheck} aria-hidden="true">
                    {option === value ? "✓" : ""}
                  </span>
                  <span>{option}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
