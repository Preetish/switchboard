"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./ThemePreview.module.css";

type Scheme = "light" | "dark";
type Radius = "sharp" | "rounded" | "pill";

const ACCENTS = [
  { name: "Signal Orange", value: "oklch(0.58 0.2 40)" },
  { name: "Cobalt", value: "oklch(0.55 0.2 260)" },
  { name: "Emerald", value: "oklch(0.55 0.15 155)" },
  { name: "Ink", value: "oklch(0.24 0.01 84)" },
] as const;

const RADII = [
  { id: "sharp", label: "Sharp", px: "0.25rem", btn: "0.25rem" },
  { id: "rounded", label: "Rounded", px: "0.625rem", btn: "0.5rem" },
  { id: "pill", label: "Pill", px: "0.875rem", btn: "9999px" },
] as const;

export default function ThemePreview() {
  const [scheme, setScheme] = useState<Scheme>("light");
  const [accentIdx, setAccentIdx] = useState(0);
  const [radiusId, setRadiusId] = useState<Radius>("rounded");

  const accent = ACCENTS[accentIdx] ?? ACCENTS[0];
  const radius = RADII.find((r) => r.id === radiusId) ?? RADII[1];

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.toggle} role="group" aria-label="Form color scheme">
          <button
            type="button"
            aria-pressed={scheme === "light"}
            className={`${styles.toggleBtn} ${
              scheme === "light" ? styles.toggleActive : ""
            }`}
            onClick={() => setScheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            aria-pressed={scheme === "dark"}
            className={`${styles.toggleBtn} ${
              scheme === "dark" ? styles.toggleActive : ""
            }`}
            onClick={() => setScheme("dark")}
          >
            Dark
          </button>
        </div>

        <div className={styles.swatches} role="group" aria-label="Accent color">
          {ACCENTS.map((swatch, i) => (
            <button
              key={swatch.name}
              type="button"
              aria-label={swatch.name}
              aria-pressed={i === accentIdx}
              className={`${styles.swatch} ${
                i === accentIdx ? styles.swatchActive : ""
              }`}
              style={{ background: swatch.value }}
              onClick={() => setAccentIdx(i)}
            />
          ))}
        </div>

        <div className={styles.toggle} role="group" aria-label="Corner radius">
          {RADII.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={radiusId === r.id}
              className={`${styles.toggleBtn} ${
                radiusId === r.id ? styles.toggleActive : ""
              }`}
              onClick={() => setRadiusId(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live themed booking card */}
      <div
        className={`${styles.previewFrame} ${
          scheme === "dark" ? styles.frameDark : styles.frameLight
        }`}
        style={
          {
            "--preview-accent": accent.value,
            "--preview-radius": radius.px,
            "--preview-btn-radius": radius.btn,
          } as React.CSSProperties
        }
      >
        <div className={styles.previewCard}>
          <div className={styles.previewHead}>
            <Image
              src="/reps/alice.jpg"
              alt="Alice Chen"
              width={36}
              height={36}
              className={styles.previewAvatar}
            />
            <div>
              <p className={styles.previewTitle}>Book a demo with Alice Chen</p>
              <p className={styles.previewSub}>30 min · Google Meet</p>
            </div>
          </div>

          <div className={styles.fakeFields}>
            <div className={styles.fakeInput}>jane@globex.com</div>
            <div className={styles.fakeSlots}>
              <span className={`${styles.fakeSlot} ${styles.fakeSlotPicked}`}>
                9:30 AM
              </span>
              <span className={styles.fakeSlot}>10:00 AM</span>
              <span className={styles.fakeSlot}>11:30 AM</span>
            </div>
          </div>

          <div className={styles.fakeSubmit}>Book Tue, Nov 3 · 9:30 AM</div>
        </div>
      </div>
    </div>
  );
}
