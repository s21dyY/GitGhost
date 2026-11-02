import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity } from "@/domain/entity";
import { FormToggle, GhostNotes, GhostScene, type GhostView } from "@/components/entity/GhostPanel";
import { GhostFormProvider } from "@/components/entity/GhostFormContext";
import { ChatPanel } from "./ChatPanel";
import { ConversationProvider } from "./ConversationProvider";
import { EvidenceJournal } from "./EvidenceJournal";

const assignment = assignmentFromIdentity(buildEntity({ repoId: 3228505, repoName: "atom/atom" }, "seed"), "2026-10-31T12:00:00.000Z");
const ghost: Extract<GhostView, { assignment: unknown }> = { status: "persisted", assignment };
const page = (children: React.ReactNode) =>
  renderToStaticMarkup(
    <GhostFormProvider>
      <ConversationProvider owner="atom" repo="atom">
        {children}
      </ConversationProvider>
    </GhostFormProvider>,
  );

describe("dialogue window (server-rendered initial state)", () => {
  const html = page(<ChatPanel repo="atom" ghost={ghost} />);

  it("is a labelled region with a conversation log, a labelled input and a separate live status", () => {
    expect(html).toMatch(/<section[^>]*aria-labelledby=/);
    expect(html).toContain("Ask the ghost");
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="off"'); // the status region announces answers once, in full
    expect(html).toContain('tabindex="0"'); // the scrollable log must be reachable by keyboard
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Your question<\/label>/);
    expect(html).toContain("<h1"); // the nameplate is the page heading
    expect(html).toMatch(/<textarea[^>]*id="[^"]+"/);
    expect(html).toContain("Enter sends. Shift+Enter adds a new line.");
    expect(html).toMatch(/<p role="status" class="sr-only">/);
  });

  it("shows the speaker, a portrait, and says plainly that the conversation is scripted", () => {
    expect(html).toContain("Scripted mock");
    expect(html).toContain("No AI model is called");
    expect(html).toContain('aria-hidden="true"'); // the portrait repeats the scene figure, which carries the description
    expect(html).toContain("dlg-portrait");
    expect(html).toContain("atom");
    expect(html).toContain("Answers come only from sources retrieved from GitHub");
  });

  it("offers conversation starters as real buttons", () => {
    for (const q of ["Why did you die?", "What happened lately?", "How did you begin?", "What were people complaining about?"]) {
      expect(html).toContain(q);
    }
    expect((html.match(/<button[^>]*type="button"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("starts with the send button disabled", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it("introduces no personality selector or debug controls", () => {
    expect(html).not.toMatch(/personality|persona|<select|type="radio"|Development only/i);
  });

  it("uses no inline animation of its own: motion comes from CSS classes that reduced-motion switches off", () => {
    expect(html).not.toMatch(/style="[^"]*animation/);
  });
});

describe("evidence journal", () => {
  const sources = [
    { kind: "repo-metadata", url: "https://github.com/atom/atom" },
    { kind: "commit", url: "https://github.com/atom/atom/commit/1c3bd35ce238dc0491def9e1780d04748d8e18af", revisionSha: "1c3bd35ce238dc0491def9e1780d04748d8e18af" },
  ];
  const html = page(<EvidenceJournal sources={sources} retrievedAt="2026-10-31T12:00:00.000Z" readme={{ excerpt: "# Atom", truncated: true }} />);

  it("lists page sources as real GitHub links, with the README as plain text", () => {
    expect(html).toContain("No answers yet");
    expect(html).toContain('href="https://github.com/atom/atom"');
    expect(html).toContain("at 1c3bd35");
    expect(html).toContain("treated as untrusted");
    expect(html).toContain("Truncated excerpt");
  });

  it("every outbound link opens safely in a new tab", () => {
    for (const m of html.matchAll(/<a [^>]*>/g)) {
      expect(m[0]).toContain('target="_blank"');
      expect(m[0]).toContain("noopener");
    }
  });
});

describe("the ghost in the Séance keeps its existing look", () => {
  it("still renders the sprite, saved notice and the human/horror toggle in production mode", () => {
    const out = renderToStaticMarkup(
      <GhostFormProvider>
        <GhostScene view={ghost} />
        <FormToggle />
        <GhostNotes view={ghost} />
      </GhostFormProvider>,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain("Before the forgetting");
    expect(out).toContain("As it is now");
    expect(out).toContain("Identity saved");
    expect(out).not.toContain("Development only");
  });
});
