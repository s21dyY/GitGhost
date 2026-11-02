import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Client identification for rate limits.
 *
 * Nothing a client can send is trusted by default. `X-Forwarded-For`, `X-Real-IP` and similar
 * headers are plain request headers: anyone can set them. They are used ONLY when the operator
 * declares, through configuration, that a trusted edge sets or overwrites them:
 *
 *   GITGHOST_TRUSTED_IP_SOURCE=none      (default) no header is trusted; every request shares the
 *                                        single "unverified" bucket, so per-client limits behave
 *                                        like global limits.
 *   GITGHOST_TRUSTED_IP_SOURCE=header    read ONE header that the host's edge sets/overwrites,
 *                                        named by GITGHOST_TRUSTED_IP_HEADER (single IP value).
 *   GITGHOST_TRUSTED_IP_SOURCE=xff-hops  take the Nth entry from the RIGHT of X-Forwarded-For,
 *                                        N = GITGHOST_TRUSTED_PROXY_HOPS (number of trusted
 *                                        proxies that append to the header). Entries to the left
 *                                        are client-controlled and are ignored.
 *
 * Whether a given host really behaves this way must be verified on that host; this code cannot
 * check it. Private/loopback/link-local addresses and malformed values are never accepted as a
 * client identity (they usually mean "the proxy", not the user). IPv6 addresses are grouped by /64
 * because one household or host can use millions of addresses inside a /64.
 */
export type TrustedIpSource = "none" | "header" | "xff-hops";

export type ClientIdentity = {
  /** Opaque, stable bucket key. Never contains the raw address. */
  key: string;
  /** True only when an IP was extracted under an explicitly trusted configuration. */
  verified: boolean;
  source: TrustedIpSource;
};

type Env = Record<string, string | undefined>;
type HeaderReader = { get(name: string): string | null };

export const UNVERIFIED_KEY = "unverified";

function parseIPv4(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

function isPublicIPv4(p: number[]): boolean {
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

/** Expand an IPv6 address into 8 numeric groups, or null if malformed. */
function expandIPv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  const zone = ip.indexOf("%");
  let s = zone >= 0 ? ip.slice(0, zone) : ip;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const q = parseIPv4(v4[1]);
    if (!q) return null;
    s = s.slice(0, -v4[1].length) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - h.length - t.length;
  if (s.includes("::") ? missing < 0 : h.length !== 8) return null;
  const groups = [...h, ...(s.includes("::") ? Array(missing).fill("0") : []), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/** Returns a normalized public address (IPv6 reduced to its /64), or null. */
export function normalizePublicIp(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 45) return null;
  const v4 = parseIPv4(value);
  if (v4) return isPublicIPv4(v4) ? v4.join(".") : null;
  const g = expandIPv6(value);
  if (!g) return null;
  if (g.every((n) => n === 0) || (g.slice(0, 7).every((n) => n === 0) && g[7] === 1)) return null; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return null; // ULA, link-local, multicast
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    const mapped = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]; // IPv4-mapped
    return isPublicIPv4(mapped) ? mapped.join(".") : null;
  }
  return g.slice(0, 4).map((n) => n.toString(16)).join(":") + "::/64";
}

function sourceFrom(env: Env): TrustedIpSource {
  const v = (env.GITGHOST_TRUSTED_IP_SOURCE ?? "none").trim().toLowerCase();
  return v === "header" || v === "xff-hops" ? v : "none";
}

function extractTrustedIp(h: HeaderReader, env: Env, source: TrustedIpSource): string | null {
  if (source === "header") {
    const name = (env.GITGHOST_TRUSTED_IP_HEADER ?? "").trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(name)) return null;
    const value = h.get(name);
    return value && !value.includes(",") ? normalizePublicIp(value) : null;
  }
  if (source === "xff-hops") {
    const hops = Number(env.GITGHOST_TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 1 || hops > 10) return null;
    const entries = (h.get("x-forwarded-for") ?? "").split(",").map((e) => e.trim());
    if (entries.length < hops) return null;
    return normalizePublicIp(entries[entries.length - hops]);
  }
  return null;
}

export function resolveClientIdentity(h: HeaderReader, env: Env = process.env): ClientIdentity {
  const source = sourceFrom(env);
  const ip = extractTrustedIp(h, env, source);
  if (!ip) return { key: UNVERIFIED_KEY, verified: false, source };
  // Keyed hash when a pepper is configured, so stored keys cannot be reversed by trying every IPv4.
  // The key must be identical on every instance, so there is no per-process random salt.
  const pepper = env.GITGHOST_CLIENT_KEY_PEPPER;
  const digest = pepper ? createHmac("sha256", pepper).update(ip).digest("hex") : createHash("sha256").update(`gitghost:${ip}`).digest("hex");
  return { key: digest.slice(0, 24), verified: true, source };
}

/** Compatibility wrapper: the rate-limit key only. */
export function clientKeyFromHeaders(h: HeaderReader, env: Env = process.env): string {
  return resolveClientIdentity(h, env).key;
}
