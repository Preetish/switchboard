/**
 * Minimal structured logger. In production every line is one JSON object
 * (`{"level","time","msg",...fields}`) so log shippers can parse and filter
 * it; in development it prints a readable line. Never log lead PII — mask
 * emails with `maskEmail` (email.ts) first.
 */

type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const json = process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json";

function write(level: Level, msg: string, fields?: Fields): void {
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (json) {
    sink(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }));
    return;
  }
  const extra = fields
    ? ` ${Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}`
    : "";
  sink(`[switchboard] ${level === "info" ? "" : `${level}: `}${msg}${extra}`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
