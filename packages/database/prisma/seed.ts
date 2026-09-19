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

  const models = [
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
    {
      provider: "ANTHROPIC",
      model: "claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 3,
      outputCostPerM: 15,
      priority: 10,
    },
    {
      provider: "ANTHROPIC",
      model: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 1,
      outputCostPerM: 5,
      priority: 20,
    },
    {
      provider: "GOOGLE",
      model: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 1.25,
      outputCostPerM: 10,
      priority: 10,
    },
    {
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      capabilities: ["text", "vision", "json"],
      inputCostPerM: 0.3,
      outputCostPerM: 2.5,
      priority: 20,
    },
    {
      provider: "GOOGLE",
      model: "imagen-4.0-generate-001",
      displayName: "Imagen 4",
      capabilities: ["image"],
      imageCost: 0.04,
      priority: 20,
    },
  ] as const;
  for (const m of models) {
    await prisma.aIProviderConfig.upsert({
      where: { provider_model: { provider: m.provider, model: m.model } },
      create: { ...m, capabilities: [...m.capabilities] },
      update: { displayName: m.displayName, capabilities: [...m.capabilities] },
    });
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
