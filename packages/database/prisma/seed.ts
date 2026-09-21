/**
 * Seeds the platform plan catalogue, the AI model catalogue and a Super Admin.
 *
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=... pnpm db:seed
 *
 * The super admin is created through better-auth so the password hash is
 * compatible with sign-in; the web app exposes this via apps/web/scripts.
 * Here we only upsert catalogue data and, if SEED_ADMIN_EMAIL exists already,
 * promote that user to the "admin" role.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { AIProviderName } from "../src/generated/prisma/enums";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const plans = [
    {
      slug: "free",
      name: "Free",
      priceCents: 0,
      limits: {
        socialAccounts: 2,
        members: 2,
        postsPerMonth: 30,
        aiTokensPerMonth: 100_000,
        aiImagesPerMonth: 10,
        whatsappNumbers: 0,
      },
    },
    {
      slug: "starter",
      name: "Starter",
      priceCents: 2900,
      limits: {
        socialAccounts: 10,
        members: 5,
        postsPerMonth: 300,
        aiTokensPerMonth: 2_000_000,
        aiImagesPerMonth: 100,
        whatsappNumbers: 1,
      },
    },
    {
      slug: "growth",
      name: "Growth",
      priceCents: 9900,
      limits: {
        socialAccounts: 30,
        members: 20,
        postsPerMonth: 2000,
        aiTokensPerMonth: 10_000_000,
        aiImagesPerMonth: 500,
        whatsappNumbers: 3,
      },
    },
    {
      slug: "enterprise",
      name: "Enterprise",
      priceCents: 0,
      limits: {
        socialAccounts: -1,
        members: -1,
        postsPerMonth: -1,
        aiTokensPerMonth: -1,
        aiImagesPerMonth: -1,
        whatsappNumbers: -1,
      },
    },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name, priceCents: p.priceCents, limits: p.limits },
    });
  }

  const models: {
    provider: AIProviderName;
    model: string;
    displayName: string;
    capabilities: string[];
    inputCostPerM?: number;
    outputCostPerM?: number;
    imageCost?: number;
    isDefault?: boolean;
    priority: number;
  }[] = [
    {
      provider: "OPENAI",
      model: "gpt-5",
      displayName: "GPT-5",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 1.25,
      outputCostPerM: 10,
      isDefault: true,
      priority: 10,
    },
    {
      provider: "OPENAI",
      model: "gpt-5-mini",
      displayName: "GPT-5 mini",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 0.25,
      outputCostPerM: 2,
      priority: 20,
    },
    {
      provider: "OPENAI",
      model: "gpt-image-1",
      displayName: "GPT Image 1",
      capabilities: ["image"],
      imageCost: 0.04,
      priority: 10,
    },
    {
      provider: "OPENAI",
      model: "text-embedding-3-small",
      displayName: "Embedding 3 small",
      capabilities: ["embedding"],
      inputCostPerM: 0.02,
      priority: 10,
    },
  ];

  // Seed AI models: start with the static list, then overlay any dynamic models from the Anthropic proxy.
  const seen = new Set<string>();
  for (const m of models) {
    seen.add(`${m.provider}::${m.model}`);
    await prisma.aIProviderConfig.upsert({
      where: { provider_model: { provider: m.provider, model: m.model } },
      create: { ...m, capabilities: [...m.capabilities] },
      update: { displayName: m.displayName, capabilities: [...m.capabilities] },
    });
  }
  // Fetch live models from the Anthropic proxy endpoint.
  try {
    const proxyBase = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") ?? "https://claude.opuscode.pro/api";
    const proxyKey = process.env.ANTHROPIC_API_KEY;
    if (proxyKey) {
      const res = await fetch(`${proxyBase}/models`, {
        headers: { "x-api-key": proxyKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const { data } = (await res.json()) as { data: { id: string; display_name: string; type?: string }[] };
        for (const m of data) {
          const key = `ANTHROPIC::${m.id}`;
          if (!seen.has(key) && m.type !== "embedding") {
            seen.add(key);
            await prisma.aIProviderConfig.upsert({
              where: { provider_model: { provider: "ANTHROPIC", model: m.id } },
              create: {
                provider: "ANTHROPIC",
                model: m.id,
                displayName: m.display_name,
                capabilities: ["text", "vision", "json"],
                inputCostPerM: 0,
                outputCostPerM: 0,
                priority: 100,
              },
              update: { displayName: m.display_name },
            });
          }
        }
        console.log(`Synced ${data.length} models from proxy (${proxyBase})`);
      } else {
        console.warn(`Proxy returned ${res.status} when fetching models`);
      }
    }
  } catch (e) {
    console.warn("Could not sync models from proxy:", (e as Error).message);
  }

  const flags = [
    { key: "whatsapp", description: "WhatsApp Business inbox & campaigns", enabled: true },
    { key: "ai_image", description: "AI image generation", enabled: true },
    { key: "analytics_export", description: "CSV export of analytics", enabled: false },
  ];
  for (const f of flags)
    await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: { description: f.description } });

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (adminEmail) {
    const user = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (user) {
      await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
      console.log(`Promoted ${adminEmail} to Super Admin`);
    } else {
      console.log(`User ${adminEmail} not found; register first, then re-run the seed to promote.`);
    }
  }
  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
