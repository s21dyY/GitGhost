import { describe, expect, it } from "vitest";
import { clientKeyFromHeaders, normalizePublicIp, resolveClientIdentity, UNVERIFIED_KEY } from "./client-key";

const h = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
const XFF1 = { GITGHOST_TRUSTED_IP_SOURCE: "xff-hops", GITGHOST_TRUSTED_PROXY_HOPS: "1" };
const XFF2 = { GITGHOST_TRUSTED_IP_SOURCE: "xff-hops", GITGHOST_TRUSTED_PROXY_HOPS: "2" };

describe("default: no header is trusted", () => {
  it("ignores X-Forwarded-For, X-Real-IP and look-alike headers, so every request shares one bucket", () => {
    const keys = ([
      { "x-forwarded-for": "203.0.113.9" },
      { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
      { "x-real-ip": "203.0.113.50" },
      { "x-vercel-forwarded-for": "203.0.113.60" },
      { forwarded: "for=203.0.113.70" },
      {},
    ] as Record<string, string>[]).map((headers) => resolveClientIdentity(h(headers), {}));
    for (const k of keys) {
      expect(k).toEqual({ key: UNVERIFIED_KEY, verified: false, source: "none" });
    }
  });

  it("unknown or misspelled source settings fail closed to 'none'", () => {
    for (const v of ["Trust-Everything", "xff", "true", ""]) {
      expect(resolveClientIdentity(h({ "x-forwarded-for": "203.0.113.9" }), { GITGHOST_TRUSTED_IP_SOURCE: v }).verified).toBe(false);
    }
  });
});

describe("xff-hops: only entries added by trusted proxies count", () => {
  it("takes the Nth entry from the right and ignores client-supplied left entries", () => {
    const real = resolveClientIdentity(h({ "x-forwarded-for": "203.0.113.9" }), XFF1);
    expect(real.verified).toBe(true);
    const forged = resolveClientIdentity(h({ "x-forwarded-for": "198.51.100.77, 203.0.113.9" }), XFF1);
    expect(forged.key).toBe(real.key);
    const twoProxies = resolveClientIdentity(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 192.0.2.1" }), XFF2);
    expect(twoProxies.key).toBe(real.key);
  });

  it("is unverified when the chain is shorter than the trusted hop count, or hops are misconfigured", () => {
    expect(resolveClientIdentity(h({ "x-forwarded-for": "203.0.113.9" }), XFF2).verified).toBe(false);
    expect(resolveClientIdentity(h({}), XFF1).verified).toBe(false);
    for (const hops of ["0", "-1", "abc", "11", "1.5", ""]) {
      expect(resolveClientIdentity(h({ "x-forwarded-for": "203.0.113.9" }), { GITGHOST_TRUSTED_IP_SOURCE: "xff-hops", GITGHOST_TRUSTED_PROXY_HOPS: hops }).verified).toBe(false);
    }
  });
});

describe("header mode: one header set by the trusted edge", () => {
  const env = { GITGHOST_TRUSTED_IP_SOURCE: "header", GITGHOST_TRUSTED_IP_HEADER: "X-Edge-Client-IP" };
  it("reads only the named header", () => {
    const a = resolveClientIdentity(h({ "x-edge-client-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }), env);
    expect(a.verified).toBe(true);
    expect(a.key).toBe(resolveClientIdentity(h({ "x-edge-client-ip": "203.0.113.9" }), env).key);
    expect(resolveClientIdentity(h({ "x-forwarded-for": "203.0.113.9" }), env).verified).toBe(false);
  });
  it("rejects lists, bad header names and missing configuration", () => {
    expect(resolveClientIdentity(h({ "x-edge-client-ip": "203.0.113.9, 198.51.100.1" }), env).verified).toBe(false);
    expect(resolveClientIdentity(h({ "x-edge-client-ip": "203.0.113.9" }), { GITGHOST_TRUSTED_IP_SOURCE: "header" }).verified).toBe(false);
    expect(resolveClientIdentity(h({ "x-edge-client-ip": "203.0.113.9" }), { GITGHOST_TRUSTED_IP_SOURCE: "header", GITGHOST_TRUSTED_IP_HEADER: "bad name!" }).verified).toBe(false);
  });
});

describe("address validation", () => {
  it.each(["10.0.0.1", "127.0.0.1", "192.168.1.5", "172.16.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "ff02::1", "999.1.1.1", "1.2.3", "not-an-ip", "<script>", "203.0.113.9; drop", "a".repeat(100), "::ffff:10.0.0.1"])(
    "%s is never a client identity",
    (ip) => {
      expect(normalizePublicIp(ip)).toBeNull();
      expect(resolveClientIdentity(h({ "x-forwarded-for": ip }), XFF1).verified).toBe(false);
    },
  );

  it("groups IPv6 by /64 so one host cannot rotate through addresses", () => {
    const a = clientKeyFromHeaders(h({ "x-forwarded-for": "2001:db8:1:2::1" }), XFF1);
    expect(clientKeyFromHeaders(h({ "x-forwarded-for": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }), XFF1)).toBe(a);
    expect(clientKeyFromHeaders(h({ "x-forwarded-for": "2001:db8:1:3::1" }), XFF1)).not.toBe(a);
    expect(a).not.toBe(UNVERIFIED_KEY);
  });

  it("maps IPv4-mapped IPv6 to the IPv4 bucket", () => {
    expect(normalizePublicIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
});

describe("keys", () => {
  it("are opaque, stable across calls, and never contain the address", () => {
    const k = clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.9" }), XFF1);
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    expect(k).toBe(clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.9" }), XFF1));
    expect(k).not.toContain("203");
    expect(k).not.toBe(clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.10" }), XFF1));
  });
  it("a pepper changes the keys (so stored keys are not reversible without it)", () => {
    const plain = clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.9" }), XFF1);
    const peppered = clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.9" }), { ...XFF1, GITGHOST_CLIENT_KEY_PEPPER: "p" });
    expect(peppered).not.toBe(plain);
  });
});
