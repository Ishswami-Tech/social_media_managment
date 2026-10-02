import { Bookmark, Globe, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, Share, ThumbsUp } from "lucide-react";
import { tokenize, truncateForFeed } from "@platform/social-core";
import { cn, initials } from "@/lib/utils";

export interface PreviewMedia {
  id: string;
  url: string;
  alt?: string | null;
}
export interface PreviewAccount {
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
}
/**
 * Real figures for a post that is already live.
 *
 * Every field is optional on purpose: a platform that does not report a
 * number leaves it undefined, which the preview renders as an em dash rather
 * than a zero. Absent is not the same as none.
 */
export interface PreviewEngagement {
  likes?: number | undefined;
  comments?: number | undefined;
  shares?: number | undefined;
  /** Reaction mix, e.g. { LIKE: 8, PRAISE: 1 }. */
  byType?: Record<string, number> | undefined;
  /** When the numbers were last read from the platform. */
  capturedAt?: Date | string | null | undefined;
}

export interface PostPreviewProps {
  platform: string;
  account: PreviewAccount;
  text: string;
  media?: PreviewMedia[];
  /** Show the collapsed feed view with "…more" like the real feed does */
  collapsed?: boolean;
  /** Present once the post is live: swaps the mock counters for what the platform reports. */
  engagement?: PreviewEngagement | undefined;
  className?: string;
}

/** Emoji for the reactions a post actually drew, so the row is not a fixed trio. */
const REACTION_EMOJI: Record<string, string> = {
  LIKE: "👍",
  PRAISE: "👏",
  EMPATHY: "❤️",
  INTEREST: "💡",
  APPRECIATION: "🙌",
  ENTERTAINMENT: "😄",
};

const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString());

/** Hover text naming the mix, e.g. "8 like, 1 celebrate". Empty when there is nothing to name. */
function reactionBreakdown(engagement: PreviewEngagement | undefined): string | undefined {
  const kinds = Object.entries(engagement?.byType ?? {}).sort((a, b) => b[1] - a[1]);
  if (kinds.length === 0) return undefined;
  const names: Record<string, string> = {
    LIKE: "like",
    PRAISE: "celebrate",
    EMPATHY: "support",
    INTEREST: "insightful",
    APPRECIATION: "love",
    ENTERTAINMENT: "funny",
  };
  return kinds.map(([type, n]) => `${n} ${names[type] ?? type.toLowerCase()}`).join(", ");
}

/** The faces shown beside the like count: what this post drew, or the usual trio before it is live. */
function reactionFaces(engagement: PreviewEngagement | undefined, fallback: string[]): string {
  const kinds = Object.entries(engagement?.byType ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => REACTION_EMOJI[type] ?? "👍");
  return (kinds.length > 0 ? kinds : fallback).join(" ");
}

function RichText({ text, collapsed, accent }: { text: string; collapsed?: boolean; accent: string }) {
  const { visible, truncated } = collapsed ? truncateForFeed(text) : { visible: text, truncated: false };
  return (
    <p className="text-[14px] leading-[20px] whitespace-pre-wrap">
      {tokenize(visible).map((s, i) =>
        s.kind === "newline" ? (
          <br key={i} />
        ) : s.kind === "text" ? (
          <span key={i}>{s.value}</span>
        ) : (
          <span key={i} className={cn("font-semibold", accent)}>
            {s.value}
          </span>
        ),
      )}
      {truncated && <span className="text-muted-foreground"> …more</span>}
    </p>
  );
}

