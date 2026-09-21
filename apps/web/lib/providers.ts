import { ProviderRegistry } from "@platform/social-core";
import { LinkedInProvider } from "@platform/social-linkedin";
import { FacebookProvider, InstagramProvider } from "@platform/social-meta";
import type { Platform, ProviderFamily } from "@platform/types";
import { getEnv } from "./env";

let registry: ProviderRegistry | undefined;

/** Social adapters registered from environment configuration. */
export function providers(): ProviderRegistry {
  if (registry) return registry;
  const env = getEnv();
  registry = new ProviderRegistry();
  if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
    registry.register(
      new LinkedInProvider({
        clientId: env.LINKEDIN_CLIENT_ID,
        clientSecret: env.LINKEDIN_CLIENT_SECRET,
        apiVersion: env.LINKEDIN_API_VERSION,
        includeOrganizations: false,
      }),
    );
  }
  if (env.META_APP_ID && env.META_APP_SECRET) {
    registry.register(new FacebookProvider({ clientId: env.META_APP_ID, clientSecret: env.META_APP_SECRET }));
    registry.register(new InstagramProvider({ clientId: env.META_APP_ID, clientSecret: env.META_APP_SECRET }));
  }
  return registry;
}

/** The platform used to start an OAuth flow for a provider family. */
export const FAMILY_ENTRY_PLATFORM: Partial<Record<ProviderFamily, Platform>> = {
  LINKEDIN: "LINKEDIN",
  META: "FACEBOOK",
};

export function isFamilyConfigured(family: ProviderFamily): boolean {
  const platform = FAMILY_ENTRY_PLATFORM[family];
  return !!platform && providers().has(platform);
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  X: "X",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
};
