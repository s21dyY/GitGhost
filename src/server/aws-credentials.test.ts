import { describe, expect, it } from "vitest";
import { oidcCredentials, withAwsCredentials } from "./aws-credentials";

const ARN = "arn:aws:iam::123456789012:role/gitghost-vercel";

describe("AWS credentials: Vercel OIDC only when AWS_ROLE_ARN is set", () => {
  it("without AWS_ROLE_ARN nothing changes: default chain, named profile kept", () => {
    expect(oidcCredentials({})).toBeUndefined();
    expect(oidcCredentials({ AWS_ROLE_ARN: "  " })).toBeUndefined();
    const opts = { region: "us-east-2", profile: "gitghost-smoke" };
    expect(withAwsCredentials(opts, {})).toBe(opts);
  });
  it("with AWS_ROLE_ARN the client gets a credentials provider and never a profile", () => {
    const out = withAwsCredentials({ region: "us-east-2", profile: "gitghost-smoke", maxAttempts: 1 }, { AWS_ROLE_ARN: ARN });
    expect(out).toMatchObject({ region: "us-east-2", maxAttempts: 1 });
    expect("profile" in out).toBe(false);
    expect(typeof out.credentials).toBe("function"); // creating the provider makes no network call
  });
  it("reuses one provider per role ARN", () => {
    expect(oidcCredentials({ AWS_ROLE_ARN: ARN })).toBe(oidcCredentials({ AWS_ROLE_ARN: ARN }));
  });
  it("refuses a malformed role ARN instead of guessing", () => {
    expect(() => oidcCredentials({ AWS_ROLE_ARN: "arn:aws:iam::12:role/x" })).toThrow(/not a valid IAM role ARN/);
    expect(() => oidcCredentials({ AWS_ROLE_ARN: "arn:aws:iam::123456789012:user/someone" })).toThrow(/not a valid IAM role ARN/);
  });
});