function ImageGrid({ media, square }: { media: PreviewMedia[]; square?: boolean }) {
  if (media.length === 0) return null;
  const items = media.slice(0, 4);
  return (
    <div className={cn("grid gap-0.5 overflow-hidden", items.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
      {items.map((m, i) => (
        <div
          key={m.id}
          className={cn(
            "relative overflow-hidden bg-muted",
            items.length === 1 ? (square ? "aspect-square" : "aspect-[1.91/1] max-h-[420px]") : "aspect-square",
            items.length === 3 && i === 0 && "row-span-2 aspect-auto",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt={m.alt ?? ""} className="size-full object-cover" />
          {i === 3 && media.length > 4 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
              +{media.length - 4}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Avatar({ account, className }: { account: PreviewAccount; className?: string }) {
  return account.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={account.avatarUrl} alt="" className={cn("size-12 rounded-full object-cover", className)} />
  ) : (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground",
        className,
      )}
    >
      {initials(account.displayName)}
    </span>
  );
}

function LinkedInPreview({ account, text, media = [], collapsed, engagement }: PostPreviewProps) {
  return (
    <div className="rounded-lg border bg-white text-[rgba(0,0,0,0.9)] shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <Avatar account={account} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{account.displayName}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {account.headline ?? (account.username ? `@${account.username}` : "Connected account")}
          </p>
          <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
            {/* "Just now" is right while composing and a lie once the post is live. */}
            {engagement ? "Live" : "Just now"} · <Globe className="size-3" />
          </p>
        </div>
        <MoreHorizontal className="size-5 text-muted-foreground" />
      </div>
      <div className="px-4 pb-2">
        <RichText text={text} collapsed={collapsed} accent="text-[#0a66c2]" />
      </div>
      <ImageGrid media={media} />
      <div className="flex items-center justify-between px-4 py-2 text-[12px] text-muted-foreground">
        <span title={reactionBreakdown(engagement)}>
          {reactionFaces(engagement, ["👍", "❤️", "💡"])} · {count(engagement?.likes)}
        </span>
        <span>{count(engagement?.comments)} comments</span>
      </div>
      <div className="grid grid-cols-4 border-t px-2 py-1 text-[13px] font-semibold text-[rgba(0,0,0,0.6)] dark:text-zinc-300">
        {[
          ["Like", ThumbsUp],
          ["Comment", MessageCircle],
          ["Repost", Repeat2],
          ["Send", Send],
        ].map(([label, Icon]) => {
          const I = Icon as typeof ThumbsUp;
          return (
            <span key={label as string} className="flex items-center justify-center gap-1 rounded py-2">
              <I className="size-4" /> {label as string}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function FacebookPreview({ account, text, media = [], collapsed, engagement }: PostPreviewProps) {
  return (
    <div className="rounded-lg border bg-white text-[#050505] shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Avatar account={account} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{account.displayName}</p>
          <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
            {/* "Just now" is right while composing and a lie once the post is live. */}
            {engagement ? "Live" : "Just now"} · <Globe className="size-3" />
          </p>
        </div>
        <MoreHorizontal className="size-5 text-muted-foreground" />
      </div>
      <div className="px-4 pb-3">
        <RichText text={text} collapsed={collapsed} accent="text-[#1877f2]" />
      </div>
      <ImageGrid media={media} />
      <div className="flex items-center justify-between px-4 py-2 text-[13px] text-muted-foreground">
        <span title={reactionBreakdown(engagement)}>
          {reactionFaces(engagement, ["👍", "❤️"])} {count(engagement?.likes)}
        </span>
        <span>
          {count(engagement?.comments)} comments · {count(engagement?.shares)} shares
        </span>
      </div>
      <div className="grid grid-cols-3 border-t px-2 py-1 text-[14px] font-semibold text-[#65676b] dark:text-zinc-300">
        <span className="flex items-center justify-center gap-1 py-1">
          <ThumbsUp className="size-4" /> Like
        </span>
        <span className="flex items-center justify-center gap-1 py-1">
          <MessageCircle className="size-4" /> Comment
        </span>
        <span className="flex items-center justify-center gap-1 py-1">
          <Share className="size-4" /> Share
        </span>
      </div>
    </div>
  );
}

function InstagramPreview({ account, text, media = [], collapsed }: PostPreviewProps) {
  const first = media[0];
  return (
    <div className="mx-auto max-w-[470px] rounded-lg border bg-white text-[#262626] shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar account={account} className="size-8 ring-2 ring-pink-500 ring-offset-1" />
        <p className="flex-1 truncate text-[14px] font-semibold">{account.username ?? account.displayName}</p>
        <MoreHorizontal className="size-5" />
      </div>
      <div className="aspect-square w-full overflow-hidden bg-muted">
        {first ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={first.url} alt={first.alt ?? ""} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
            Instagram requires an image or video
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 px-3 py-2">
        <Heart className="size-6" />
        <MessageCircle className="size-6" />
        <Send className="size-6" />
        <Bookmark className="ml-auto size-6" />
      </div>
      <div className="px-3 pb-3">
        <p className="text-[14px] font-semibold">0 likes</p>
        <div className="text-[14px]">
          <span className="mr-1 font-semibold">{account.username ?? account.displayName}</span>
          <RichText text={text} collapsed={collapsed} accent="text-[#00376b] font-normal" />
        </div>
        {media.length > 1 && <p className="mt-1 text-[12px] text-muted-foreground">Carousel · {media.length} items</p>}
      </div>
    </div>
  );
}

function GenericPreview({ account, text, media = [], collapsed, platform }: PostPreviewProps) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-zinc-900">
      <div className="mb-2 flex items-center gap-2">
        <Avatar account={account} className="size-10" />
        <div>
          <p className="text-[14px] font-semibold">{account.displayName}</p>
          <p className="text-[12px] text-muted-foreground">{platform}</p>
        </div>
      </div>
      <RichText text={text} collapsed={collapsed} accent="text-sky-600" />
      <div className="mt-2">
        <ImageGrid media={media} />
      </div>
    </div>
  );
}

/** Platform-faithful post preview. Server-safe: no hooks, no browser APIs. */
export function PostPreview(props: PostPreviewProps) {
  const body =
    props.platform === "LINKEDIN" ? (
      <LinkedInPreview {...props} />
    ) : props.platform === "FACEBOOK" ? (
      <FacebookPreview {...props} />
    ) : props.platform === "INSTAGRAM" ? (
      <InstagramPreview {...props} />
    ) : (
      <GenericPreview {...props} />
    );
  return <div className={props.className}>{body}</div>;
}
