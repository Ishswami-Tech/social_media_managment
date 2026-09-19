"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate, initials } from "@/lib/utils";
import { StatusBadge } from "@/components/app/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Conversation {
  id: string;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  serviceWindowEndsAt: string | null;
  assigneeId: string | null;
  contact: { id: string; name: string | null; phone: string; tags: string[] };
  assignee: { id: string; name: string } | null;
}
interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  content: Record<string, unknown>;
  status: string;
  createdAt: string;
  aiSuggested: boolean;
  errorMessage: string | null;
}
interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
}

const UNASSIGNED = "__none__";

export function Inbox({
  currentUserId,
  canReply,
  aiEnabled,
  members,
}: {
  currentUserId: string;
  canReply: boolean;
  aiEnabled: boolean;
  members: { id: string; name: string }[];
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<"OPEN" | "PENDING" | "RESOLVED" | "ALL">("OPEN");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ reply: string; needsHuman: boolean; reason?: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Wall clock used for the 24h service-window check; refreshed by the polling interval.
  const [now, setNow] = useState(() => Date.now());

  const loadConversations = useCallback(async () => {
    const q = new URLSearchParams({ pageSize: "50" });
    if (filter !== "ALL") q.set("status", filter);
    if (search) q.set("search", search);
    const res = await fetch(`/api/whatsapp/conversations?${q}`);
    if (res.ok) setConversations((await res.json()).items);
  }, [filter, search]);

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/whatsapp/conversations/${id}/messages`);
    if (res.ok) setMessages((await res.json()).messages);
  }, []);

  useEffect(() => {
    // Initial fetch on mount / filter change; state is set asynchronously once the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
    const t = setInterval(() => {
      setNow(Date.now());
      loadConversations();
    }, 10_000);
    return () => clearInterval(t);
  }, [loadConversations]);

  useEffect(() => {
    fetch("/api/whatsapp/templates").then(
      async (r) => r.ok && setTemplates((await r.json()).templates.filter((t: Template) => t.status === "APPROVED")),
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    // Initial fetch for the selected conversation; resolves asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages(active.id);
    fetch(`/api/whatsapp/conversations/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markRead: true }),
    });
    const t = setInterval(() => loadMessages(active.id), 5_000);
    return () => clearInterval(t);
  }, [active, loadMessages]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const insideWindow = !!active?.serviceWindowEndsAt && new Date(active.serviceWindowEndsAt).getTime() > now;

  async function send(payload: Record<string, unknown>) {
    if (!active) return;
    setBusy(true);
    const res = await fetch("/api/whatsapp/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: active.id, ...payload }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Send failed");
    setDraft("");
    setSuggestion(null);
    loadMessages(active.id);
  }

  async function update(patch: Record<string, unknown>) {
    if (!active) return;
    const res = await fetch(`/api/whatsapp/conversations/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return toast.error("Update failed");
    const { conversation } = await res.json();
    setActive({ ...active, ...conversation });
    loadConversations();
  }

  async function suggest() {
    if (!active) return;
    setBusy(true);
    const res = await fetch("/api/ai/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: active.id }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Suggestion failed");
    setSuggestion(data.suggestion);
    setDraft(data.suggestion.reply);
  }

  return (
    <div className="grid h-[calc(100vh-10rem)] grid-cols-[320px_1fr] overflow-hidden rounded-lg border">
      <div className="flex flex-col border-r">
        <div className="grid gap-2 border-b p-2">
          <Input placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-1">
            {(["OPEN", "PENDING", "RESOLVED", "ALL"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "ghost"} onClick={() => setFilter(f)}>
                {f.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <p className="p-4 text-sm text-muted-foreground">No conversations.</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c)}
              className={cn(
                "flex w-full items-start gap-3 border-b p-3 text-left hover:bg-accent",
                active?.id === c.id && "bg-accent",
              )}
            >
              <Avatar>
                <AvatarFallback>{initials(c.contact.name ?? c.contact.phone)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium">{c.contact.name ?? `+${c.contact.phone}`}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(c.lastMessageAt, { timeStyle: "short" })}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{c.lastMessagePreview}</span>
              </span>
              {c.unreadCount > 0 && <Badge>{c.unreadCount}</Badge>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div>
                <p className="font-medium">{active.contact.name ?? `+${active.contact.phone}`}</p>
                <p className="text-xs text-muted-foreground">
                  +{active.contact.phone} ·{" "}
                  {insideWindow
                    ? `service window open until ${formatDate(active.serviceWindowEndsAt, { timeStyle: "short" })}`
                    : "outside 24h window: templates only"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={active.assigneeId ?? UNASSIGNED}
                  onValueChange={(v) => update({ assigneeId: v === UNASSIGNED ? null : v })}
                >
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue placeholder="Assign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                        {m.id === currentUserId ? " (me)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={active.status} onValueChange={(v) => update({ status: v })}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["OPEN", "PENDING", "RESOLVED", "ARCHIVED"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
              {messages.map((m) => {
                const text =
                  (m.content.text as string) ??
                  (m.content.caption as string) ??
                  (m.content.templateName ? `Template: ${m.content.templateName}` : `[${m.type.toLowerCase()}]`);
                return (
                  <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        m.direction === "OUTBOUND" ? "bg-primary text-primary-foreground" : "bg-background",
                      )}
                    >
                      <p className="whitespace-pre-wrap">{text}</p>
                      <p className={cn("mt-1 flex items-center gap-1 text-[10px] opacity-70")}>
                        {formatDate(m.createdAt, { timeStyle: "short" })}
                        {m.direction === "OUTBOUND" && <span>· {m.status.toLowerCase()}</span>}
                        {m.aiSuggested && <Sparkles className="size-3" />}
                      </p>
                      {m.errorMessage && <p className="text-[10px] text-destructive">{m.errorMessage}</p>}
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            {canReply && (
              <div className="grid gap-2 border-t p-3">
                {suggestion && (
                  <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-3" /> AI suggestion loaded into the composer.
                      {suggestion.needsHuman && <StatusBadge status="PENDING" />} {suggestion.reason}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                      Dismiss
                    </Button>
                  </div>
                )}
                {insideWindow ? (
                  <>
                    <Textarea
                      rows={2}
                      placeholder="Type a reply…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="flex justify-between">
                      {aiEnabled ? (
                        <Button size="sm" variant="outline" onClick={suggest} disabled={busy}>
                          <Sparkles /> Suggest reply
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button
                        size="sm"
                        onClick={() => send({ type: "TEXT", text: draft, aiSuggested: !!suggestion })}
                        disabled={busy || !draft.trim()}
                      >
                        Send
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      onValueChange={(v) => {
                        const t = templates.find((x) => x.id === v);
                        if (t)
                          send({ type: "TEMPLATE", template: { name: t.name, language: t.language, components: [] } });
                      }}
                    >
                      <SelectTrigger className="w-72">
                        <SelectValue
                          placeholder={templates.length ? "Send an approved template" : "No approved templates"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} ({t.language})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
