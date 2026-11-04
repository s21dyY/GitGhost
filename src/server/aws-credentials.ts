import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/**
 * AWS credentials for server code, in one place.
 *
 *  - On Vercel, with `AWS_ROLE_ARN` set: Vercel's OIDC token is exchanged for short-lived credentials of that role
 *    (https://vercel.com/docs/oidc/aws). No access keys exist anywhere.
 *  - On Vercel in an account that forbids OIDC providers: the keys of a narrowly scoped IAM user, in
 *    `GITGHOST_AWS_ACCESS_KEY_ID` / `GITGHOST_AWS_SECRET_ACCESS_KEY` (Vercel reserves the standard `AWS_*` names).
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

type StaticCredentials = { accessKeyId: string; secretAccessKey: string };

/** The scoped IAM user's keys, when both are set. */
export function keyCredentials(env: Record<string, string | undefined> = process.env): StaticCredentials | undefined {
  const accessKeyId = env.GITGHOST_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.GITGHOST_AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId && !secretAccessKey) return undefined;
  if (!accessKeyId || !secretAccessKey) throw new Error("Set both GITGHOST_AWS_ACCESS_KEY_ID and GITGHOST_AWS_SECRET_ACCESS_KEY, or neither.");
  return { accessKeyId, secretAccessKey };
}

/**
 * The AWS region for every client. `GITGHOST_AWS_REGION` wins because Vercel sets `AWS_REGION` itself, to the region
 * the function happens to run in, which is not where the tables and model are.
 */
export function awsRegion(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GITGHOST_AWS_REGION?.trim() || env.AWS_REGION?.trim() || undefined;
}

/** Client options with OIDC or key credentials when configured. With either, a named profile is never used. */
export function withAwsCredentials<T extends object>(
  options: T & { profile?: string },
  env: Record<string, string | undefined> = process.env,
): Omit<T, "profile"> & { profile?: string; credentials?: AwsCredentialIdentityProvider | StaticCredentials } {
  const credentials = oidcCredentials(env) ?? keyCredentials(env);
  if (!credentials) return options;
  const { profile: _profile, ...rest } = options;
  void _profile;
  return { ...rest, credentials };
}
