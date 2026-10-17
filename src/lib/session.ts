import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export type GoogleProvider = "gmail" | "google-calendar";
export type GoogleSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  account: string;
  scopes: string[];
  enabled: GoogleProvider[];
};
export type CanvasSession = {
  accessToken: string;
  refreshToken?: string;
  authType?: "personal-token" | "oauth";
  expiresAt: number;
  origin: string;
  account: string;
};
export type OAuthState = { state: string; provider: GoogleProvider | "canvas"; origin?: string; access?: "export"; returnTo?: "/calendar" };

const names = {
  google: "zoa_google",
  canvas: "zoa_canvas",
  oauth: "zoa_oauth",
};

export function sessionConfigured() {
  return (process.env.SESSION_SECRET?.length ?? 0) >= 32;
}

function key() {
  if (!sessionConfigured()) throw new Error("Set SESSION_SECRET to at least 32 characters before connecting accounts.");
  return createHash("sha256").update(process.env.SESSION_SECRET!).digest();
}

export function appUrl() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("APP_URL must be an HTTP or HTTPS origin.");
  return url.origin;
}

async function read<T>(name: keyof typeof names): Promise<T | null> {
  if (!sessionConfigured()) return null;
  const value = (await cookies()).get(names[name])?.value;
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, key(), { issuer: "zoa-study", audience: names[name], keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return payload.data as T;
  } catch {
    return null;
  }
}

async function write(name: keyof typeof names, value: object, seconds = 60 * 60 * 24 * 30) {
  const token = await new EncryptJWT({ data: value }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuer("zoa-study").setAudience(names[name]).setIssuedAt().setExpirationTime(`${seconds}s`).encrypt(key());
  if (Buffer.byteLength(token) > 3800) throw new Error("This connection could not fit in the encrypted session. Try reconnecting the account.");
  (await cookies()).set(names[name], token, { httpOnly: true, secure: process.env.NODE_ENV === "production" || appUrl().startsWith("https:"), sameSite: "lax", path: "/", maxAge: seconds });
}

export const getGoogleSession = () => read<GoogleSession>("google");
export const getCanvasSession = () => read<CanvasSession>("canvas");
export const saveGoogleSession = (session: GoogleSession) => write("google", session);
export const saveCanvasSession = (session: CanvasSession) => write("canvas", session);
export async function clearSession(provider: "google" | "canvas") {
  (await cookies()).delete(names[provider]);
}

export async function beginOAuth(provider: OAuthState["provider"], origin?: string, options: Pick<OAuthState, "access" | "returnTo"> = {}) {
  if (options.access !== undefined && (options.access !== "export" || provider !== "google-calendar")) throw new Error("Calendar export permission requires Google Calendar.");
  if (options.returnTo !== undefined && options.returnTo !== "/calendar") throw new Error("Choose a valid connection return page.");
  const state = randomBytes(32).toString("base64url");
  await write("oauth", { state, provider, origin, ...(options.access ? { access: options.access } : {}), ...(options.returnTo ? { returnTo: options.returnTo } : {}) }, 600);
  return state;
}

export async function consumeOAuth(state: string | null): Promise<OAuthState> {
  const saved = await read<OAuthState>("oauth");
  (await cookies()).delete(names.oauth);
  const actual = Buffer.from(state || "");
  const expected = Buffer.from(saved?.state || "");
  if (!saved || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("The connection request expired. Please try connecting again.");
  return saved;
}

export function assertSameOrigin(request: NextRequest) {
  if (request.headers.get("origin") !== appUrl()) throw new Error("This action must be requested from the app.");
}
