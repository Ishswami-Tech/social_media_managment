import type { PlatformCapabilities } from "@platform/types";
import type { AccountBrain, CampaignBrief, RunSnapshot } from "../../src/contracts";

export const LINKEDIN_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 3000 },
  media: { kinds: ["IMAGE", "VIDEO"], maxCount: 9, required: false },
  supportsCarousel: true,
  supportsScheduling: false,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: true,
};

export const INSTAGRAM_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 2200 },
  media: { kinds: ["IMAGE", "VIDEO"], maxCount: 10, required: true },
  supportsCarousel: true,
  supportsScheduling: false,
  supportsLinkPreview: false,
  supportsHashtags: true,
  supportsFirstComment: true,
};

export const RUN_BRAIN: AccountBrain = {
  identity: { brand: "Northwind", industry: "B2B software", positioning: "Onboarding without the busywork" },
  audience: { personas: ["Head of operations"], painPoints: ["Slow setup"], desiredOutcomes: ["Ship faster"] },
  voice: { tone: "direct, warm", vocabulary: ["ship", "setup"], forbiddenLanguage: ["game-changer", "synergy"] },
  content: { pillars: ["onboarding"], forbiddenTopics: ["politics"] },
};

export const RUN_CAMPAIGN: CampaignBrief = {
  topic: "Faster onboarding for operations teams",
  goal: "Book demos with operations leaders",
  audience: "Heads of operations at mid-market software companies",
  notes: "Reference the guided onboarding flow we shipped last year.",
  platforms: ["LINKEDIN", "INSTAGRAM"],
};

/** A queued run with two accounts on two platforms (Instagram requires media). */
export function baseRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: "run_1",
    organizationId: "org_1",
    status: "QUEUED",
    assurance: "HIGH_ASSURANCE",
    publishMode: "APPROVAL_REQUIRED",
    brief: RUN_CAMPAIGN,
    maxCents: 500,
    spentCents: 0,
    claims: [],
    accounts: [
      {
        runAccountId: "racc_li",
        socialAccountId: "sa_li",
        platform: "LINKEDIN",
        displayName: "Northwind",
        accountType: "ORGANIZATION",
        capabilities: LINKEDIN_CAPABILITIES,
        profile: RUN_BRAIN,
        drafts: [],
      },
      {
        runAccountId: "racc_ig",
        socialAccountId: "sa_ig",
        platform: "INSTAGRAM",
        displayName: "northwind",
        accountType: "BUSINESS",
        capabilities: INSTAGRAM_CAPABILITIES,
        profile: RUN_BRAIN,
        drafts: [],
      },
    ],
    ...overrides,
  };
}
