import type { PlatformCapabilities } from "@platform/types";
import {
  ProviderError,
  validateAgainstCapabilities,
  type AuthorizationRequest,
  type CallbackContext,
  type ConnectedAccount,
  type NormalizedMedia,
  type NormalizedPost,
  type OAuthCredential,
  type ProviderContext,
  type PublishResult,
  type PublishStatus,
  type RemoteMedia,
  type SocialProvider,
  type ValidationResult,
} from "@platform/social-core";
import { graphGet, graphPost } from "./graph";
import { MetaOAuth, type MetaOAuthOptions } from "./oauth";

export const FACEBOOK_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 63_206 },
  media: {
    kinds: ["IMAGE", "VIDEO", "GIF"],
    maxCount: 10,
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 4 * 1024 * 1024 * 1024,
    required: false,
  },
  supportsCarousel: true,
  supportsScheduling: true,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: true,
};

export class FacebookProvider implements SocialProvider {
  readonly platform = "FACEBOOK" as const;
  readonly family = "META" as const;
  readonly capabilities = FACEBOOK_CAPABILITIES;
  private readonly oauth: MetaOAuth;

  constructor(opts: MetaOAuthOptions) {
    this.oauth = new MetaOAuth(opts);
  }

  async getAuthorizationUrl(redirectUri: string, state: string): Promise<AuthorizationRequest> {
    return { url: this.oauth.getAuthorizationUrl(redirectUri, state), state };
  }

  async handleCallback(ctx: CallbackContext): Promise<ConnectedAccount[]> {
    return (await this.oauth.handleCallback(ctx.code, ctx.redirectUri)).accounts;
  }

  async refreshToken(ctx: ProviderContext): Promise<OAuthCredential> {
    // Page tokens derived from long-lived user tokens don't expire; verify it still works.
    await graphGet(ctx.credential, `/${ctx.externalAccountId}`, { fields: "id" });
    return ctx.credential;
  }

  async getAccount(ctx: ProviderContext): Promise<ConnectedAccount> {
    const p = await graphGet<{ id: string; name: string; category?: string; picture?: { data?: { url?: string } } }>(
      ctx.credential,
      `/${ctx.externalAccountId}`,
      {
        fields: "id,name,category,picture{url}",
      },
    );
    return {
      platform: "FACEBOOK",
      accountType: "PAGE",
      externalAccountId: p.id,
      displayName: p.name,
      avatarUrl: p.picture?.data?.url,
      metadata: { category: p.category },
      credential: ctx.credential,
      capabilities: this.capabilities,
    };
  }

  async validatePost(post: NormalizedPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }

  /** Unpublished photo upload; returned id is attached to the feed post. */
  async uploadMedia(media: NormalizedMedia, ctx: ProviderContext): Promise<RemoteMedia> {
    if (media.kind === "VIDEO") {
      const r = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/videos`, {
        file_url: media.url,
        description: media.altText,
      });
      return { remoteId: r.id, kind: "VIDEO", status: "PROCESSING" };
    }
    const r = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/photos`, {
      url: media.url,
      published: "false",
      alt_text_custom: media.altText,
    });
    return { remoteId: r.id, kind: media.kind, status: "READY" };
  }

  async publish(post: NormalizedPost, ctx: ProviderContext): Promise<PublishResult> {
    const video = post.media.find((m) => m.kind === "VIDEO");
    if (video) {
      const r = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/videos`, {
        file_url: video.url,
        description: post.text,
      });
      return { externalPostId: r.id, externalUrl: `https://www.facebook.com/${r.id}`, publishedAt: new Date(), raw: r };
    }
    const params: Record<string, string | undefined> = { message: post.text };
    if (typeof post.platformOptions?.linkUrl === "string") params.link = post.platformOptions.linkUrl;
    const photos: RemoteMedia[] = [];
    for (const m of post.media) photos.push(await this.uploadMedia(m, ctx));
    photos.forEach((p, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: p.remoteId })));
    const r = await graphPost<{ id: string; post_id?: string }>(
      ctx.credential,
      `/${ctx.externalAccountId}/feed`,
      params,
    );
    const id = r.post_id ?? r.id;
    return { externalPostId: id, externalUrl: `https://www.facebook.com/${id}`, publishedAt: new Date(), raw: r };
  }

  async getPublishStatus(externalPostId: string, ctx: ProviderContext): Promise<PublishStatus> {
    try {
      const r = await graphGet<{ id: string; is_published?: boolean }>(ctx.credential, `/${externalPostId}`, {
        fields: "id,is_published",
      });
      return r.is_published === false ? "PROCESSING" : "PUBLISHED";
    } catch (e) {
      if (e instanceof ProviderError && e.code === "NOT_FOUND") return "DELETED";
      throw e;
    }
  }
}
