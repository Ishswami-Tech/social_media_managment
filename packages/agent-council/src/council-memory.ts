/**
 * What the council learns about an account from its own runs, kept on the
 * account's brain and read by every later prompt: which writer lanes the
 * blind judge keeps picking, the opening lines that won, the notes reviewers
 * keep raising, and the angles used lately (so the strategist does not repeat
 * itself). Pure: the web app gathers one run's facts and merges them here.
 */

export interface CouncilMemory {
  /** Runs this memory has learned from. */
  runs?: number;
  /** How often each writer lane won the blind judgement. */
  winningLanes?: { lane: string; wins: number }[];
  /** Opening lines of winning drafts, newest first. */
  winningHooks?: string[];
  /** Reviewer notes that keep coming back for this account, most frequent first. */
  recurringNotes?: { note: string; count: number }[];
  /** Angles the strategist chose lately, newest first. */
  recentAngles?: string[];
  updatedAt?: string;
}

/** One run's worth of facts about an account. */
export interface CouncilObservation {
  winnerLane?: string;
  winnerFirstLine?: string;
  reviewIssues?: string[];
  angle?: string;
  at?: string;
}

const KEEP_HOOKS = 5;
const KEEP_ANGLES = 6;
const KEEP_NOTES = 8;
const LINE_MAX = 140;

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, LINE_MAX);
}

/** Notes are compared without case, punctuation or quoted phrases, so "Cut “game-changer”" and "cut 'unlock'" count as one habit. */
function noteKey(note: string): string {
  return note
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A new memory with one run folded in; the old one is left untouched. */
export function mergeCouncilMemory(existing: CouncilMemory | undefined, seen: CouncilObservation): CouncilMemory {
  const base: CouncilMemory = existing ?? {};
  const lanes = new Map((base.winningLanes ?? []).map((l) => [l.lane, l.wins]));
  if (seen.winnerLane) lanes.set(seen.winnerLane, (lanes.get(seen.winnerLane) ?? 0) + 1);

  const hooks = seen.winnerFirstLine ? [firstLine(seen.winnerFirstLine), ...(base.winningHooks ?? [])] : (base.winningHooks ?? []);
  const angles = seen.angle ? [tidy(seen.angle), ...(base.recentAngles ?? [])] : (base.recentAngles ?? []);

  const notes = new Map<string, { note: string; count: number }>();
  for (const n of base.recurringNotes ?? []) notes.set(noteKey(n.note), { ...n });
  for (const issue of seen.reviewIssues ?? []) {
    const key = noteKey(issue);
    if (!key) continue;
    const current = notes.get(key);
    notes.set(key, current ? { ...current, count: current.count + 1 } : { note: tidy(issue), count: 1 });
  }

  return {
    runs: (base.runs ?? 0) + 1,
    winningLanes: [...lanes].map(([lane, wins]) => ({ lane, wins })).sort((a, b) => b.wins - a.wins),
    winningHooks: dedupe(hooks).slice(0, KEEP_HOOKS),
    recurringNotes: [...notes.values()].sort((a, b) => b.count - a.count).slice(0, KEEP_NOTES),
    recentAngles: dedupe(angles).slice(0, KEEP_ANGLES),
    updatedAt: seen.at ?? new Date().toISOString(),
  };
}

/** The first line of a post: what the reader sees before deciding to read on. */
export function firstLine(text: string): string {
  return tidy(text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "");
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
