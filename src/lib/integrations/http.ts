export type IntegrationErrorCode = "API_DISABLED" | "INSUFFICIENT_SCOPE" | "RATE_LIMITED" | "AUTH_REQUIRED" | "OAUTH_CONFIG" | "FORBIDDEN" | "UPSTREAM_ERROR";

export class IntegrationError extends Error {
  constructor(message: string, public status = 502, public readonly code?: IntegrationErrorCode, public readonly actionUrl?: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;

/** Error payloads are inspected only for known machine-readable reasons, never displayed. */
async function boundedErrorJson(response: Response): Promise<unknown> {
  const limit = 16_384;
  if (Number(response.headers.get("content-length")) > limit || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) return null;
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function trustedGoogleUrl(input: URL | string, provider: string) {
  if (!["Google", "Gmail", "Google Calendar"].includes(provider)) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && ["www.googleapis.com", "gmail.googleapis.com", "oauth2.googleapis.com"].includes(url.hostname) ? url : null;
  } catch { return null; }
}

async function googleResponseError(response: Response, url: URL, provider: string): Promise<IntegrationError> {
  const payload = object(await boundedErrorJson(response));
  const rawError = payload?.error;
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    if (rawError === "invalid_grant") return new IntegrationError("Google authorization expired or was revoked. Reconnect Google to grant access again.", 401, "AUTH_REQUIRED");
    if (rawError === "invalid_client" || rawError === "unauthorized_client") return new IntegrationError("Google OAuth credentials are not accepted. Check the app's Google client ID and client secret on the server.", 503, "OAUTH_CONFIG");
  }
  const error = object(rawError);
  const reasons = new Set<string>();
  if (Array.isArray(error?.errors)) {
    for (const entry of error.errors) {
      const reason = object(entry)?.reason;
      if (typeof reason === "string") reasons.add(reason.toLowerCase());
    }
  }
  const details = Array.isArray(error?.details) ? error.details.map(object).filter(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo") : [];
  for (const detail of details) {
    if (typeof detail?.reason === "string") reasons.add(detail.reason.toLowerCase());
  }
  const hasReason = (...values: string[]) => values.some(value => reasons.has(value));
  if (response.status === 401 || hasReason("autherror", "credentials_missing", "access_token_expired", "access_token_invalid")) return new IntegrationError(`${provider} authentication is no longer valid. Reconnect it and approve the requested permissions.`, 401, "AUTH_REQUIRED");
  if (hasReason("service_disabled", "accessnotconfigured")) {
    const service = url.hostname === "gmail.googleapis.com" || url.pathname.startsWith("/gmail/v1/") ? "gmail.googleapis.com" : url.pathname.startsWith("/calendar/v3/") ? "calendar-json.googleapis.com" : null;
    let actionUrl: string | undefined;
    if (service) {
      const action = new URL(`https://console.cloud.google.com/apis/library/${service}`);
      for (const detail of details) {
        const consumer = object(detail?.metadata)?.consumer;
        const project = typeof consumer === "string" ? consumer.match(/^projects\/(\d+)$/)?.[1] : undefined;
        if (project) { action.searchParams.set("project", project); break; }
      }
      actionUrl = action.href;
    }
    return new IntegrationError(`${provider} API is disabled for this app's Google Cloud project. Enable the API in Google Cloud, wait a few minutes, and try again.`, 503, "API_DISABLED", actionUrl);
  }
  if (hasReason("insufficientpermissions", "access_token_scope_insufficient")) return new IntegrationError(`${provider} permission was not granted. Reconnect it and approve the requested read access.`, 403, "INSUFFICIENT_SCOPE");
  if (response.status === 429 || hasReason("ratelimitexceeded", "userratelimitexceeded", "dailylimitexceeded", "quotaexceeded", "resource_exhausted", "rate_limit_exceeded", "quota_exceeded")) return new IntegrationError(`${provider} has reached a rate or quota limit. Wait before trying again, or check the project's Google API quotas.`, 429, "RATE_LIMITED");
  if (response.status === 403) return new IntegrationError(`${provider} denied this request. Check the account's permissions and organization policies.`, 403, "FORBIDDEN");
  return new IntegrationError(`${provider} returned an error (${response.status}). Please try again.`, 502, "UPSTREAM_ERROR");
}

/** Never include upstream messages, metadata, or response bodies in errors or logs. */
export async function providerFetch(url: URL | string, options: RequestInit, provider: string, acceptedStatuses: readonly number[] = []) {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: "no-store", redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  } catch {
    throw new IntegrationError(`${provider} could not be reached. Please try again.`);
  }
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const googleUrl = trustedGoogleUrl(url, provider);
    const error = googleUrl ? await googleResponseError(response, googleUrl, provider)
      : response.status === 401 || response.status === 403 ? new IntegrationError(`${provider} access expired or was denied. Reconnect it and approve the requested permissions.`, 401, "AUTH_REQUIRED")
      : response.status === 429 ? new IntegrationError(`${provider} is rate limiting requests. Please try again shortly.`, 429, "RATE_LIMITED")
      : new IntegrationError(`${provider} returned an error (${response.status}). Please try again.`, 502, "UPSTREAM_ERROR");
    console.warn({ provider, code: error.code, status: response.status });
    throw error;
  }
  return response;
}

export async function providerJson<T>(url: URL | string, options: RequestInit, provider: string): Promise<T> {
  const response = await providerFetch(url, options, provider);
  try {
    return await response.json() as T;
  } catch {
    throw new IntegrationError(`${provider} returned an unreadable response.`);
  }
}

export function bearer(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
