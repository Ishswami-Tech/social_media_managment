"use client";

/**
 * The council room: the run as a conversation. Every agent posts what it did
 * the moment its event lands, the agent at work shows a typing bubble, and a
 * writer's live text streams into its own bubble while the model is still
 * talking. Everything comes from the same events the arc and the board use.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Award, Radio, ShieldCheck, Sparkles } from "lucide-react";
import {
  formatDuration,
  modelLabel,
  stageOfStep,
  WRITER_LANES,
  type ProgressStage,
  type ProgressStageKey,
  type TranscriptMessage,
} from "@platform/agent-council/progress";
import type { LivePartial } from "@platform/agent-council/live";
import { AGENTS } from "@/components/agent/agents";
import { cn } from "@/lib/utils";

const JUDGE_MAX = 60;
/** Keep scrolling with the conversation only while the reader is near the bottom. */
const STICKY_BOTTOM_PX = 96;
const subscribeNever = (): (() => void) => () => {};

interface CouncilRoomProps {
  messages: TranscriptMessage[];
  stages: ProgressStage[];
  partials?: Record<string, LivePartial> | undefined;
  working: boolean;
  className?: string;
}

function Avatar({ agent, pulse }: { agent: ProgressStageKey; pulse?: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className="relative mt-0.5 shrink-0">
      {pulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-40"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
          aria-hidden
        />
      )}
      <span
        className="relative inline-flex size-7 items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
    </span>
  );
}

function Speaker({ agent, label, model, provider, since }: { agent: ProgressStageKey; label?: string; model?: string | null; provider?: string | null; since?: string }) {
  const identity = AGENTS[agent];
  const chip = modelLabel(model, provider);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className={cn("font-semibold", identity.text)}>
        {identity.name}
        {label ? ` ${label}` : ""}
      </span>
      <span className="text-muted-foreground">{label && WRITER_LANES[label] ? `${WRITER_LANES[label]!.name} lane` : identity.role}</span>
      {chip && (
        <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-1.5 py-px text-[10px] font-medium text-brand">
          <Sparkles className="size-2.5" aria-hidden /> {chip}
        </span>
      )}
      {since && <span className="ml-auto tabular-nums text-muted-foreground/70">{since}</span>}
    </div>
  );
}

