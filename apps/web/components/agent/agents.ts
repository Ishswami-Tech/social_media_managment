/**
 * The council's cast: one identity per seat so people recognise who did what
 * at a glance. Names, roles, icons and colours live here and nowhere else.
 */
import { BookOpenText, Compass, Gavel, PenLine, ScanSearch, Send, Wand2, type LucideIcon } from "lucide-react";
import type { ProgressStageKey } from "@platform/agent-council/progress";

export interface AgentIdentity {
  /** Short name people refer to, e.g. "Scout". */
  name: string;
  /** What the seat does, e.g. "Researcher". */
  role: string;
  icon: LucideIcon;
  /** Gradient stops for the agent's disc and accents. */
  from: string;
  to: string;
  /** Tailwind text colour class for small accents. */
  text: string;
}

export const AGENTS: Record<ProgressStageKey, AgentIdentity> = {
  research: { name: "Scout", role: "Researcher", icon: ScanSearch, from: "#0ea5e9", to: "#06b6d4", text: "text-sky-600 dark:text-sky-400" },
  strategy: { name: "Compass", role: "Strategist", icon: Compass, from: "#6366f1", to: "#8b5cf6", text: "text-indigo-600 dark:text-indigo-400" },
  drafting: { name: "Quill", role: "Writers", icon: PenLine, from: "#8b5cf6", to: "#d946ef", text: "text-violet-600 dark:text-violet-400" },
  review: { name: "Lens", role: "Reviewer", icon: BookOpenText, from: "#f59e0b", to: "#f97316", text: "text-amber-600 dark:text-amber-400" },
  judge: { name: "Verdict", role: "Judge", icon: Gavel, from: "#f43f5e", to: "#ec4899", text: "text-rose-600 dark:text-rose-400" },
  adapt: { name: "Polish", role: "Editor", icon: Wand2, from: "#10b981", to: "#14b8a6", text: "text-emerald-600 dark:text-emerald-400" },
  ready: { name: "You", role: "Approver", icon: Send, from: "#334155", to: "#0f172a", text: "text-foreground" },
};

/** The stage a board seat belongs to. */
export function stageOfSeat(role: "research" | "strategy" | "writer" | "review" | "judge" | "adapt"): ProgressStageKey {
  return role === "writer" ? "drafting" : role;
}
