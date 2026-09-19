import { redactSecrets } from "@platform/encryption";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(meta ? redactSecrets(meta) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console -- the logger is the single sanctioned console sink
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
  child: (base: Record<string, unknown>) => ({
    debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, { ...base, ...meta }),
    info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, { ...base, ...meta }),
    warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, { ...base, ...meta }),
    error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, { ...base, ...meta }),
  }),
};

export function errorInfo(e: unknown) {
  if (e instanceof Error)
    return { name: e.name, message: e.message, ...(("code" in e && { code: (e as { code: unknown }).code }) || {}) };
  return { message: String(e) };
}
