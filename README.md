# GitGhost

Every repo has a ghost. A retro-horror graveyard of real public GitHub repositories. Work in progress for Kiroween 2026; see [the original plan](docs/history/BUILD.md) and `KIRO_LOG.md` for what has actually been built and verified.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:3000
npm test           # unit tests (no network)
npm run lint
npm run build
GITGHOST_LIVE=1 npm test   # also runs the live GitHub smoke test
```

Optional: set `GITHUB_TOKEN` in `.env.local` (git-ignored) for a higher GitHub rate limit. It is only read on the server. Without it, unauthenticated limits apply (60 requests/hour).

## Work done outside Kiro

Some features were built with another AI coding assistant alongside Kiro. `KIRO_LOG.md` lists only work done with Kiro; [DISCLOSURES.md](DISCLOSURES.md) lists the rest. Why the project rules changed: `.kiro/steering/decisions.md`.

## License

Open-source license file still to be added (see `BUILD.md`).