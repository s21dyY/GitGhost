# Cost controls and abuse limits (Milestone 2B)

Status: implemented and unit-tested with fakes. **No Bedrock call was made. No AWS resource was created or changed. Nothing is deployed.** The numbers below are initial development values, not verified production-safe values.

## What the code enforces

A chat request passes these gates in order. The first four need no shared storage; the rest apply only to billable (Bedrock) requests.

| # | Gate | Where it lives | Scope |
|---|---|---|---|
| 1 | Configuration valid (a malformed value is an error, never a silent default) | `src/server/chat/config.ts` | each process |
| 2 | Bedrock needs `GITGHOST_BEDROCK_ENABLED=true` AND `GITGHOST_CHAT_PROVIDER=bedrock` (default: false, mock) | `config.ts`, `service.ts` | each process |
| 3 | Environment kill switch `GITGHOST_BEDROCK_KILL_SWITCH=true` | `service.ts` | each process (needs redeploy) |
| 4 | Input guard: pessimistic estimate (1 token per 2 UTF-8 bytes) must be within `GITGHOST_MAX_INPUT_TOKENS` (4000) | `tokens.ts` | each request |
| 5 | Per-client limit `GITGHOST_CHAT_REQUESTS_PER_MINUTE` (5), fixed one-minute window | usage store | **shared** with a DynamoDB store, per process with memory |
| 6 | Shared kill switch: item `KILL#bedrock` with `on = true` (strongly consistent read, every billable call) | usage store | **shared**, takes effect without a redeploy |
| 7 | Global concurrency `GITGHOST_CHAT_CONCURRENCY` (2) using expiring leases | usage store | **shared** |
| 8 | Global requests per UTC day `GITGHOST_CHAT_REQUESTS_PER_DAY` (100) | usage store | **shared** |
| 9 | Budget: the worst-case cost of the request is **atomically reserved** before the call, against `GITGHOST_DAILY_BUDGET_USD` (1.00) per UTC day | usage store | **shared** |
| 10 | Call with an output cap (`GITGHOST_MAX_OUTPUT_TOKENS`, 300) and a timeout (`GITGHOST_CHAT_TIMEOUT_MS`, 20 s) | provider | each request |
| 11 | Reconcile with actual token usage | usage store | **shared** |

Worst-case reservation = (max input tokens x input price + max output tokens x output price) x safety factor (default 1.25). Prices have **no defaults** and must be supplied by the operator (`GITGHOST_BEDROCK_INPUT_USD_PER_MTOK`, `GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK`); without them Bedrock refuses to run. With prices of 1 and 5 USD per million tokens (illustrative, not verified) one reservation is 6,875 micro-dollars, so a 1 USD day admits about 145 reservations, and the 100-requests-per-day cap bites first.

### How uncertain outcomes are handled
- **Budget storage unavailable, not configured, or any shared step throws:** the billable request is refused (`budget_unavailable`) and the provider is never called. Steps already taken are undone best-effort; if an undo fails the counters stay over-counted (the safe direction).
- **Success with usage:** the reservation is replaced by the actual cost (usually a refund). Actual cost above the reservation is charged in full and logged.
- **Success without usage data:** the full reservation stays.
- **Provider rejected the request itself** (`ValidationException`, `AccessDeniedException`, `ResourceNotFoundException`, and only when the HTTP status is 4xx): refunded. This list is an assumption about Bedrock, not verified here. `ThrottlingException` is deliberately NOT refunded (changed in Milestone 2B.1): a throttle we cannot prove was unbilled would weaken the cap. Every other error, a missing or malformed status, timeouts and anything unrecognized count as possibly billed.
- **Timeout, network loss, 5xx, throttling, unknown error, crash, process death:** the full reservation stays and the concurrency lease is left to expire on its own (timeout + 10 s). Nothing ever refunds these.
- **Failed reconciliation write:** the reservation stands; the user still gets the answer.
- **A late response after a timeout** cannot change the books.

### What is NOT a hard cap
- AWS Budgets alerts and budget actions react after spend happens; they are not used as a cap here.
- The reservation caps what **this application** will start. It does not cap spend from other callers of the same AWS account or role, and the real price is only as good as the prices you configure.
- Bedrock usage reconciliation trusts the token counts Bedrock returns.

## Client identity (Task B audit)

**Findings.** Before this milestone, `/api/summon` and the repo page keyed their limits on the first entry of `X-Forwarded-For` (then `X-Real-IP`). Any client can send those headers, so rotating the value gave a fresh bucket each time and bypassed the per-client limits.

**Now.** No client-supplied header is trusted by default (`GITGHOST_TRUSTED_IP_SOURCE=none`): every request shares one `unverified` bucket, so per-client limits behave like global limits. Two opt-in modes exist, both of which require you to assert what your host does:

