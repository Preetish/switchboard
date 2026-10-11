"use client";

import { useState } from "react";
import styles from "../admin.module.css";

/** Copies a value (a rep's connect link) and confirms in place. */
export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.buttonSecondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (insecure origin): fall back to a prompt the
          // admin can copy from manually.
          window.prompt("Copy this link:", value);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
