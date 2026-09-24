import type { AccountType, MediaKind, Platform, PlatformCapabilities, ProviderFamily } from "@platform/types";

export interface ConnectedAccount {
  platform: Platform;
  accountType: AccountType;
  externalAccountId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  profileUrl?: string;
  /** Non-secret provider metadata persisted on SocialAccount.metadata */
  metadata?: Record<string, unknown>;
  credential: OAuthCredential;
  capabilities: PlatformCapabilities;
}

export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
  scopes: string[];
  /** Secret provider metadata (e.g. page-specific tokens) — encrypted at rest */
  secretMetadata?: Record<string, unknown>;
}

export interface NormalizedMedia {
  id: string;
  kind: MediaKind;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  /** Signed or public URL the provider can fetch, OR a buffer loader for direct upload */
  url: string;
  fetchBuffer?: () => Promise<Buffer>;
  altText?: string;
}

export interface NormalizedPost {
  /** Idempotency key unique per (variant, scheduledAt); providers should pass it through where supported */
  idempotencyKey: string;
  text: string;
  media: NormalizedMedia[];
  platformOptions?: Record<string, unknown>;
}

export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
  severity: "error" | "warning";
}
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface RemoteMedia {
  remoteId: string;
  kind: MediaKind;
  /** Some providers need a container/creation step to complete before publishing */
  status?: "READY" | "PROCESSING";
}

export interface PublishResult {
  externalPostId: string;
  externalUrl?: string;
  publishedAt: Date;
  raw?: unknown;
}

export type PublishStatus = "PUBLISHED" | "PROCESSING" | "FAILED" | "DELETED" | "UNKNOWN";

/**
 * Normalised metric subset shared by all platforms (spec §20). Platform-specific
 * numbers stay in `raw`. Every field is optional because no two providers
 * expose the same set.
 */
export interface NormalizedMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saves?: number;
  videoViews?: number;
  followers?: number;
}

export interface MetricsResult {
  metrics: NormalizedMetrics;
  raw?: unknown;
  capturedAt: Date;
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier?: string;
}

export interface CallbackContext {
  code: string;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
}

export interface ProviderContext {
  /** Decrypted credential for the account being acted on */
  credential: OAuthCredential;
  externalAccountId: string;
  accountType: AccountType;
  metadata?: Record<string, unknown>;
}

/**
 * Contract every social adapter implements (spec §10). One adapter instance is
 * stateless and receives the account context per call, so a single process can
 * serve thousands of connected accounts.
 */
export interface SocialProvider {
  readonly platform: Platform;
  readonly family: ProviderFamily;
  readonly capabilities: PlatformCapabilities;

  getAuthorizationUrl(
    redirectUri: string,
    state: string,
    opts?: { codeVerifier?: string },
  ): Promise<AuthorizationRequest>;
  handleCallback(ctx: CallbackContext): Promise<ConnectedAccount[]>;
  refreshToken(ctx: ProviderContext): Promise<OAuthCredential>;
  getAccount(ctx: ProviderContext): Promise<ConnectedAccount>;
  validatePost(post: NormalizedPost, ctx?: ProviderContext): Promise<ValidationResult>;
  uploadMedia(media: NormalizedMedia, ctx: ProviderContext): Promise<RemoteMedia>;
  publish(post: NormalizedPost, ctx: ProviderContext): Promise<PublishResult>;
  getPublishStatus(externalPostId: string, ctx: ProviderContext): Promise<PublishStatus>;
  /** Remove a published post from the platform. Absent when the platform API cannot delete posts. */
  deletePost?(externalPostId: string, ctx: ProviderContext): Promise<void>;
  /** Edit the text of a published post in place (reactions and comments survive). Absent when unsupported. */
  updatePost?(externalPostId: string, text: string, ctx: ProviderContext): Promise<void>;
  /** Post-level metrics; resolves to null when the platform/account type does not expose them. */
  getPostMetrics?(externalPostId: string, ctx: ProviderContext): Promise<MetricsResult | null>;
  /** Account-level metrics (followers etc.); null when unsupported. */
  getAccountMetrics?(ctx: ProviderContext): Promise<MetricsResult | null>;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
}
