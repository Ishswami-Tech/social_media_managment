import type { BudgetPort } from "@platform/agent-council";
import { Prisma } from "@platform/database";
import { prisma } from "@/lib/db";
import { errorInfo, logger } from "@/lib/logger";

/**
 * Budget port backed by `BudgetReservation` rows. A reservation is inserted
 * inside a serializable transaction that re-checks the organization's monthly
 * cap and the run's own cap, so concurrent runs cannot overspend together.
 */

/** Matches `OrganizationSettings.agentMonthlyBudgetCents` default for organizations without a settings row. */
const DEFAULT_MONTHLY_BUDGET_CENTS = 5000;
const SERIALIZATION_FAILURE = "P2034";
const MAX_TX_ATTEMPTS = 3;

export interface BudgetCaps {
  /** Cents already committed this month: RESERVED estimates + SETTLED actuals. */
  monthUsedCents: number;
  monthBudgetCents: number;
  /** Cents the run has settled so far (`AgentRun.spentCents`). */
  runSpentCents: number;
  /** Cents currently RESERVED (not yet settled) for the run. */
  runReservedCents: number;
  runMaxCents: number;
}

export type BudgetDecision = { ok: true } | { ok: false; denied: string };

/** Pure decision used by `reserve`; denial reasons are shown to humans on BLOCKED runs. */
export function budgetDecision(caps: BudgetCaps, requestCents: number): BudgetDecision {
  if (!Number.isFinite(requestCents) || requestCents < 0) return { ok: false, denied: "invalid reservation amount" };
  if (caps.monthUsedCents + requestCents > caps.monthBudgetCents) {
    return {
      ok: false,
      denied: `monthly AI budget exceeded (${caps.monthUsedCents + requestCents} of ${caps.monthBudgetCents} cents)`,
    };
  }
  const runTotal = caps.runSpentCents + caps.runReservedCents + requestCents;
  if (runTotal > caps.runMaxCents) {
    return { ok: false, denied: `run budget exceeded (${Math.ceil(runTotal)} of ${caps.runMaxCents} cents)` };
  }
  return { ok: true };
}

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

interface ReservationRow {
  runId: string | null;
  cents: number;
  actualCents: number | null;
  status: "RESERVED" | "SETTLED" | "RELEASED";
}

/** Committed cents: estimates for open reservations, actuals for settled ones. */
export function committedCents(rows: readonly ReservationRow[]): { reservedCents: number; spentCents: number } {
  return rows.reduce(
    (acc, r) => {
      if (r.status === "RESERVED") return { ...acc, reservedCents: acc.reservedCents + r.cents };
      if (r.status === "SETTLED") return { ...acc, spentCents: acc.spentCents + (r.actualCents ?? r.cents) };
      return acc;
    },
    { reservedCents: 0, spentCents: 0 },
  );
}

function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === SERIALIZATION_FAILURE;
}

async function reserveOnce(
  organizationId: string,
  runId: string,
  cents: number,
  now: Date,
): Promise<{ reservationId: string } | { denied: string }> {
  return prisma.$transaction(
    async (tx) => {
      const [settings, run, rows] = await Promise.all([
        tx.organizationSettings.findUnique({ where: { organizationId }, select: { agentMonthlyBudgetCents: true } }),
        tx.agentRun.findFirst({ where: { id: runId, organizationId }, select: { spentCents: true, maxCents: true } }),
        tx.budgetReservation.findMany({
          where: { organizationId, createdAt: { gte: startOfMonthUtc(now) }, status: { in: ["RESERVED", "SETTLED"] } },
          select: { runId: true, cents: true, actualCents: true, status: true },
        }),
      ]);
      if (!run) return { denied: "run not found for organization" };
      const month = committedCents(rows);
      const runOpen = committedCents(rows.filter((r) => r.runId === runId));
      const decision = budgetDecision(
        {
          monthUsedCents: month.reservedCents + month.spentCents,
          monthBudgetCents: settings?.agentMonthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS,
          runSpentCents: run.spentCents,
          runReservedCents: runOpen.reservedCents,
          runMaxCents: run.maxCents,
        },
        cents,
      );
      if (!decision.ok) return { denied: decision.denied };
      const row = await tx.budgetReservation.create({
        data: { organizationId, runId, cents: Math.ceil(cents), status: "RESERVED" },
        select: { id: true },
      });
      return { reservationId: row.id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function createPrismaBudget(now: () => Date = () => new Date()): BudgetPort {
  return {
    async reserve(organizationId, runId, cents) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await reserveOnce(organizationId, runId, cents, now());
        } catch (e) {
          if (!isSerializationFailure(e) || attempt >= MAX_TX_ATTEMPTS) throw e;
          logger.debug("budget reservation retried after serialization failure", { runId, attempt, ...errorInfo(e) });
        }
      }
    },

    async settle(reservationId, actualCents) {
      const actual = Number.isFinite(actualCents) && actualCents >= 0 ? actualCents : 0;
      await prisma.budgetReservation.updateMany({
        where: { id: reservationId, status: "RESERVED" },
        data: { actualCents: actual, status: "SETTLED", settledAt: now() },
      });
    },

    async release(reservationId) {
      await prisma.budgetReservation.updateMany({
        where: { id: reservationId, status: "RESERVED" },
        data: { status: "RELEASED", settledAt: now() },
      });
    },
  };
}

export interface MonthlyBudgetStatus {
  budgetCents: number;
  reservedCents: number;
  spentCents: number;
  availableCents: number;
}

/** Current calendar month figures for the organization's budget widget. */
export async function monthlyBudgetStatus(organizationId: string, now: Date = new Date()): Promise<MonthlyBudgetStatus> {
  const [settings, rows] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId }, select: { agentMonthlyBudgetCents: true } }),
    prisma.budgetReservation.findMany({
      where: { organizationId, createdAt: { gte: startOfMonthUtc(now) }, status: { in: ["RESERVED", "SETTLED"] } },
      select: { runId: true, cents: true, actualCents: true, status: true },
    }),
  ]);
  const budgetCents = settings?.agentMonthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS;
  const { reservedCents, spentCents } = committedCents(rows);
  return {
    budgetCents,
    reservedCents,
    spentCents,
    availableCents: Math.max(0, budgetCents - reservedCents - spentCents),
  };
}
