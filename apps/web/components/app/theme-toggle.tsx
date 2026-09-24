"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const subscribeNever = (): (() => void) => () => {};

/** Light / dark switch; renders a neutral placeholder until mounted so server and client agree. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={cn(
        "relative inline-flex h-8 w-14 items-center rounded-full border border-border/70 bg-muted/60 px-1 transition-colors hover:border-brand/40",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full bg-background shadow-sm transition-transform duration-300",
          dark ? "translate-x-6 text-brand" : "translate-x-0 text-amber-500",
        )}
      >
        {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </span>
    </button>
  );
}
