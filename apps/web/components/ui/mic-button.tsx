"use client";

/**
 * A microphone that dictates into a text field. While listening, what the
 * browser hears is appended to the field live; stop, and the words stay.
 * Hidden where the browser cannot recognise speech.
 */
import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { useDictation } from "@/hooks/use-dictation";
import { cn } from "@/lib/utils";

interface MicButtonProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  /** Icon-only round button (default) or a labelled pill. */
  variant?: "icon" | "pill";
  disabled?: boolean;
}

function join(base: string, spoken: string): string {
  if (!spoken) return base;
  if (!base.trim()) return spoken;
  return `${base.replace(/\s+$/, "")} ${spoken}`;
}

export function MicButton({ value, onChange, className, variant = "icon", disabled }: MicButtonProps) {
  const { supported, listening, transcript, error, toggle } = useDictation();
  const base = useRef(value);
  const wasListening = useRef(false);

  // What the field held when the microphone opened is kept; speech goes after it.
  useEffect(() => {
    if (listening && !wasListening.current) base.current = value;
    wasListening.current = listening;
    if (listening) onChange(join(base.current, transcript));
    // `value` is only read at the moment listening starts, and `onChange` is the
    // parent's setter; depending on either would loop the effect on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, listening]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  if (!supported) return null;

  const label = listening ? "Stop dictating" : "Dictate";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border text-xs transition disabled:opacity-50",
        variant === "icon" ? "size-7" : "h-7 px-2.5",
        listening
          ? "border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/30" aria-hidden />}
      {listening ? <MicOff className="relative size-3.5" aria-hidden /> : <Mic className="relative size-3.5" aria-hidden />}
      {variant === "pill" && <span className="relative">{listening ? "Listening…" : "Speak"}</span>}
    </button>
  );
}
