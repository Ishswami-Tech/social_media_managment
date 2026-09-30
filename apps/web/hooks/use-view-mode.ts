"use client";

/**
 * Which version of a run someone wants to watch: the plain one, or the one
 * that shows the machinery. Remembered per browser, because it is a property
 * of the person rather than of the run.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than copied into state by an effect: the value
 * is already the truth, and the server simply has no view of it.
 */
import { useCallback, useSyncExternalStore } from "react";

export type ViewMode = "simple" | "detailed";

const STORAGE_KEY = "run-view-mode";
const CHANGED = "run-view-mode-changed";

function read(): ViewMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "detailed" ? "detailed" : "simple";
  } catch {
    // A browser that refuses storage still gets a working toggle for this tab.
    return "simple";
  }
}

function subscribe(onChange: () => void): () => void {
  // "storage" covers the other tabs; the custom event covers this one, which
  // never hears its own writes.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The plain view is what a first paint shows, here and on the server. */
const serverSnapshot = (): ViewMode => "simple";

export function useViewMode(): { mode: ViewMode; setMode: (next: ViewMode) => void } {
  const mode = useSyncExternalStore(subscribe, read, serverSnapshot);
  const setMode = useCallback((next: ViewMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignored for the same reason.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { mode, setMode };
}
