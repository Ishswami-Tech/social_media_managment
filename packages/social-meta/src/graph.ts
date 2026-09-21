import { requestJson, type OAuthCredential } from "@platform/social-core";

export const GRAPH_VERSION = "v21.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function graphGet<T>(
  credential: OAuthCredential,
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set("access_token", credential.accessToken);
  return requestJson<T>(url.toString());
}

export function graphDelete<T>(credential: OAuthCredential, path: string): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", credential.accessToken);
  return requestJson<T>(url.toString(), { method: "DELETE" });
}

export function graphPost<T>(
  credential: OAuthCredential,
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const form: Record<string, string> = { access_token: credential.accessToken };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) form[k] = v;
  return requestJson<T>(`${GRAPH}${path}`, { method: "POST", form });
}