- `header`: read one header named in `GITGHOST_TRUSTED_IP_HEADER` that your host's edge sets or overwrites with the client IP.
- `xff-hops`: with `GITGHOST_TRUSTED_PROXY_HOPS=N`, use the Nth entry from the **right** of `X-Forwarded-For`; entries to the left are client-controlled and ignored.

Extracted values are rejected if they are malformed, private, loopback, link-local, multicast or unspecified; IPv6 is grouped by /64; keys are hashed (HMAC if `GITGHOST_CLIENT_KEY_PEPPER` is set) and are identical on every instance. The code cannot check that a host really behaves as declared.

**Deployment environment.** None is decided. The repo has no `vercel.json`, Amplify config, Dockerfile or CI, and `BUILD.md` says to choose Vercel or Amplify after a deployment smoke test. So no host-specific mode is pre-selected. Before going public:

1. Pick the host.
2. Read its documentation for which request header carries the true client IP and whether it overwrites a client-sent value. (I did not verify this for Vercel or Amplify.)
3. Deploy a test route that echoes the headers, send forged `X-Forwarded-For` values, and confirm which entry is trustworthy.
4. Set `GITGHOST_TRUSTED_IP_SOURCE` (and the header name or hop count) accordingly.

**Local development.** With the default, all local requests share one bucket, which is fine for one developer. With `xff-hops`/`header` you can test with curl, but locally nothing overwrites those headers, so do not treat them as proof of anything.

**Global limits do not depend on identity.** Daily request count, concurrency, and the spending reservation are not keyed by client, so rotating identifiers cannot raise them. The summon routes also have process-wide caps (`SUMMON_API_GLOBAL_LIMIT`, `SUMMON_PAGE_GLOBAL_LIMIT`).

## Per process vs across instances

| Control | Across multiple instances? |
|---|---|
| Chat per-client limit, daily request count, concurrency leases, budget reservation, shared kill switch | **Yes, only with the DynamoDB usage store.** With `GITGHOST_USAGE_STORE=memory` they are per process. The memory store is refused for billable requests in production. |
| Env kill switch, config checks, input and output token caps, timeout | Per request/process, but identical on every instance if the environment is identical |
| `/api/summon` and repo page limits, identity-creation budget, identity cache, store circuit breaker (Milestone 2A.5) | **Per process only** (in memory). On serverless hosting each instance counts separately. |

## Needs AWS or hosting configuration (not done by code)

1. **Create the usage table** (not created). Suggested: name `gitghost-usage-counters`, partition key `pk` (String), on-demand billing, **TTL enabled on attribute `expiresAt`** (without TTL, old minute and day counters accumulate), deletion protection on. Set `GITGHOST_USAGE_TABLE`.
2. **IAM for the runtime role:** `dynamodb:UpdateItem` and `dynamodb:GetItem` on that table only. (Not changed.)
3. **Instant kill switch:** put an item `{pk: "KILL#bedrock", on: true}` in the table (console or CLI) to stop all new Bedrock invocations on every instance within one request; delete it or set `on` false to resume.
4. **Bedrock access:** model access and an IAM policy allowing `bedrock:InvokeModel` on the one inference profile. An org-level SCP already blocks DynamoDB in us-east-1; confirm Bedrock invocation (including cross-region profile routing) is allowed in your regions.
5. **Hosting:** choose the host, verify its client-IP header behavior (above), and set the trusted-IP variables. Consider host-level or edge rate limiting and bot protection in front of the app; this code only limits at the application layer.
6. **AWS Budgets / billing alerts:** useful as a tripwire, never as a cap.
7. **Prices:** copy current Bedrock prices into the two price variables, and recheck them when they change.

## Limits of the evidence
- The DynamoDB store is tested only against a small in-repo emulator of the handful of expressions it uses (`test-support.ts`). It proves request shapes and our logic, not real DynamoDB behavior. A live test against the real table has not been run because the table does not exist.
- The Bedrock provider is tested only with fake clients. The opt-in live test (`src/server/chat/live.bedrock.test.ts`, needs `GITGHOST_LIVE_BEDROCK_TESTS=1` and `GITGHOST_LIVE_BEDROCK_TESTS_ACK=I_ACCEPT_COST`) has not been run.
- No `/api/chat` route or UI exists yet. The route to be built in M2B must call `runChat` and nothing else.

## Lease expiry (reviewed in Milestone 2B.1)
Expiry of a concurrency lease is decided by application logic: acquiring a slot succeeds only if `leaseUntilMs` is absent or earlier than the caller's clock (`attribute_not_exists(leaseUntilMs) OR leaseUntilMs < :now`). DynamoDB TTL (`expiresAt`) is only cleanup, set hours after the lease ends, and is never consulted, so delayed TTL deletion cannot keep a slot blocked and cannot free one early. A crashed holder therefore stops blocking when its own deadline passes (timeout + 10 s). Residual risk: instances compare against their own clocks, so a badly skewed clock could steal or hold a slot for the skew duration; the lease is longer than the request timeout to absorb small skew. Window counters (per minute, per day) use per-window keys, so a stale item can never affect a new window.
