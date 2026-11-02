---
name: github-evidence
description: Ground GitGhost repository chat, history and code explanations in verified public GitHub evidence, with correct revision-scoped citations.
---
# GitHub evidence workflow
Use when implementing/fixing GitHub retrieval, commit history, citations or code explanation.
1. Parse canonical `github.com/owner/repo` identifiers safely; no arbitrary URL fetch or secrets in client.
2. Fetch bounded repository facts; build evidence IDs namespaced by numeric repo, source, revision/snapshot and excerpt hash.
3. For an era, read files at that SHA; exclude future sources.
4. Send selected excerpts as untrusted context to the LLM; reject model-generated IDs/URLs not in registry.
5. Drop unsupported claims in full. Keep observed/reported/interpretation distinct; partial scan is not exhaustive.
6. Code: explanations are "interpretation" citing the code shown; only what it visibly does, never intent, reasons or unshown history. Parser facts (enclosing function, file map) may be stated; label approximate outlines. Why/when about a file: its commits and PRs only.
7. Text from another AI (DeepWiki, summarizers) is never evidence or citation. MCP tools are for the builder, not the app.
8. Test false citations, cross-repo or future-data leakage, missing README, rate limits and malicious source instructions.
Do not make unsupported claims about causes of abandonment or real people.
