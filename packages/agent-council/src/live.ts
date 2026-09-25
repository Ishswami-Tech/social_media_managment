/**
 * Live, unstored progress: the text a writer has produced so far, pushed to
 * whoever is watching while the model is still talking. Nothing here is a
 * source of truth; the stored events are.
 */
import type { AgentBoard, AgentSeat } from "./progress";
import { modelLabel } from "./progress";

/** One in-flight model call's output so far. */
export interface LivePartial {
  /** Replay step name, e.g. "writer:acc_1:A". */
  step: string;
  /** Writer label (A, B, C) when the call is a draft. */
  label?: string;
  runAccountId?: string;
  provider: string;
  model: string;
  /** The readable text so far (the `text` field of a JSON answer, or the raw text). */
  text: string;
  /** Raw characters received, including JSON scaffolding. */
  chars: number;
}

/** Port the pipeline publishes partials through; absent in tests and when Redis is off. */
export interface LiveBus {
  partial(runId: string, message: LivePartial): void;
}

/**
 * Pulls the string value of `key` out of a JSON document that is still being
 * written. Escapes are decoded; a half-received escape or a missing key gives
 * what is readable so far, never a throw.
 */
export function partialTextField(buffer: string, key = "text"): string {
  const marker = `"${key}"`;
  const at = buffer.indexOf(marker);
  if (at < 0) return "";
  let i = buffer.indexOf(":", at + marker.length);
  if (i < 0) return "";
  i += 1;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i += 1;
  if (buffer[i] !== '"') return "";
  i += 1;
  let out = "";
  while (i < buffer.length) {
    const ch = buffer[i]!;
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const next = buffer[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = buffer.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "" : next;
    i += 2;
  }
  return out;
}

function seatWithPartial(seat: AgentSeat, partial: LivePartial): AgentSeat {
  const text = partial.text.trim();
  return {
    ...seat,
    state: "active",
    streaming: true,
    provider: seat.provider ?? partial.provider,
    model: seat.model ?? partial.model,
    modelLabel: seat.modelLabel ?? modelLabel(partial.model, partial.provider),
    draft: text || seat.draft,
    detail: text ? `${text.length} characters so far…` : partial.chars > 0 ? "Thinking…" : seat.detail,
  };
}

/** Lays live partial text over the board: a writer that is mid-sentence shows that sentence. */
export function applyPartials(board: AgentBoard, partials: Readonly<Record<string, LivePartial>> | undefined): AgentBoard {
  if (!partials || Object.keys(partials).length === 0) return board;
  const byLabel = new Map(Object.values(partials).filter((p) => p.label).map((p) => [p.label!, p]));
  return {
    ...board,
    writers: board.writers.map((seat) => {
      const partial = seat.label ? byLabel.get(seat.label) : undefined;
      return partial && seat.state !== "done" && seat.state !== "failed" ? seatWithPartial(seat, partial) : seat;
    }),
  };
}
