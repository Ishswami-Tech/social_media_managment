"use client";

/**
 * The composer at the bottom of Home.
 *
 * One box: say what you want to post about, pick who it is for, which skills
 * apply and which model writes it, then send. Everything else on the screen is
 * the conversation that follows from here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, BookOpen, Check, Cpu, ImagePlus, Loader2, Plug, Plus, Send, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { MicButton } from "@/components/ui/mic-button";
import { useViewMode } from "@/hooks/use-view-mode";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ComposerBarAccount {
  id: string;
  platform: string;
  displayName: string;
}

export interface ComposerBarSkill {
  id: string;
  name: string;
  description: string;
}

export interface ComposerBarPlugin {
  slug: string;
  name: string;
  kind: string;
}

export interface ComposerBarModel {
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
}

type Assurance = "JUDGE_ONLY" | "HIGH_ASSURANCE";

interface Props {
  accounts: ComposerBarAccount[];
  skills: ComposerBarSkill[];
  plugins: ComposerBarPlugin[];
  models: ComposerBarModel[];
  /**
   * Called with the new id once it has been accepted. The default keeps the
   * typed-in settings and pulls the new thread into the feed.
   */
  onCreated?: (runId: string) => void;
  placement?: "top" | "bottom";
  /** "detailed" shows every option as its own button; "simple" folds them under Options. */
  density?: "simple" | "detailed";
  /** One-click starting points shown under the box. */
  ideas?: readonly string[];
  /** "≈ $0.30 · 3 min", from recent runs. */
  estimate?: string | null;
}

interface CreateResponse {
  run?: { id: string };
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

/** The API accepts at most ten accounts and eight skills per request. */
const MAX_ACCOUNTS = 10;
const MAX_SKILLS = 8;
const MAX_TOPIC = 500;
const DEFAULT_GOAL = "Engage my audience";
const AUTO_MODEL = "__auto__";
/** Lets the browser paint the new thread before we scroll to it. */
const SCROLL_DELAY_MS = 120;
const MAX_TEXTAREA_PX = 200;

/** An event any part of the page can fire to drop a line into the composer. */
const FILL_EVENT = "home-composer-fill";

/** Puts text in the composer and focuses it (used by the welcome examples). */
export function fillComposer(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(FILL_EVENT, { detail: text }));
}

const modelKey = (m: { provider: string; model: string }) => `${m.provider}::${m.model}`;

/** "Claude Sonnet 4.6 (Anthropic)" → "Claude Sonnet 4.6"; keeps the chip short. */
function shortModelName(displayName: string): string {
  const trimmed = displayName.split("(")[0]?.trim() ?? displayName;
  return trimmed.length > 22 ? `${trimmed.slice(0, 21)}…` : trimmed;
}

export interface ParsedPrompt {
  topic: string;
  goal: string;
  audience?: string;
}

/**
 * People can steer a post by starting a line with "Goal:" or "Audience:".
 * Everything else is the topic.
 */
