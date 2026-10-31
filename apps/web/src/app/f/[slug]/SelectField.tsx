"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import formStyles from "./FormView.module.css";
import styles from "./SelectField.module.css";

/** Lists longer than this get a search box; shorter ones get type-ahead. */
const SEARCH_THRESHOLD = 10;
/** Pause after which type-ahead starts a new search, in ms. */
const TYPEAHEAD_RESET_MS = 500;
const PLACEHOLDER = "Choose one…";

type Item = { value: string; label: string; id: string };

/**
 * A select field with the same look on every device: a combobox button
 * (styled like the text fields) that opens a listbox panel. Reports the
 * chosen option string through `onChange`, exactly like the native select
 * it replaces ("" while nothing is chosen).
 *
 * The trigger is a <button> carrying role="combobox", the ARIA 1.2
 * select-only pattern: that role is what makes aria-activedescendant and
 * aria-required valid on it, while it keeps native button focus and clicks.
 */
export default function SelectField({
  id,
  labelId,
  options,
  value,
  onChange,
  required = false,
  invalid = false,
  describedBy,
  embedded = false,
}: {
  /** The trigger's id; the field's <label htmlFor> points at it. */
  id: string;
  labelId: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** In the embed the panel renders in flow, so the iframe grows to fit it. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index into `visible`, the options currently shown.
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ buffer: "", timer: undefined as number | undefined });

  const searchable = options.length > SEARCH_THRESHOLD;
  const listboxId = `${id}-listbox`;
  const items: Item[] = [
    // Optional fields can be cleared again, as with the native select.
    ...(required ? [] : [{ value: "", label: PLACEHOLDER }]),
    ...options.map((option) => ({ value: option, label: option })),
  ].map((item, index) => ({ ...item, id: `${id}-option-${index}` }));
  /** Substring match on the search text; the placeholder only shows unfiltered. */
  const matching = (text: string) => {
    const needle = text.trim().toLowerCase();
    return needle
      ? items.filter(
          (item) => item.value !== "" && item.label.toLowerCase().includes(needle),
        )
      : items;
  };
  const visible = matching(query);
  const active = open ? visible[activeIndex] : undefined;

  function openPanel(initialQuery = "") {
    setQuery(initialQuery);
    setActiveIndex(
      Math.max(
        0,
        matching(initialQuery).findIndex((item) => item.value === value),
      ),
    );
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(item: Item | undefined) {
    if (item && item.value !== value) onChange(item.value);
    close(true);
  }

  /**
   * Short lists: jump to the next option starting with what was typed.
   * Never filtered, so indexes into `items` are indexes into `visible`.
   */
  function typeAhead(key: string) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => (state.buffer = ""), TYPEAHEAD_RESET_MS);
    state.buffer += key.toLowerCase();
    // Repeating one letter cycles through the options that start with it.
    const first = state.buffer.charAt(0);
    const prefix = [...state.buffer].every((char) => char === first)
      ? first
      : state.buffer;
    const start = open ? activeIndex + (prefix.length === 1 ? 1 : 0) : 0;
    for (let step = 0; step < items.length; step++) {
      const index = (start + step) % items.length;
      const item = items[index];
      if (item && item.value !== "" && item.label.toLowerCase().startsWith(prefix)) {
        setActiveIndex(index);
        setOpen(true);
        return;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const inSearch = event.currentTarget === searchRef.current;
    const printable =
      event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openPanel();
      } else if (printable && searchable) {
        event.preventDefault();
        openPanel(event.key);
      } else if (printable) {
        event.preventDefault();
        openPanel();
        typeAhead(event.key);
      }
      return;
    }

    const last = visible.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, last));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(last, 0));
        return;
      case "Enter":
        event.preventDefault();
        choose(active);
        return;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        // Close and let focus move on. From the search box, step back to
        // the trigger first so focus doesn't fall off the removed panel.
        if (inSearch) {
          buttonRef.current?.focus();
          if (event.shiftKey) event.preventDefault();
        }
        close(false);
        return;
    }
    if (!inSearch && event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (!inSearch && printable) {
      event.preventDefault();
      typeAhead(event.key);
    }
  }

  // Long lists: typing goes straight into the search box.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  const activeId = active?.id;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  const chosen = items.find((item) => item.value === value && item.value !== "");

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        className={`${formStyles.input} sb-input ${styles.trigger}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeId}
        aria-required={required}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onClick={() => (open ? close(true) : openPanel())}
        onKeyDown={onKeyDown}
      >
        <span className={chosen ? styles.value : styles.placeholder}>
          {chosen?.label ?? PLACEHOLDER}
        </span>
        <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          className={`${styles.panel} ${embedded ? styles.inFlow : ""}`}
          // Keep focus on the trigger or search box while clicking options.
          onMouseDown={(event) => {
            if (event.target !== searchRef.current) event.preventDefault();
          }}
        >
          {searchable ? (
            <input
              ref={searchRef}
              type="text"
              className={`${formStyles.input} ${styles.search}`}
              placeholder="Search…"
              aria-label="Search options"
              aria-controls={listboxId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
            />
          ) : null}
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className={styles.list}
          >
            {visible.map((item, index) => {
              const selected = item.value === value;
              return (
                <li
                  key={item.id}
                  id={item.id}
                  role="option"
                  aria-selected={selected}
                  className={`${styles.option} ${index === activeIndex ? styles.active : ""} ${item.value === "" ? styles.placeholder : ""}`}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                >
                  <span>{item.label}</span>
                  {selected && item.value !== "" ? (
                    <svg className={styles.check} viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <p className={styles.empty} role="status">
              No matches
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
