import { json } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