export function parsePrompt(raw: string): ParsedPrompt {
  const topic: string[] = [];
  let goal: string | undefined;
  let audience: string | undefined;
  for (const line of raw.split("\n")) {
    const goalMatch = /^\s*goal\s*:\s*(.*)$/i.exec(line);
    const audienceMatch = /^\s*audience\s*:\s*(.*)$/i.exec(line);
    if (goalMatch?.[1]?.trim()) goal = goalMatch[1].trim();
    else if (audienceMatch?.[1]?.trim()) audience = audienceMatch[1].trim();
    else topic.push(line);
  }
  return {
    topic: topic.join("\n").trim().slice(0, MAX_TOPIC),
    goal: (goal ?? DEFAULT_GOAL).slice(0, MAX_TOPIC),
    ...(audience ? { audience: audience.slice(0, MAX_TOPIC) } : {}),
  };
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

const TRIGGER_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50";

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/** Sticky bar at the bottom (chat style) or the opening box at the top of Home. */
type Placement = "top" | "bottom";

const WRAPPER: Record<Placement, string> = {
  bottom: "sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-8 md:-mx-6 md:px-6",
  top: "scroll-mt-20",
};

export function ComposerBar({ accounts, skills, plugins, models, onCreated, placement = "bottom", density: densityProp, ideas = [], estimate = null }: Props) {
  const router = useRouter();
  const { mode } = useViewMode();
  const density = densityProp ?? mode;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(() =>
    accounts.slice(0, MAX_ACCOUNTS).map((a) => a.id),
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [model, setModel] = useState(AUTO_MODEL);
  const [assurance, setAssurance] = useState<Assurance>("JUDGE_ONLY");
  const [withImage, setWithImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullBrief, setFullBrief] = useState(false);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");

  const textModels = models.filter((m) => m.capabilities.includes("text"));
  const chosenModel = textModels.find((m) => modelKey(m) === model);

  const grow = useCallback(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, []);

  // The newest thread sits at the bottom, so that is where the page opens.
  useEffect(() => {
    if (placement === "bottom") window.scrollTo({ top: document.body.scrollHeight });
  }, [placement]);

  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail !== "string") return;
      setText(detail);
      const el = textarea.current;
      if (el) {
        el.focus();
        window.setTimeout(grow, 0);
      }
    };
    window.addEventListener(FILL_EVENT, onFill);
    return () => window.removeEventListener(FILL_EVENT, onFill);
  }, [grow]);

  function toggleAccount(id: string) {
    setSelectedAccounts((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleSkill(id: string) {
    setSelectedSkills((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_SKILLS) {
        toast.error(`You can attach up to ${MAX_SKILLS} skills.`);
        return cur;
      }
      return [...cur, id];
    });
  }

  const parsed = parsePrompt(text);
  const tooManyAccounts = selectedAccounts.length > MAX_ACCOUNTS;
  const ready = parsed.topic.length >= 3 && selectedAccounts.length > 0 && !tooManyAccounts;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    let data: CreateResponse = {};
    try {
      const res = await fetch("/api/agent/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: parsed.topic,
          goal: goal.trim() || parsed.goal,
          ...(audience.trim() || parsed.audience ? { audience: audience.trim() || parsed.audience } : {}),
          socialAccountIds: selectedAccounts,
          ...(selectedSkills.length ? { skillIds: selectedSkills } : {}),
          ...(model === AUTO_MODEL ? {} : { model }),
          assurance,
          image: withImage,
        }),
      });
      data = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok || !data.run) {
        toast.error(data.message ?? "Could not start. Try again.");
        return;
      }
    } catch {
      toast.error("Could not reach the server. Try again.");
      return;
    } finally {
      setBusy(false);
    }
    // The settings stay put on purpose: most people post again the same way.
    setText("");
    window.setTimeout(grow, 0);
    if (onCreated) onCreated(data.run.id);
    else router.refresh();
    if (placement === "bottom")
      window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), SCROLL_DELAY_MS);
  }

  if (accounts.length === 0) {
    return (
      <div className={WRAPPER[placement]}>
        <p className="text-sm text-muted-foreground">
          Connect a social account and I can research, write and publish for you.{" "}
          <a href="/accounts" className="underline underline-offset-4">
            Connect an account
          </a>
        </p>
      </div>
    );
  }

  if (placement === "top") {
    const SMALL = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] hover:bg-accent disabled:opacity-50";
    const modelLabelText = chosenModel ? shortModelName(chosenModel.displayName) : "auto routing";
    const assuranceText = assurance === "HIGH_ASSURANCE" ? "High assurance" : "Judge only";
    const accountMenu = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn(SMALL, "border-dashed")}>
            <Plus className="size-3.5" aria-hidden /> Account
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Post to</DropdownMenuLabel>
          {accounts.map((account) => {
            const on = selectedAccounts.includes(account.id);
            return (
              <DropdownMenuItem
                key={account.id}
                role="menuitemcheckbox"
                aria-checked={on}
                onSelect={(e) => {
                  e.preventDefault();
                  toggleAccount(account.id);
                }}
              >
                <Check className={on ? "opacity-100" : "opacity-0"} aria-hidden />
                <PlatformIcon platform={account.platform} className="size-4 text-[8px]" />
                <span className="truncate">{account.displayName}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const playbookItems = (
      <>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Playbooks</DropdownMenuLabel>
        {skills.length === 0 ? (
          <DropdownMenuItem onSelect={() => router.push("/settings?tab=ai#skills")}>
            <Plug /> Import playbooks in Settings…
          </DropdownMenuItem>
        ) : (
          skills.map((skill) => {
            const on = selectedSkills.includes(skill.id);
            return (
              <DropdownMenuItem
                key={skill.id}
                role="menuitemcheckbox"
                aria-checked={on}
                onSelect={(e) => {
                  e.preventDefault();
                  toggleSkill(skill.id);
                }}
              >
                <Check className={on ? "opacity-100" : "opacity-0"} aria-hidden />
                <span className="grid">
                  <span>{skill.name}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
        {plugins.length > 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {plugins.length} plugin{plugins.length === 1 ? "" : "s"} available to the writers
          </p>
        )}
      </>
    );
    const modelItems = (
      <>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
          <DropdownMenuRadioItem value={AUTO_MODEL}>Auto routing (three models)</DropdownMenuRadioItem>
          {textModels.map((m) => (
            <DropdownMenuRadioItem key={modelKey(m)} value={modelKey(m)}>
              {m.displayName} · {m.provider}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </>
    );
    const assuranceItems = (
      <>
        <DropdownMenuLabel className="text-xs text-muted-foreground">How carefully to check</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={assurance} onValueChange={(v) => setAssurance(v === "HIGH_ASSURANCE" ? "HIGH_ASSURANCE" : "JUDGE_ONLY")}>
          <DropdownMenuRadioItem value="JUDGE_ONLY">Judge only</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="HIGH_ASSURANCE">High assurance (a second model reviews)</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </>
    );

    return (
      <section
        aria-label="Brief the council"
        className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-[18px] pt-[18px] pb-3.5 shadow-[0_1px_0_rgba(20,22,26,0.04),0_10px_28px_-14px_rgba(20,22,26,0.22)] transition-[box-shadow,border-color] focus-within:border-signal/50 dark:shadow-none"
      >
        <label htmlFor="brief" className="text-[13px] font-semibold text-muted-foreground">
          What should we post about next?
        </label>
        <div className="flex items-start gap-2.5">
          <textarea
            id="brief"
            ref={textarea}
            value={text}
            rows={2}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="A win, a lesson, an announcement — one sentence is enough. The council does the rest."
            className="min-w-0 flex-1 resize-none bg-transparent p-0 text-[17px] leading-[1.45] outline-none placeholder:text-muted-foreground md:text-[18px]"
          />
          <MicButton
            value={text}
            onChange={(next) => {
              setText(next);
              window.setTimeout(grow, 0);
            }}
            disabled={busy}
            className="size-[42px] shrink-0 rounded-[10px] border border-border bg-card"
          />
        </div>

        {fullBrief && (
          <div className="grid gap-2 border-t border-rule pt-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12.5px] font-semibold text-muted-foreground">
              Goal
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. book assessments"
                className="h-9 rounded-lg border border-input bg-card px-3 text-[14px] font-normal text-foreground outline-none focus:border-signal/60"
              />
            </label>
            <label className="grid gap-1 text-[12.5px] font-semibold text-muted-foreground">
              Audience
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. retail CXOs in India"
                className="h-9 rounded-lg border border-input bg-card px-3 text-[14px] font-normal text-foreground outline-none focus:border-signal/60"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-2.5">
          {selectedAccounts.map((id) => {
            const account = accounts.find((a) => a.id === id);
            if (!account) return null;
            return (
              <span key={id} className="group inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#F1F2EF] pr-2 pl-1.5 text-[13px] dark:bg-white/[0.06]">
                <PlatformIcon platform={account.platform} className="size-5 text-[8px]" />
                <span className="max-w-40 truncate">{account.displayName}</span>
                <button type="button" onClick={() => toggleAccount(id)} aria-label={`Remove ${account.displayName}`} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            );
          })}
          {accountMenu}
          {density === "simple" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={SMALL}>
                  <Settings2 className="size-3.5" aria-hidden /> Options
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
                {playbookItems}
                <DropdownMenuSeparator />
                {textModels.length > 0 && (
                  <>
                    {modelItems}
                    <DropdownMenuSeparator />
                  </>
                )}
                {assuranceItems}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setWithImage((v) => !v);
                  }}
                >
                  <Check className={withImage ? "opacity-100" : "opacity-0"} aria-hidden /> Add an image
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={SMALL}>
                    <BookOpen className="size-3.5" aria-hidden /> Playbooks: {selectedSkills.length ? selectedSkills.length : "auto"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
                  {playbookItems}
                </DropdownMenuContent>
              </DropdownMenu>
              {textModels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={SMALL}>
                      <Sparkles className="size-3.5" aria-hidden /> Model: {modelLabelText}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                    {modelItems}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={SMALL}>
                    <ShieldCheck className="size-3.5" aria-hidden /> {assuranceText}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {assuranceItems}
                </DropdownMenuContent>
              </DropdownMenu>
              <button type="button" className={SMALL} onClick={() => setWithImage((v) => !v)} aria-pressed={withImage}>
                <ImagePlus className="size-3.5" aria-hidden /> Image {withImage ? "on" : "off"}
              </button>
              {estimate && <span className="font-mono text-[12px] text-muted-foreground">{estimate}</span>}
            </>
          )}
          <span className="ml-auto inline-flex items-center gap-3">
            {tooManyAccounts && <span className="text-xs text-muted-foreground">Pick at most {MAX_ACCOUNTS} accounts.</span>}
            <button type="button" onClick={() => setFullBrief((v) => !v)} className="text-[13px] text-[#3F454D] underline underline-offset-2 dark:text-muted-foreground" aria-expanded={fullBrief}>
              {fullBrief ? "Short brief" : "Full brief"}
            </button>
            <Button variant="signal" onClick={() => void submit()} disabled={!ready || busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Send to council
            </Button>
          </span>
        </div>

        {ideas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-muted-foreground">Ideas:</span>
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => {
                  setText(idea);
                  window.setTimeout(grow, 0);
                  textarea.current?.focus();
                }}
                className="min-h-7 rounded-full border border-border bg-[#F6F7F4] px-2.5 py-1 text-left text-[12.5px] leading-snug hover:bg-accent dark:bg-white/[0.04]"
              >
                {idea}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={WRAPPER[placement]}>
      <div className={cn("grid gap-2", placement === "bottom" && "mx-auto max-w-3xl")}>
        {(selectedSkills.length > 0 || selectedAccounts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedAccounts.map((id) => {
              const account = accounts.find((a) => a.id === id);
              if (!account) return null;
              return (
                <Chip key={id} onRemove={() => toggleAccount(id)} label={`Remove ${account.displayName}`}>
                  <PlatformIcon platform={account.platform} className="size-4 text-[8px]" />
                  <span className="max-w-32 truncate">{account.displayName}</span>
                </Chip>
              );
            })}
            {selectedSkills.map((id) => (
              <Chip key={id} onRemove={() => toggleSkill(id)} label={`Remove ${skills.find((s) => s.id === id)?.name ?? "skill"}`}>
                <span className="max-w-40 truncate">{skills.find((s) => s.id === id)?.name ?? id}</span>
              </Chip>
            ))}
          </div>
        )}

        <div className="grid gap-2 rounded-xl border border-input bg-card p-3 transition-[box-shadow,border-color] focus-within:border-signal/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--signal)_14%,transparent)]">
          <Textarea
            ref={textarea}
            value={text}
            rows={1}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="What do you want to post about?"
            aria-label="What do you want to post about?"
            className="max-h-[200px] min-h-10 resize-none border-0 bg-transparent px-3 py-2 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-7 rounded-full"
                  title="Add skills, accounts and images"
                  aria-label="Add skills, accounts and images"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Skills</DropdownMenuLabel>
                {skills.length === 0 ? (
                  <DropdownMenuItem onSelect={() => router.push("/settings?tab=ai#skills")}>
                    <Plug /> Import skills in Settings…
                  </DropdownMenuItem>
                ) : (
                  skills.map((skill) => {
                    const on = selectedSkills.includes(skill.id);
                    return (
                      <DropdownMenuItem
                        key={skill.id}
                        role="menuitemcheckbox"
                        aria-checked={on}
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleSkill(skill.id);
                        }}
                      >
                        <Check className={on ? "opacity-100" : "opacity-0"} aria-hidden />
                        <span className="grid">
                          <span>{skill.name}</span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })
                )}

                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Plugins</DropdownMenuLabel>
                {plugins.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No plugins yet.</p>
                ) : (
                  plugins.map((plugin) => (
                    <p key={plugin.slug} className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                      <Plug className="size-3.5" aria-hidden />
                      <span className="truncate">
                        {plugin.name} <span className="opacity-70">({plugin.kind})</span>
                      </span>
                    </p>
                  ))
                )}
                <DropdownMenuItem onSelect={() => router.push("/settings?tab=ai#plugins")}>
                  <Plus /> Manage…
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Accounts</DropdownMenuLabel>
                {accounts.map((account) => {
                  const on = selectedAccounts.includes(account.id);
                  return (
                    <DropdownMenuItem
                      key={account.id}
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleAccount(account.id);
                      }}
                    >
                      <Check className={on ? "opacity-100" : "opacity-0"} aria-hidden />
                      <PlatformIcon platform={account.platform} className="size-4 text-[8px]" />
                      <span className="truncate">{account.displayName}</span>
                    </DropdownMenuItem>
                  );
                })}

                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/settings?tab=media")}>
                  <ImagePlus /> Attach image…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {textModels.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={TRIGGER_CLASS}
                  title="Which model writes this"
                  aria-label={`Model: ${chosenModel ? shortModelName(chosenModel.displayName) : "Auto"}`}
                >
                  <Cpu className="size-3.5" aria-hidden />
                  <span>{chosenModel ? shortModelName(chosenModel.displayName) : "Auto"}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Model</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                    <DropdownMenuRadioItem value={AUTO_MODEL}>Auto (cheapest capable)</DropdownMenuRadioItem>
                    {textModels.map((m) => (
                      <DropdownMenuRadioItem key={modelKey(m)} value={modelKey(m)}>
                        {m.displayName} · {m.provider}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                className={TRIGGER_CLASS}
                title="How carefully it is checked"
                aria-label={`Checking: ${assurance === "HIGH_ASSURANCE" ? "High assurance" : "Judge only"}`}
              >
                <ShieldCheck className="size-3.5" aria-hidden />
                <span>{assurance === "HIGH_ASSURANCE" ? "High assurance" : "Judge only"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">How carefully to check</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={assurance}
                  onValueChange={(value) => setAssurance(value === "HIGH_ASSURANCE" ? "HIGH_ASSURANCE" : "JUDGE_ONLY")}
                >
                  <DropdownMenuRadioItem value="JUDGE_ONLY">Judge only</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="HIGH_ASSURANCE">High assurance</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              className={cn(TRIGGER_CLASS, withImage && "border-foreground/30 bg-muted text-foreground")}
              onClick={() => setWithImage((v) => !v)}
              aria-pressed={withImage}
              title={withImage ? "An image will be generated for each post" : "Text only; click to also generate an image"}
            >
              <ImagePlus className="size-3.5" aria-hidden />
              <span>{withImage ? "With image" : "Text only"}</span>
            </button>

            <span className="ml-auto flex items-center gap-2">
              <MicButton
                value={text}
                onChange={(next) => {
                  setText(next);
                  window.setTimeout(grow, 0);
                }}
                disabled={busy}
              />
              {tooManyAccounts && (
                <span className="text-xs text-muted-foreground">Pick at most {MAX_ACCOUNTS} accounts.</span>
              )}
              <Button
                type="button"
                variant="signal"
                size="icon"
                className="size-9 rounded-lg"
                onClick={() => void submit()}
                disabled={!ready || busy}
                aria-label={busy ? "Sending" : "Send"}
                title="Send (Enter)"
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
              </Button>
            </span>
          </div>
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          Enter sends · Shift+Enter for a new line · start a line with “Goal:” or “Audience:” to steer it
        </p>
      </div>
    </div>
  );
}

/** The welcome examples: one click fills the composer with a ready-made line. */
export function ExamplePrompts({ prompts }: { prompts: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => fillComposer(prompt)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-left text-sm text-muted-foreground transition",
            "hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