function Scores({ scores, winner, animate }: { scores: NonNullable<TranscriptMessage["output"]>["scores"]; winner?: string; animate: boolean }) {
  if (!scores?.length) return null;
  return (
    <ul className="mt-1.5 grid gap-1" aria-label="Judge scores">
      {scores.map((s) => {
        const pct = Math.max(4, Math.round((s.score / JUDGE_MAX) * 100));
        const won = s.label === winner;
        return (
          <li key={s.label} className="grid gap-0.5 text-[11px]">
            <span className="flex items-center justify-between">
              <span className={cn("font-medium", won && "text-emerald-600 dark:text-emerald-400")}>
                Draft {s.label}
                {won && <Award className="ml-1 inline size-3" aria-hidden />}
              </span>
              <span className="tabular-nums text-muted-foreground">{s.score}/{JUDGE_MAX}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.span
                className={cn("block h-full rounded-full", won ? "bg-emerald-500" : "bg-gradient-to-r from-brand to-brand-2")}
                initial={animate ? { width: 0 } : false}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </span>
            {s.rationale && <span className="text-muted-foreground">{s.rationale}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Attachments({ output, animate }: { output: TranscriptMessage["output"]; animate: boolean }) {
  if (!output) return null;
  return (
    <>
      {output.draft && (
        <blockquote className="mt-1.5 line-clamp-4 whitespace-pre-wrap border-l-2 border-brand/40 pl-2 text-[12px] leading-snug text-foreground/85">
          {output.draft}
        </blockquote>
      )}
      {output.verdict && (
        <span
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            output.verdict === "PASS" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          )}
        >
          <ShieldCheck className="size-3" aria-hidden /> {output.verdict}
          {output.issues?.length ? ` · ${output.issues.length} note${output.issues.length === 1 ? "" : "s"}${output.fixed ? ", fixed" : ""}` : ""}
        </span>
      )}
      {output.issues && output.issues.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-[11px] text-muted-foreground">
          {output.issues.slice(0, 4).map((issue) => (
            <li key={issue}>· {issue}</li>
          ))}
        </ul>
      )}
      {output.skills && output.skills.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {output.skills.map((skill) => (
            <span key={skill} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
              {skill}
            </span>
          ))}
        </div>
      )}
      <Scores scores={output.scores} winner={output.winner} animate={animate} />
    </>
  );
}

function Bubble({ children, tone, live }: { children: React.ReactNode; tone?: TranscriptMessage["tone"]; live?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-2xl rounded-tl-md border px-3 py-2 text-[13px] leading-snug",
        tone === "failed"
          ? "border-destructive/40 bg-destructive/5"
          : live
            ? "border-brand/40 bg-brand/5 shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_10%,transparent)]"
            : "border-border bg-background",
      )}
    >
      {children}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-brand"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function sinceLabel(first: string | undefined, at: string): string | undefined {
  if (!first) return undefined;
  const ms = Date.parse(at) - Date.parse(first);
  return Number.isFinite(ms) && ms >= 0 ? `+${formatDuration(ms)}` : undefined;
}

export function CouncilRoom({ messages, stages, partials, working, className }: CouncilRoomProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const scroller = useRef<HTMLDivElement>(null);
  const active = stages.find((s) => s.state === "active");
  const live = Object.values(partials ?? {});
  const first = messages[0]?.at;
  const showTyping = working && active !== undefined && live.length === 0 && active.key !== "ready";
  const liveProgress = live.map((p) => p.chars).join(",");

  // Follow the conversation while the reader is at the bottom, like any chat.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < STICKY_BOTTOM_PX || working) el.scrollTo({ top: el.scrollHeight, behavior: animate ? "smooth" : "auto" });
  }, [messages.length, liveProgress, working, animate]);

  return (
    <section
      aria-label="Council room"
      className={cn("grid gap-2 rounded-2xl border bg-card p-3", className)}
    >
      <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Radio className={cn("size-3.5", working && "text-brand")} aria-hidden /> Council room
        </span>
        <span>
          {working ? (
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-brand">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden /> live
            </span>
          ) : (
            `${messages.length} message${messages.length === 1 ? "" : "s"}`
          )}
        </span>
      </header>

      <div ref={scroller} className="grid max-h-[26rem] gap-2.5 overflow-y-auto pr-1" aria-live={working ? "polite" : "off"}>
        {messages.length === 0 && !showTyping && (
          <p className="py-6 text-center text-xs text-muted-foreground">The agents have not said anything yet.</p>
        )}
        {messages.map((m) => (
          <motion.div
            key={m.id}
            layout={animate}
            initial={animate ? { opacity: 0, y: 10, scale: 0.98 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex items-start gap-2"
          >
            <Avatar agent={m.agent} />
            <Bubble tone={m.tone}>
              <Speaker agent={m.agent} label={m.label} model={m.model} provider={m.provider} since={sinceLabel(first, m.at)} />
              <p className={cn("mt-0.5", m.tone === "failed" && "text-destructive")}>{m.text}</p>
              <Attachments output={m.output} animate={animate} />
            </Bubble>
          </motion.div>
        ))}

        <AnimatePresence initial={false}>
          {live.map((p) => {
            const agent = stageOfStep(p.step.split("#")[0] ?? p.step) ?? "drafting";
            const tool = p.kind === "tool";
            return (
              <motion.div
                key={`live-${p.step}`}
                layout={animate}
                initial={animate ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={animate ? { opacity: 0, height: 0 } : undefined}
                className="flex items-start gap-2"
              >
                <Avatar agent={agent} pulse={animate && !tool} />
                <Bubble live>
                  <Speaker agent={agent} label={p.label} model={p.model} provider={p.provider} />
                  {tool ? (
                    <p className="mt-0.5 text-muted-foreground">
                      Using <span className="font-medium text-foreground">{p.tool}</span>
                      {p.text ? <> · <span className="italic">{p.text}</span></> : null}
                    </p>
                  ) : (
                    <>
                      <p className="mt-0.5 max-h-32 overflow-hidden whitespace-pre-wrap [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                        {p.text || (p.chars > 0 ? "Thinking…" : "Starting…")}
                        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" aria-hidden />
                      </p>
                      <span className="mt-1 block text-[10px] tabular-nums text-muted-foreground">{p.text.length} characters so far</span>
                    </>
                  )}
                </Bubble>
              </motion.div>
            );
          })}

          {showTyping && active && (
            <motion.div
              key={`typing-${active.key}`}
              layout={animate}
              initial={animate ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={animate ? { opacity: 0 } : undefined}
              className="flex items-start gap-2"
            >
              <Avatar agent={active.key} pulse={animate} />
              <Bubble live>
                <Speaker agent={active.key} />
                <span className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <TypingDots />
                  {active.activity.at(-1) ?? active.label}
                </span>
              </Bubble>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
