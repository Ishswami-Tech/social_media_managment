"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, List, Plus, Clock3 } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { calendarDate, calendarTime, calendarInstant } from "@/lib/calendar";
import { PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export interface CalendarPost {
  id: string;
  title: string | null;
  masterText: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  status: string;
  canReschedule: boolean;
  variants: { platform: string }[];
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FILTERS = {
  all: "All posts",
  scheduled: "Scheduled",
  draft: "Drafts",
  published: "Published",
  attention: "Needs attention",
};
type Filter = keyof typeof FILTERS;
const scheduled = new Set(["SCHEDULED", "QUEUED", "PUBLISHING", "RETRYING"]);

export function CalendarView({
  posts,
  year,
  month,
  timezone,
  canCreate,
}: {
  posts: CalendarPost[];
  year: number;
  month: number;
  timezone: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"month" | "agenda">("month");
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarPost | null>(null);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const start = new Date(Date.UTC(year, month, 1));
  const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const firstWeekday = (start.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 },
    (_, i) => new Date(Date.UTC(year, month, 1 - firstWeekday + i)),
  );
  const dateOf = (p: CalendarPost) =>
    new Date(
      p.status === "PUBLISHED" ? (p.publishedAt ?? p.scheduledAt ?? p.createdAt) : (p.scheduledAt ?? p.createdAt),
    );
  const todayKey = calendarDate(new Date(), timezone);
  const visible = posts.filter((p) => {
    if (platform !== "all" && !p.variants.some((v) => v.platform === platform)) return false;
    switch (filter) {
      case "scheduled":
        return scheduled.has(p.status);
      case "draft":
        return p.status === "DRAFT";
      case "published":
        return p.status === "PUBLISHED";
      case "attention":
        return ["FAILED", "DISCONNECTED_ACCOUNT", "IN_REVIEW"].includes(p.status);
      default:
        return true;
    }
  });
  const byDay = new Map<string, CalendarPost[]>();
  for (const p of visible) {
    const key = calendarDate(dateOf(p), timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  for (const items of byDay.values()) items.sort((a, b) => dateOf(a).getTime() - dateOf(b).getTime());
  const platforms = [...new Set(posts.flatMap((p) => p.variants.map((v) => v.platform)))].sort();
  const monthPosts = posts.filter((p) => calendarDate(dateOf(p), timezone).startsWith(monthKey));
  const adjacent = (offset: number) => {
    const d = new Date(Date.UTC(year, month + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  function openSchedule(post: CalendarPost, target?: string) {
    const current = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
    setEditing(post);
    setDay(target ?? calendarDate(current, timezone));
    setTime(calendarTime(current, timezone));
  }
  async function reschedule() {
    if (!editing) return;
    setBusy(true);
    try {
      const at = calendarInstant(day, time, timezone);
      if (at.getTime() <= Date.now()) throw new Error("Choose a time in the future");
      const response = await fetch(`/api/posts/${editing.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledAt: at.toISOString(), timezone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Could not reschedule this post");
      toast.success("Post rescheduled");
      setEditing(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reschedule this post");
    } finally {
      setBusy(false);
    }
  }
  function postCard(post: CalendarPost) {
    return (
      <div
        key={post.id}
        draggable={post.canReschedule && !busy}
        onDragStart={(event) => {
          if (!post.canReschedule || busy) {
            event.preventDefault();
            return;
          }
          setDragId(post.id);
          event.dataTransfer.setData("text/plain", post.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragId(null)}
        className={cn(
          "rounded-lg border bg-background p-2 shadow-sm",
          post.canReschedule && "cursor-grab active:cursor-grabbing",
          dragId === post.id && "opacity-50",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
          <span className="flex gap-1">
            {[...new Set(post.variants.map((v) => v.platform))].map((p) => (
              <PlatformIcon key={p} platform={p} className="size-4 text-[8px]" />
            ))}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{calendarTime(dateOf(post), timezone)}</span>
        </div>
        <Link href={`/posts/${post.id}`} draggable={false} className="block text-xs font-medium hover:underline">
          {post.title || truncate(post.masterText, 65)}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
          <StatusBadge status={post.status} />
          {post.canReschedule && (
            <button
              type="button"
              onClick={() => openSchedule(post)}
              disabled={busy}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Reschedule ${post.title || truncate(post.masterText, 30)}`}
              title="Reschedule"
            >
              <Clock3 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Posts this month", monthPosts.length],
          ["Scheduled", monthPosts.filter((p) => scheduled.has(p.status)).length],
          ["Published", monthPosts.filter((p) => p.status === "PUBLISHED").length],
          [
            "Needs attention",
            monthPosts.filter((p) => ["FAILED", "DISCONNECTED_ACCOUNT", "IN_REVIEW"].includes(p.status)).length,
          ],
        ].map(([name, count]) => (
          <div key={name} className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{name}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/posts?view=calendar&m=${adjacent(-1)}`} aria-label="Previous month">
            ‹
          </Link>
        </Button>
        <span className="min-w-40 text-center text-sm font-medium">{label}</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/posts?view=calendar&m=${adjacent(1)}`} aria-label="Next month">
            ›
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/posts?view=calendar&m=${todayKey.slice(0, 7)}`}>Today</Link>
        </Button>
        <div className="ml-auto flex gap-1">
          <Button variant={view === "month" ? "secondary" : "ghost"} size="sm" onClick={() => setView("month")}>
            <CalendarDays />
            Month
          </Button>
          <Button variant={view === "agenda" ? "secondary" : "ghost"} size="sm" onClick={() => setView("agenda")}>
            <List />
            Agenda
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="calendar-status" className="sr-only">
          Post status
        </Label>
        <select
          id="calendar-status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {Object.entries(FILTERS).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <Label htmlFor="calendar-channel" className="sr-only">
          Channel
        </Label>
        <select
          id="calendar-channel"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">All channels</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p === "LINKEDIN" ? "LinkedIn" : p === "INSTAGRAM" ? "Instagram" : p === "FACEBOOK" ? "Facebook" : p}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Times in {timezone}. Drag a queued post to another day, or use its clock button.
        </span>
      </div>
      {view === "month" ? (
        <div className="overflow-x-auto rounded-xl border">
          <div className="grid min-w-[700px] grid-cols-7 gap-px bg-border text-xs">
            {WEEKDAYS.map((d) => (
              <div key={d} className="bg-muted p-3 text-center font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {cells.map((cell) => {
              const key = cell.toISOString().slice(0, 10),
                inMonth = cell.getUTCMonth() === month;
              return (
                <div
                  key={key}
                  onDragOver={(event) => {
                    if (dragId) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const post = posts.find((p) => p.id === dragId);
                    setDragId(null);
                    if (post?.canReschedule) openSchedule(post, key);
                  }}
                  className={cn(
                    "min-h-36 bg-background p-2",
                    !inMonth && "bg-muted/50",
                    dragId && "hover:bg-accent/50",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full",
                        key === todayKey && "bg-primary font-semibold text-primary-foreground",
                        !inMonth && "text-muted-foreground",
                      )}
                    >
                      {cell.getUTCDate()}
                    </span>
                    {canCreate && (
                      <Link
                        href={`/create?date=${key}`}
                        className="rounded p-1 text-muted-foreground hover:bg-accent"
                        aria-label={`Create post for ${key}`}
                      >
                        <Plus className="size-3.5" />
                      </Link>
                    )}
                  </div>
                  <div className="grid max-h-80 gap-2 overflow-y-auto">{(byDay.get(key) ?? []).map(postCard)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...byDay.entries()]
            .filter(([key]) => key.startsWith(monthKey))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, items]) => (
              <section key={key} className="rounded-xl border p-4">
                <h3 className="mb-3 text-sm font-medium">
                  {new Intl.DateTimeFormat("en", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  }).format(new Date(`${key}T12:00:00Z`))}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(postCard)}</div>
              </section>
            ))}
          {!visible.some((p) => calendarDate(dateOf(p), timezone).startsWith(monthKey)) && (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No posts match these filters this month.
            </p>
          )}
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule post</DialogTitle>
            <DialogDescription>Choose when this post should publish. Times are in {timezone}.</DialogDescription>
          </DialogHeader>
          <p className="truncate text-sm font-medium">{editing?.title || truncate(editing?.masterText ?? "", 80)}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="reschedule-date">Date</Label>
              <Input
                id="reschedule-date"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reschedule-time">Time</Label>
              <Input
                id="reschedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <Button onClick={reschedule} disabled={busy || !day || !time}>
            {busy ? "Saving…" : "Save schedule"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
