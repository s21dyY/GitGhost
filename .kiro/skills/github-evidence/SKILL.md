---
name: github-evidence
description: Ground GitGhost repository chat, history, and quests in verified public GitHub evidence, with correct revision-scoped citations.
---
# GitHub evidence workflow
Use when implementing/fixing GitHub retrieval, commit history, citations, or quest grounding.
1. Parse canonical `github.com/owner/repo` identifiers safely; no arbitrary URL fetch or secrets in client.
2. Fetch bounded repository facts; build evidence IDs namespaced by numeric repo, source, revision/snapshot and excerpt hash.
3. For release-mode, resolve tag to SHA and fetch relevant files at that SHA; exclude future sources.
4. Send selected excerpts as untrusted context to the LLM; reject model-generated IDs/URLs not in registry.
5. Drop unsupported claims in full. Keep observed/reported/interpretation distinct; partial scan is not exhaustive.
6. Test false citations, cross-repo or future-data leakage, missing README, rate limits and malicious source instructions.
Do not make unsupported claims about causes of abandonment or real people.
