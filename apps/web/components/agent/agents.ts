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
  /** The agent's solid colour (a CSS variable that flips with the theme); both stops match so legacy gradients render flat. */
  from: string;
  to: string;
  /** Tailwind text colour class for small accents. */
  text: string;
  /** The agent's colour as a CSS value, for borders, rings and tints. */
  color?: string;
}

export const AGENTS: Record<ProgressStageKey, AgentIdentity> = {
  research: { name: "Scout", role: "Researcher", icon: ScanSearch, from: "var(--agent-scout)", to: "var(--agent-scout)", text: "text-agent-scout" },
  strategy: { name: "Compass", role: "Strategist", icon: Compass, from: "var(--agent-compass)", to: "var(--agent-compass)", text: "text-agent-compass" },
  drafting: { name: "Quill", role: "Writers", icon: PenLine, from: "var(--agent-quill)", to: "var(--agent-quill)", text: "text-agent-quill" },
  review: { name: "Lens", role: "Reviewer", icon: BookOpenText, from: "var(--agent-lens)", to: "var(--agent-lens)", text: "text-agent-lens" },
  judge: { name: "Verdict", role: "Judge", icon: Gavel, from: "var(--agent-verdict)", to: "var(--agent-verdict)", text: "text-agent-verdict" },
  adapt: { name: "Polish", role: "Editor", icon: Wand2, from: "var(--agent-polish)", to: "var(--agent-polish)", text: "text-agent-polish" },
  ready: { name: "You", role: "Approver", icon: Send, from: "var(--agent-you)", to: "var(--agent-you)", text: "text-agent-you" },
};

/** The stage a board seat belongs to. */
export function stageOfSeat(role: "research" | "strategy" | "writer" | "review" | "judge" | "adapt"): ProgressStageKey {
  return role === "writer" ? "drafting" : role;
}
