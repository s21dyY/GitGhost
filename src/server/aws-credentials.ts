import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/**
 * AWS credentials for server code, in one place.
 *
 *  - On Vercel, with `AWS_ROLE_ARN` set: Vercel's OIDC token is exchanged for short-lived credentials of that role
 *    (https://vercel.com/docs/oidc/aws). No access keys exist anywhere.
 *  - Everywhere else (local dev, tests): `undefined`, so the AWS SDK keeps its default credential chain and any named
 *    profile the caller passes. Nothing about local development changes.
 *
 * The provider is created once per role ARN and reused; creating it makes no network call.
 */
export type AwsCredentialIdentityProvider = ReturnType<typeof awsCredentialsProvider>;
let cached: { arn: string; provider: AwsCredentialIdentityProvider } | undefined;

export function oidcCredentials(env: Record<string, string | undefined> = process.env): AwsCredentialIdentityProvider | undefined {
  const arn = env.AWS_ROLE_ARN?.trim();
  if (!arn) return undefined;
  if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@\/-]{1,512}$/.test(arn)) throw new Error("AWS_ROLE_ARN is not a valid IAM role ARN.");
  if (cached?.arn !== arn) cached = { arn, provider: awsCredentialsProvider({ roleArn: arn }) };
  return cached.provider;
}

/** Client options with OIDC credentials when configured. With OIDC a named profile is never used. */
export function withAwsCredentials<T extends object>(
  options: T & { profile?: string },
  env: Record<string, string | undefined> = process.env,
): Omit<T, "profile"> & { profile?: string; credentials?: AwsCredentialIdentityProvider } {
  const credentials = oidcCredentials(env);
  if (!credentials) return options;
  const { profile: _profile, ...rest } = options;
  void _profile;
  return { ...rest, credentials };
}
