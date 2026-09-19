import {
  buildUrl,
  expiresAtFromSeconds,
  type ConnectedAccount,
  type OAuthCredential,
  type ProviderConfig,
} from "@platform/social-core";
import { FACEBOOK_CAPABILITIES } from "./facebook";
import { GRAPH, graphGet } from "./graph";
import { INSTAGRAM_CAPABILITIES } from "./instagram";

/**
 * One Meta authorization yields many connectable accounts: every Facebook Page
 * the user manages and every Instagram Professional account linked to those
 * pages. Each becomes its own SocialAccount with a page-scoped token
 * (spec §32: never assume one token represents all accounts).
 */
export const META_SCOPES = [
  "public_profile",
  "email",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
  "read_insights",
  "instagram_manage_insights",
];

export const META_WHATSAPP_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"];

export interface MetaOAuthOptions extends ProviderConfig {
  includeWhatsApp?: boolean;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface PagesResponse {
  data: {
    id: string;
    name: string;
    access_token: string;
    category?: string;
    tasks?: string[];
    picture?: { data?: { url?: string } };
    instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
  }[];
  paging?: { next?: string };
}

export class MetaOAuth {
  constructor(private readonly opts: MetaOAuthOptions) {}

  get scopes(): string[] {
    return this.opts.includeWhatsApp ? [...META_SCOPES, ...META_WHATSAPP_SCOPES] : META_SCOPES;
  }

  getAuthorizationUrl(redirectUri: string, state: string): string {
    return buildUrl("https://www.facebook.com/v21.0/dialog/oauth", {
      client_id: this.opts.clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: this.scopes.join(","),
    });
  }

  /** Exchange the code, upgrade to a long-lived user token, then discover pages + IG accounts. */
  async handleCallback(
    code: string,
    redirectUri: string,
  ): Promise<{ userToken: OAuthCredential; accounts: ConnectedAccount[] }> {
    const short = await fetchJson<TokenResponse>(
      buildUrl(`${GRAPH}/oauth/access_token`, {
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    );
    const long = await fetchJson<TokenResponse>(
      buildUrl(`${GRAPH}/oauth/access_token`, {
        grant_type: "fb_exchange_token",
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        fb_exchange_token: short.access_token,
      }),
    );
    const userToken: OAuthCredential = {
      accessToken: long.access_token,
      expiresAt: expiresAtFromSeconds(long.expires_in ?? 60 * 24 * 3600),
      scopes: this.scopes,
    };
    const accounts = await this.discoverAccounts(userToken);
    return { userToken, accounts };
  }

  async discoverAccounts(userToken: OAuthCredential): Promise<ConnectedAccount[]> {
    const out: ConnectedAccount[] = [];
    let url: string | undefined = `${GRAPH}/me/accounts`;
    const fields =
      "id,name,access_token,category,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}";
    while (url) {
      const page: PagesResponse = url.startsWith(`${GRAPH}/me/accounts`)
        ? await graphGet<PagesResponse>(userToken, "/me/accounts", { fields, limit: "100" })
        : await fetchJson<PagesResponse>(url);
      for (const p of page.data) {
        // Page tokens obtained from a long-lived user token do not expire.
        const pageCredential: OAuthCredential = { accessToken: p.access_token, scopes: userToken.scopes };
        out.push({
          platform: "FACEBOOK",
          accountType: "PAGE",
          externalAccountId: p.id,
          displayName: p.name,
          avatarUrl: p.picture?.data?.url,
          profileUrl: `https://www.facebook.com/${p.id}`,
          metadata: { category: p.category, tasks: p.tasks },
          credential: pageCredential,
          capabilities: FACEBOOK_CAPABILITIES,
        });
        if (p.instagram_business_account) {
          const ig = p.instagram_business_account;
          out.push({
            platform: "INSTAGRAM",
            accountType: "BUSINESS",
            externalAccountId: ig.id,
            displayName: ig.name ?? ig.username ?? ig.id,
            username: ig.username,
            avatarUrl: ig.profile_picture_url,
            profileUrl: ig.username ? `https://www.instagram.com/${ig.username}/` : undefined,
            metadata: { facebookPageId: p.id },
            credential: pageCredential,
            capabilities: INSTAGRAM_CAPABILITIES,
          });
        }
      }
      url = page.paging?.next;
    }
    return out;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const { requestJson } = await import("@platform/social-core");
  return requestJson<T>(url);
}
