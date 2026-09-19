import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  LINKEDIN: "bg-[#0A66C2]",
  FACEBOOK: "bg-[#1877F2]",
  INSTAGRAM: "bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF]",
  X: "bg-black",
  TIKTOK: "bg-black",
  YOUTUBE: "bg-[#FF0000]",
  THREADS: "bg-black",
  PINTEREST: "bg-[#E60023]",
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-[10px] font-bold text-white",
        COLORS[platform] ?? "bg-muted-foreground",
        className,
      )}
      title={platform}
    >
      {platform === "LINKEDIN"
        ? "in"
        : platform === "INSTAGRAM"
          ? "IG"
          : platform === "FACEBOOK"
            ? "f"
            : platform === "YOUTUBE"
              ? "▶"
              : platform.slice(0, 2)}
    </span>
  );
}
