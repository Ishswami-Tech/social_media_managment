import { cn } from "@/lib/utils";

/** Flat brand marks: one solid colour, one or two letters. Gradients are gone app-wide. */
const MARKS: Record<string, { bg: string; glyph: string }> = {
  LINKEDIN: { bg: "bg-[#0A66C2]", glyph: "in" },
  FACEBOOK: { bg: "bg-[#1877F2]", glyph: "f" },
  INSTAGRAM: { bg: "bg-[#D62976]", glyph: "IG" },
  X: { bg: "bg-[#14161A] dark:bg-[#2A2E35]", glyph: "X" },
  TIKTOK: { bg: "bg-[#14161A] dark:bg-[#2A2E35]", glyph: "Tk" },
  YOUTUBE: { bg: "bg-[#FF0000]", glyph: "▶" },
  THREADS: { bg: "bg-[#14161A] dark:bg-[#2A2E35]", glyph: "@" },
  PINTEREST: { bg: "bg-[#E60023]", glyph: "P" },
  WHATSAPP: { bg: "bg-[#25D366]", glyph: "W" },
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const mark = MARKS[platform];
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md font-sans text-[10px] leading-none font-bold text-white",
        mark?.bg ?? "bg-muted-foreground",
        className,
      )}
      title={platform.charAt(0) + platform.slice(1).toLowerCase()}
    >
      {mark?.glyph ?? platform.slice(0, 2)}
    </span>
  );
}
