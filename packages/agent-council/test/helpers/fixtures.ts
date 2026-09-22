import type { PlatformCapabilities } from "@platform/types";
import type { CheckInput } from "../../src/checks";
import type { AccountBrain, CampaignBrief, ClaimRecord } from "../../src/contracts";

export const REPORT_URL = "https://roasthouse.example/report";

const DEFAULT_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 3000 },
  media: { kinds: ["IMAGE", "VIDEO"], maxCount: 9, required: false },
  supportsCarousel: true,
  supportsScheduling: false,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: true,
};

export function capabilities(overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...overrides };
}

const DEFAULT_BRAIN: AccountBrain = {
  identity: { brand: "Roasthouse", industry: "Specialty coffee" },
  audience: { personas: ["Independent café owners"], painPoints: ["Inconsistent extraction"] },
  voice: { tone: "practical, warm", forbiddenLanguage: ["game-changer", "synergy"] },
  content: { pillars: ["brewing"], forbiddenTopics: ["politics"] },
};

export function brain(overrides: Partial<AccountBrain> = {}): AccountBrain {
  return { ...DEFAULT_BRAIN, ...overrides };
}

export const supportedClaim: ClaimRecord = {
  id: "cl_1",
  statement: "Cold brew sales grew 20% across Europe in 2025.",
  sourceUrl: REPORT_URL,
  sourceTitle: "Specialty coffee report 2025",
  evidence: "cold brew grew 20% year on year across European accounts",
  confidence: 0.9,
  status: "SUPPORTED",
};

export const campaignBrief: CampaignBrief = {
  topic: "Cold brew season",
  goal: "Get café owners to order the summer blend",
  audience: "Independent café owners in Europe",
  notes: `Method and data: ${REPORT_URL}`,
  platforms: ["LINKEDIN"],
};

/** A clean LinkedIn post; every check passes unless the override breaks one. */
export function checkInput(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    text: "Cold brew season is here, and our roasters are ready.",
    hashtags: ["#coldbrew"],
    platform: "LINKEDIN",
    capabilities: DEFAULT_CAPABILITIES,
    claims: [supportedClaim],
    brief: campaignBrief,
    brain: DEFAULT_BRAIN,
    recentTexts: [],
    hasMedia: false,
    ...overrides,
  };
}
