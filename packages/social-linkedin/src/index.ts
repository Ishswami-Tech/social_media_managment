import type { PlatformCapabilities } from "@platform/types";
import {
  ProviderError,
  buildUrl,
  expiresAtFromSeconds,
  mergeValidation,
  requestJson,
  validateAgainstCapabilities,
  type AuthorizationRequest,
  type CallbackContext,
  type ConnectedAccount,
  type MetricsResult,
  type NormalizedMedia,
  type NormalizedPost,
  type OAuthCredential,
  type ProviderConfig,
  type ProviderContext,
  type PublishResult,
  type PublishStatus,
  type RemoteMedia,
  type SocialProvider,
  type ValidationResult,
} from "@platform/social-core";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com";
/**
 * LinkedIn's versioned REST API takes a YYYYMM `LinkedIn-Version` header and
 * retires versions roughly a year after release ("Requested version ... is not
 * active"). Override with `LINKEDIN_API_VERSION` when this default ages out.
 */
export const DEFAULT_LINKEDIN_API_VERSION = "202609";

/** Member scopes (OpenID + posting) and organization scopes (Community Management API). */
export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];
export const LINKEDIN_ORG_SCOPES = ["r_organization_social", "w_organization_social", "rw_organization_admin"];

export const LINKEDIN_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 3000 },
  media: {
    kinds: ["IMAGE", "VIDEO", "DOCUMENT"],
    maxCount: 20,
    maxImageBytes: 36 * 1024 * 1024,
    maxVideoBytes: 5 * 1024 * 1024 * 1024,
    maxVideoSeconds: 30 * 60,
    required: false,
  },
  supportsCarousel: true, // multi-image posts
  supportsScheduling: false,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: true,
};

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

interface UserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
}

export interface LinkedInProviderOptions extends ProviderConfig {
  /** Include organization scopes and discover administered organizations on connect */
  includeOrganizations?: boolean;
  /** `LinkedIn-Version` header (YYYYMM). Defaults to DEFAULT_LINKEDIN_API_VERSION. */
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export class LinkedInProvider implements SocialProvider {
  readonly platform = "LINKEDIN" as const;
  readonly family = "LINKEDIN" as const;
  readonly capabilities = LINKEDIN_CAPABILITIES;

  constructor(private readonly opts: LinkedInProviderOptions) {}

  private get scopes(): string[] {
    return this.opts.includeOrganizations ? [...LINKEDIN_SCOPES, ...LINKEDIN_ORG_SCOPES] : LINKEDIN_SCOPES;
  }

  async getAuthorizationUrl(redirectUri: string, state: string): Promise<AuthorizationRequest> {
    const url = buildUrl(AUTH_URL, {
      response_type: "code",
      client_id: this.opts.clientId,
      redirect_uri: redirectUri,
      state,
      scope: this.scopes.join(" "),
    });
    return { url, state };
  }

  async handleCallback(ctx: CallbackContext): Promise<ConnectedAccount[]> {
    const token = await requestJson<TokenResponse>(TOKEN_URL, {
      method: "POST",
      form: {
        grant_type: "authorization_code",
        code: ctx.code,
        redirect_uri: ctx.redirectUri,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      },
    });
    const credential = this.toCredential(token);
    const accounts: ConnectedAccount[] = [await this.fetchMember(credential)];
    if (this.opts.includeOrganizations) accounts.push(...(await this.fetchOrganizations(credential)));
    return accounts;
  }

  async refreshToken(ctx: ProviderContext): Promise<OAuthCredential> {
    if (!ctx.credential.refreshToken) {
      throw new ProviderError(
        "LinkedIn token expired and no refresh token is available; reconnect the account",
        "AUTH_EXPIRED",
        false,
      );
    }
    const token = await requestJson<TokenResponse>(TOKEN_URL, {
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: ctx.credential.refreshToken,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      },
    });
    return this.toCredential(token, ctx.credential.scopes);
  }

  async getAccount(ctx: ProviderContext): Promise<ConnectedAccount> {
    if (ctx.accountType === "ORGANIZATION") {
      const org = await this.api<{ localizedName: string; vanityName?: string }>(
        ctx.credential,
        `/rest/organizations/${ctx.externalAccountId}`,
      );
      return this.orgAccount(ctx.externalAccountId, org.localizedName, org.vanityName, ctx.credential);
    }
    return this.fetchMember(ctx.credential);
  }

  async validatePost(post: NormalizedPost): Promise<ValidationResult> {
    const base = validateAgainstCapabilities(post, this.capabilities);
    const extra: ValidationResult = { ok: true, issues: [] };
    const docs = post.media.filter((m) => m.kind === "DOCUMENT");
    if (docs.length > 1)
      extra.issues.push({
        code: "ONE_DOCUMENT",
        field: "media",
        message: "LinkedIn allows one document per post",
        severity: "error",
      });
    if (docs.length === 1 && post.media.length > 1)
      extra.issues.push({
        code: "DOCUMENT_ALONE",
        field: "media",
        message: "A document cannot be combined with other media",
        severity: "error",
      });
    extra.ok = extra.issues.every((i) => i.severity !== "error");
    return mergeValidation(base, extra);
  }

