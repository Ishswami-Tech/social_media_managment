import type { Platform, ProviderFamily } from "@platform/types";
import type { SocialProvider } from "./types";

/**
 * Runtime registry of adapters. The core composer/worker only ever talks to
 * the registry, never to a concrete provider (spec §32: no provider-specific
 * logic in the core).
 */
export class ProviderRegistry {
  private readonly byPlatform = new Map<Platform, SocialProvider>();

  register(provider: SocialProvider): this {
    this.byPlatform.set(provider.platform, provider);
    return this;
  }

  get(platform: Platform): SocialProvider {
    const p = this.byPlatform.get(platform);
    if (!p) throw new Error(`No provider registered for platform ${platform}`);
    return p;
  }

  has(platform: Platform): boolean {
    return this.byPlatform.has(platform);
  }

  list(): SocialProvider[] {
    return [...this.byPlatform.values()];
  }

  byFamily(family: ProviderFamily): SocialProvider[] {
    return this.list().filter((p) => p.family === family);
  }
}
