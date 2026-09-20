import type { PlatformCapabilities } from "@platform/types";
import {
  ProviderError,
  mergeValidation,
  validateAgainstCapabilities,
  type AuthorizationRequest,
  type CallbackContext,
  type ConnectedAccount,
  type MetricsResult,
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

export const INSTAGRAM_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 2200 },
  media: {
    kinds: ["IMAGE", "VIDEO"],
    maxCount: 10,
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 1024 * 1024 * 1024,
    maxVideoSeconds: 15 * 60,
    required: true,
  },
  supportsCarousel: true,
  supportsScheduling: false,
  supportsLinkPreview: false,
  supportsHashtags: true,
  supportsFirstComment: true,
};

const CONTAINER_POLL_MS = 3000;
const CONTAINER_MAX_POLLS = 40;

export interface InstagramProviderOptions extends MetaOAuthOptions {
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Instagram Content Publishing API: create a media container (or carousel of
 * containers), wait for it to finish processing, then publish it.
 */
export class InstagramProvider implements SocialProvider {
  readonly platform = "INSTAGRAM" as const;
  readonly family = "META" as const;
  readonly capabilities = INSTAGRAM_CAPABILITIES;
  private readonly oauth: MetaOAuth;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: InstagramProviderOptions) {
    this.oauth = new MetaOAuth(opts);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getAuthorizationUrl(redirectUri: string, state: string): Promise<AuthorizationRequest> {
    return { url: this.oauth.getAuthorizationUrl(redirectUri, state), state };
  }

  async handleCallback(ctx: CallbackContext): Promise<ConnectedAccount[]> {
    return (await this.oauth.handleCallback(ctx.code, ctx.redirectUri)).accounts.filter(
      (a) => a.platform === "INSTAGRAM",
    );
  }

  async refreshToken(ctx: ProviderContext): Promise<OAuthCredential> {
    await graphGet(ctx.credential, `/${ctx.externalAccountId}`, { fields: "id" });
    return ctx.credential;
  }

  async getAccount(ctx: ProviderContext): Promise<ConnectedAccount> {
    const ig = await graphGet<{ id: string; username?: string; name?: string; profile_picture_url?: string }>(
      ctx.credential,
      `/${ctx.externalAccountId}`,
      {
        fields: "id,username,name,profile_picture_url",
      },
    );
    return {
      platform: "INSTAGRAM",
      accountType: "BUSINESS",
      externalAccountId: ig.id,
      displayName: ig.name ?? ig.username ?? ig.id,
      username: ig.username,
      avatarUrl: ig.profile_picture_url,
      credential: ctx.credential,
      capabilities: this.capabilities,
    };
  }

  async validatePost(post: NormalizedPost): Promise<ValidationResult> {
    const base = validateAgainstCapabilities(post, this.capabilities);
    const extra: ValidationResult = { ok: true, issues: [] };
    const hashtags = post.text.match(/#\w+/g)?.length ?? 0;
    if (hashtags > 30)
      extra.issues.push({
        code: "TOO_MANY_HASHTAGS",
        field: "text",
        message: "Instagram allows at most 30 hashtags",
        severity: "error",
      });
    for (const m of post.media) {
      if (m.kind === "IMAGE" && m.width && m.height) {
        const ratio = m.width / m.height;
        if (ratio < 0.8 || ratio > 1.91) {
          extra.issues.push({
            code: "ASPECT_RATIO",
            field: "media",
            message: `Image ${m.id} aspect ratio must be between 4:5 and 1.91:1`,
            severity: "error",
          });
        }
      }
      if (m.kind === "IMAGE" && m.mimeType !== "image/jpeg") {
        extra.issues.push({
          code: "JPEG_REQUIRED",
          field: "media",
          message: `Image ${m.id} should be JPEG; it will be converted before publishing`,
          severity: "warning",
        });
      }
    }
    extra.ok = extra.issues.every((i) => i.severity !== "error");
    return mergeValidation(base, extra);
  }

  async uploadMedia(
    media: NormalizedMedia,
    ctx: ProviderContext,
    opts: { isCarouselItem?: boolean; caption?: string } = {},
  ): Promise<RemoteMedia> {
    const params: Record<string, string | undefined> = {};
    if (media.kind === "VIDEO") {
      params.media_type = "REELS";
      params.video_url = media.url;
    } else {
      params.image_url = media.url;
    }
    if (opts.isCarouselItem) params.is_carousel_item = "true";
    if (opts.caption) params.caption = opts.caption;
    const r = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/media`, params);
    return { remoteId: r.id, kind: media.kind, status: "PROCESSING" };
  }

  async publish(post: NormalizedPost, ctx: ProviderContext): Promise<PublishResult> {
    let containerId: string;
    if (post.media.length === 1) {
      containerId = (await this.uploadMedia(post.media[0]!, ctx, { caption: post.text })).remoteId;
    } else {
      const children: string[] = [];
      for (const m of post.media) children.push((await this.uploadMedia(m, ctx, { isCarouselItem: true })).remoteId);
      for (const c of children) await this.waitForContainer(c, ctx);
      const r = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: post.text,
      });
      containerId = r.id;
    }
    await this.waitForContainer(containerId, ctx);
    const pub = await graphPost<{ id: string }>(ctx.credential, `/${ctx.externalAccountId}/media_publish`, {
      creation_id: containerId,
    });
    let permalink: string | undefined;
    try {
      permalink = (await graphGet<{ permalink?: string }>(ctx.credential, `/${pub.id}`, { fields: "permalink" }))
        .permalink;
    } catch {
      /* permalink is best-effort */
    }
    return { externalPostId: pub.id, externalUrl: permalink, publishedAt: new Date(), raw: pub };
  }

  async getPostMetrics(externalPostId: string, ctx: ProviderContext): Promise<MetricsResult | null> {
    const r = await graphGet<{ data?: { name: string; values?: { value?: number }[] }[] }>(
      ctx.credential,
      `/${externalPostId}/insights`,
      {
        metric: "views,reach,likes,comments,shares,saved",
      },
    );
    const v = (name: string) => r.data?.find((d) => d.name === name)?.values?.[0]?.value;
    return {
      metrics: {
        impressions: v("views"),
        reach: v("reach"),
        likes: v("likes"),
        comments: v("comments"),
        shares: v("shares"),
        saves: v("saved"),
      },
      raw: r,
      capturedAt: new Date(),
    };
  }

  async getAccountMetrics(ctx: ProviderContext): Promise<MetricsResult | null> {
    const r = await graphGet<{ followers_count?: number; media_count?: number }>(
      ctx.credential,
      `/${ctx.externalAccountId}`,
      { fields: "followers_count,media_count" },
    );
    return { metrics: { followers: r.followers_count }, raw: r, capturedAt: new Date() };
  }

  async getPublishStatus(externalPostId: string, ctx: ProviderContext): Promise<PublishStatus> {
    try {
      await graphGet<{ id: string }>(ctx.credential, `/${externalPostId}`, { fields: "id" });
      return "PUBLISHED";
    } catch (e) {
      if (e instanceof ProviderError && e.code === "NOT_FOUND") return "DELETED";
      throw e;
    }
  }

  private async waitForContainer(id: string, ctx: ProviderContext): Promise<void> {
    for (let i = 0; i < CONTAINER_MAX_POLLS; i++) {
      const r = await graphGet<{ status_code?: string; status?: string }>(ctx.credential, `/${id}`, {
        fields: "status_code,status",
      });
      if (r.status_code === "FINISHED") return;
      if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
        throw new ProviderError(
          `Instagram media container ${r.status_code}: ${r.status ?? ""}`,
          "INVALID_MEDIA",
          false,
          undefined,
          r,
        );
      }
      await this.sleep(CONTAINER_POLL_MS);
    }
    throw new ProviderError("Timed out waiting for Instagram media processing", "PROVIDER_UNAVAILABLE", true);
  }
}
