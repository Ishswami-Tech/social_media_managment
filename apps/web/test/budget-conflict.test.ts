import { describe, expect, it } from "vitest";
import { Prisma } from "@platform/database";
import { isSerializationFailure } from "@/lib/agent/budget";

/**
 * Three council seats reserve budget at the same instant, so a lost
 * serializable transaction is routine. It has to be recognised whichever way
 * the engine words it, or a seat dies of ordinary contention.
 */
describe("a reservation that lost its transaction", () => {
  it("is recognised by Prisma's own code", () => {
    const e = new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "7" });
    expect(isSerializationFailure(e)).toBe(true);
  });

  it("is recognised by the wordings the engine uses without a code", () => {
    for (const message of [
      "TransactionWriteConflict",
      "Transaction failed due to a write conflict or a deadlock",
      "could not serialize access due to concurrent update",
    ]) {
      expect(isSerializationFailure(new Error(message))).toBe(true);
    }
  });

  it("does not swallow a real failure", () => {
    expect(isSerializationFailure(new Error("run not found for organization"))).toBe(false);
    expect(isSerializationFailure(new Prisma.PrismaClientKnownRequestError("nope", { code: "P2002", clientVersion: "7" }))).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
  });
});