  /**
   * LinkedIn media upload is a two-step process: initialise an upload to obtain
   * an upload URL + asset URN, then PUT the bytes to that URL.
   */
  async uploadMedia(media: NormalizedMedia, ctx: ProviderContext): Promise<RemoteMedia> {
    const owner = this.ownerUrn(ctx);
    const kind = media.kind === "VIDEO" ? "videos" : media.kind === "DOCUMENT" ? "documents" : "images";
    const init = await this.api<{
      value: {
        uploadUrl: string;
        image?: string;
        video?: string;
        document?: string;
        uploadInstructions?: { uploadUrl: string }[];
      };
    }>(ctx.credential, `/rest/${kind}?action=initializeUpload`, {
      method: "POST",
      body: {
        initializeUploadRequest:
          media.kind === "VIDEO"
            ? { owner, fileSizeBytes: media.size, uploadCaptions: false, uploadThumbnail: false }
            : { owner },
      },
    });
    const urn = init.value.image ?? init.value.video ?? init.value.document;
    const uploadUrl = init.value.uploadUrl ?? init.value.uploadInstructions?.[0]?.uploadUrl;
    if (!urn || !uploadUrl)
      throw new ProviderError("LinkedIn did not return an upload URL", "PROVIDER_UNAVAILABLE", true, undefined, init);

    const bytes = media.fetchBuffer
      ? await media.fetchBuffer()
      : Buffer.from(await (await fetch(media.url)).arrayBuffer());
    const put = await (this.opts.fetchImpl ?? fetch)(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${ctx.credential.accessToken}`, "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) throw ProviderError.fromHttp(put.status, await put.text(), "LinkedIn media upload failed");
    return { remoteId: urn, kind: media.kind, status: media.kind === "VIDEO" ? "PROCESSING" : "READY" };
  }

  async publish(post: NormalizedPost, ctx: ProviderContext): Promise<PublishResult> {
    const author = this.ownerUrn(ctx);
    const remote: RemoteMedia[] = [];
    for (const m of post.media) remote.push(await this.uploadMedia(m, ctx));

    const body: Record<string, unknown> = {
      author,
      commentary: post.text,
      visibility: (post.platformOptions?.visibility as string) ?? "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (remote.length === 1) {
      const r = remote[0]!;
      body.content =
        r.kind === "DOCUMENT"
          ? { media: { id: r.remoteId, title: (post.platformOptions?.title as string) ?? "Document" } }
          : { media: { id: r.remoteId, altText: post.media[0]?.altText } };
    } else if (remote.length > 1) {
      body.content = {
        multiImage: { images: remote.map((r, i) => ({ id: r.remoteId, altText: post.media[i]?.altText })) },
      };
    } else if (typeof post.platformOptions?.linkUrl === "string") {
      body.content = {
        article: {
          source: post.platformOptions.linkUrl,
          title: (post.platformOptions.linkTitle as string) ?? post.platformOptions.linkUrl,
        },
      };
    }

    const res = await this.apiRaw(ctx.credential, "/rest/posts", { method: "POST", body });
    const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!id) throw new ProviderError("LinkedIn did not return a post id", "UNKNOWN", false, res.status);
    return {
      externalPostId: id,
      externalUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
      publishedAt: new Date(),
    };
  }

  async deletePost(externalPostId: string, ctx: ProviderContext): Promise<void> {
    try {
      const res = await this.apiRaw(ctx.credential, `/rest/posts/${encodeURIComponent(externalPostId)}`, {
        method: "DELETE",
      });
      if (res.status !== 204 && res.status !== 200)
        throw new ProviderError(`LinkedIn responded ${res.status} deleting the post`, "UNKNOWN", false, res.status);
    } catch (e) {
      // Already gone on the platform: treat as deleted.
      if (e instanceof ProviderError && e.code === "NOT_FOUND") return;
      throw e;
    }
  }

  async getPublishStatus(externalPostId: string, ctx: ProviderContext): Promise<PublishStatus> {
    try {
      const post = await this.api<{ lifecycleState?: string }>(
        ctx.credential,
        `/rest/posts/${encodeURIComponent(externalPostId)}`,
      );
      if (post.lifecycleState === "PUBLISHED") return "PUBLISHED";
      if (post.lifecycleState === "PUBLISH_FAILED") return "FAILED";
      return "PROCESSING";
    } catch (e) {
      if (e instanceof ProviderError && e.code === "NOT_FOUND") return "DELETED";
      throw e;
    }
  }

  /**
   * Share statistics are only available for organization pages via the
   * Community Management API; member profiles expose nothing, so null.
   */
  async getPostMetrics(externalPostId: string, ctx: ProviderContext): Promise<MetricsResult | null> {
    if (ctx.accountType !== "ORGANIZATION") return null;
    const org = `urn:li:organization:${ctx.externalAccountId}`;
    const res = await this.api<{ elements?: { totalShareStatistics?: Record<string, number> }[] }>(
      ctx.credential,
      `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}&shares=List(${encodeURIComponent(externalPostId)})`,
    );
    const t = res.elements?.[0]?.totalShareStatistics;
    if (!t) return null;
    return {
      metrics: {
        impressions: t.impressionCount,
        reach: t.uniqueImpressionsCount,
        likes: t.likeCount,
        comments: t.commentCount,
        shares: t.shareCount,
        clicks: t.clickCount,
      },
      raw: t,
      capturedAt: new Date(),
    };
  }

  async getAccountMetrics(ctx: ProviderContext): Promise<MetricsResult | null> {
    if (ctx.accountType !== "ORGANIZATION") return null;
    const org = `urn:li:organization:${ctx.externalAccountId}`;
    const [size, stats] = await Promise.all([
      this.api<{ firstDegreeSize?: number }>(
        ctx.credential,
        `/rest/networkSizes/${encodeURIComponent(org)}?edgeType=CompanyFollowedByMember`,
      ),
      this.api<{ elements?: { totalShareStatistics?: Record<string, number> }[] }>(
        ctx.credential,
        `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}`,
      ).catch(() => ({ elements: [] })),
    ]);
    const t = stats.elements?.[0]?.totalShareStatistics ?? {};
    return {
      metrics: {
        followers: size.firstDegreeSize,
        impressions: t.impressionCount,
        likes: t.likeCount,
        comments: t.commentCount,
        shares: t.shareCount,
        clicks: t.clickCount,
      },
      raw: { networkSize: size, stats: t },
      capturedAt: new Date(),
    };
  }

  // ---- internals ----

  private toCredential(token: TokenResponse, fallbackScopes: string[] = this.scopes): OAuthCredential {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      refreshExpiresAt: expiresAtFromSeconds(token.refresh_token_expires_in),
      scopes: token.scope ? token.scope.split(/[ ,]+/) : fallbackScopes,
    };
  }

  private ownerUrn(ctx: ProviderContext): string {
    return ctx.accountType === "ORGANIZATION"
      ? `urn:li:organization:${ctx.externalAccountId}`
      : `urn:li:person:${ctx.externalAccountId}`;
  }

  private async fetchMember(credential: OAuthCredential): Promise<ConnectedAccount> {
    const me = await this.api<UserInfo>(credential, "/v2/userinfo");
    return {
      platform: "LINKEDIN",
      accountType: "PROFILE",
      externalAccountId: me.sub,
      displayName: me.name ?? [me.given_name, me.family_name].filter(Boolean).join(" ") ?? me.sub,
      avatarUrl: me.picture,
      metadata: { email: me.email },
      credential,
      capabilities: this.capabilities,
    };
  }

  private async fetchOrganizations(credential: OAuthCredential): Promise<ConnectedAccount[]> {
    const acls = await this.api<{ elements?: { organization: string; role: string; state: string }[] }>(
      credential,
      "/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50",
    );
    const out: ConnectedAccount[] = [];
    for (const acl of acls.elements ?? []) {
      const id = acl.organization.split(":").pop()!;
      try {
        const org = await this.api<{ localizedName: string; vanityName?: string }>(
          credential,
          `/rest/organizations/${id}`,
        );
        out.push(this.orgAccount(id, org.localizedName, org.vanityName, credential));
      } catch {
        // Skip organizations we cannot read; the member profile still connects.
      }
    }
    return out;
  }

  private orgAccount(
    id: string,
    name: string,
    vanity: string | undefined,
    credential: OAuthCredential,
  ): ConnectedAccount {
    return {
      platform: "LINKEDIN",
      accountType: "ORGANIZATION",
      externalAccountId: id,
      displayName: name,
      username: vanity,
      profileUrl: vanity ? `https://www.linkedin.com/company/${vanity}/` : undefined,
      credential,
      capabilities: this.capabilities,
    };
  }

  private headers(credential: OAuthCredential): Record<string, string> {
    return {
      authorization: `Bearer ${credential.accessToken}`,
      "linkedin-version": this.opts.apiVersion ?? DEFAULT_LINKEDIN_API_VERSION,
      "x-restli-protocol-version": "2.0.0",
    };
  }

  private api<T>(
    credential: OAuthCredential,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    return requestJson<T>(`${API}${path}`, { ...init, headers: this.headers(credential) });
  }

  private async apiRaw(
    credential: OAuthCredential,
    path: string,
    init: { method?: string; body?: unknown },
  ): Promise<Response> {
    const res = await (this.opts.fetchImpl ?? fetch)(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { ...this.headers(credential), "content-type": "application/json" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = await res.text().catch(() => undefined);
      }
      throw ProviderError.fromHttp(res.status, data, "LinkedIn request failed");
    }
    return res;
  }
}
