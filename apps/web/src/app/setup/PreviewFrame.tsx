"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../admin.module.css";

/**
 * A live, non-submitting preview of a form exactly as leads see it in the
 * embed (`?embed=1&preview=1`), sized to its content like the real loader.
 */
export default function PreviewFrame({
  slug,
  scheme,
  label,
}: {
  slug: string;
  scheme: "light" | "dark" | null;
  label: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(560);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: unknown } | null;
      const next = Number(data?.height);
      if (data?.type === "switchboard:resize" && Number.isFinite(next) && next >= 200 && next <= 4000) {
        setHeight(Math.round(next));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const query = new URLSearchParams({ embed: "1", preview: "1", ...(scheme ? { scheme } : {}) });
  return (
    <figure className={styles.preview}>
      <figcaption className={styles.muted}>{label}</figcaption>
      <div className={scheme === "dark" ? styles.previewStageDark : styles.previewStage}>
        <iframe
          ref={frame}
          src={`/f/${encodeURIComponent(slug)}?${query.toString()}`}
          title={`${label} preview`}
          style={{ height }}
          className={styles.previewFrame}
        />
      </div>
    </figure>
  );
}
