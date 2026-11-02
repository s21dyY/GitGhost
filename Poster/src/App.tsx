type IconName = "server" | "database" | "ghost" | "shield" | "people" | "archive" | "tool" | "link" | "chat" | "rewind" | "coin"

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    "aria-hidden": true,
  }

  const paths: Record<IconName, React.ReactNode> = {
    server: (
      <>
        <rect x="3" y="4" width="18" height="6" />
        <rect x="3" y="14" width="18" height="6" />
        <path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5.5" rx="8" ry="3" />
        <path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    ghost: (
      <>
        <path d="M5 20V10a7 7 0 0 1 14 0v10l-3-2-4 2-4-2z" />
        <path d="M9 10h1M14 10h1M9 14h6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
        <path d="M8.5 12l2 2 5-5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c0-4 2.7-7 6-7s6 3 6 7M15 14c3 0 5 2.5 5 6" />
      </>
    ),
    archive: (
      <>
        <path d="M4 7h16v14H4zM3 3h18v4H3z" />
        <path d="M9 11h6M8 16h8" />
      </>
    ),
    tool: (
      <path d="M14.5 6.5a4 4 0 0 0-5-5L12 4 9 7 6.5 4.5a4 4 0 0 0 5 5L4 17l3 3 7.5-7.5a4 4 0 0 0 5-5L17 10l-3-3z" />
    ),
    link: (
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    ),
    chat: (
      <>
        <path d="M4 4h16v12H9l-5 4z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
    rewind: <path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" />,
    coin: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M14.5 9h-3.5a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9.5M12 7v2M12 15v2" />
      </>
    ),
  }
  return <svg {...common}>{paths[name]}</svg>
}

function SectionTitle({
  number,
  children,
}: {
  number: string
  children: React.ReactNode
}) {
  return (
    <div className="section-title">
      <span>{number}</span>
      <h2>{children}</h2>
    </div>
  )
}

function App() {
  const steps = [
    ["link", "SUMMON", "Paste any public GitHub repository URL."],
    ["ghost", "MEET", "The repo becomes a ghost, the same one every visit."],
    ["chat", "ASK", "Answers cite real commits and issues. Tap one to check."],
    [
      "rewind",
      "REWIND",
      "Pick an old commit. It answers as of then, no later.",
    ],
  ] as const

  const values = [
    [
      "people",
      "Legacy-code onboarding",
      "Learn an unfamiliar repo through its own history.",
    ],
    [
      "archive",
      "Knowledge recovery",
      "Surface the reasoning buried in commits and issues.",
    ],
    [
      "shield",
      "Trustworthy AI tools",
      "Every claim is tied to evidence a developer can check.",
    ],
  ] as const

  const requestPath = [
    ["server", "API ROUTE", "POST /api/chat", "Checks every question before any work starts."],
    ["database", "IDENTITY", "DynamoDB", "Finds the repo's saved ghost, the same every visit."],
    ["link", "EVIDENCE", "GitHub REST", "Gathers the repo's commits, issues and README."],
    ["coin", "AI GATE", "Usage counters", "Enforces rate limits and budget before any AI call."],
    ["chat", "ANSWER", "Scripted | Bedrock", "Writes the reply and drops any claim without a source."],
  ] as const

  const dataLayer = [
    ["Saved ghosts · DynamoDB", "One record per repo, so every visitor meets the same ghost."],
    ["Usage counters · DynamoDB", "Shared counters cap AI requests and spend across servers."],
    ["Locked-down permissions", "The app can do only what it needs."],
  ]

  const decisions = [
    ["One ghost per repo, even under a race", "Conditional put: one write wins, the loser reads the winner."],
    ["Cache what's safe, never failures", "Identities 24 h, evidence 10 min. Never failures or fallbacks."],
    ["Stays up when storage goes down", "Timeout + circuit breaker → labeled provisional ghost."],
    ["AI spend can't run away", "Reserve worst-case cost atomically; shared kill switch."],
  ]

  return (
    <main className="page-shell">
      <button className="print-button" onClick={() => window.print()}>
        Export print-ready PDF
      </button>

      <article className="poster">
        <div className="ambient-grid" aria-hidden="true" />

        <header className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> REVERSE CAREER FAIR · TECHNICAL PROJECT
            </div>
            <h1>
              GIT<span>GHOST</span>
            </h1>
            <p className="tagline">Your code is dead. Its story isn&apos;t.</p>
            <p className="hero-summary">
              Paste a public GitHub repository and meet its ghost. Ask why the
              code was written that way, and every answer points back to{" "}
              <b>real commits, issues and READMEs.</b>
            </p>
          </div>

          <figure className="ghost-forms">
            <div>
              {["human", "distorted", "horror"].map((form, index) => (
                <span key={form}>
                  {index > 0 && <i aria-hidden="true">→</i>}
                  <img src={`/ghost-${form}.png`} alt={`The Archivist ghost, ${form} form`} />
                </span>
              ))}
            </div>
          </figure>
          <div className="hero-meta">
            <div className="presenter">
              <strong>SANDY YANG</strong>
              <i /> MISM BIDA
            </div>
            <div className="hero-tags">
              <span>Backend engineering</span>
              <span>Grounded AI</span>
              <span>AWS</span>
            </div>
          </div>
        </header>

        <section className="split-area intro-area">
          <div className="panel problem">
            <SectionTitle number="01">THE PROBLEM</SectionTitle>
            <div className="problem-grid">
              <blockquote>“Why was this code written this way?”</blockquote>
              <p>
                Old backend code often still runs, but the reasoning behind it
                fades, scattered across commits, issues and READMEs. The idea
                came from a TSMC interview conversation:{" "}
                <b>what if you could simply ask the code?</b>
              </p>
            </div>
          </div>

          <div className="panel matters">
            <SectionTitle number="02">
              WHY IT MATTERS
            </SectionTitle>
            <div className="value-cards">
              {values.map(([icon, title, text]) => (
                <div key={title}>
                  <Icon name={icon} size={26} />
                  <p>
                    <b>{title}</b>
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel how">
          <SectionTitle number="03">
            HOW IT WORKS: ASK THE CODE ITSELF
          </SectionTitle>
          <ol className="steps">
            {steps.map(([icon, title, text]) => (
              <li key={title}>
                <div className="step-head">
                  <Icon name={icon} size={26} />
                  <b>{title}</b>
                </div>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel architecture">
          <SectionTitle number="04">
            BACKEND DESIGN
          </SectionTitle>
          <ol className="request-path">
            {requestPath.map(([icon, stage, tech, text]) => (
              <li key={stage}>
                <div className="hop-head">
                  <Icon name={icon} size={20} />
                  <b>{stage}</b>
                </div>
                <code>{tech}</code>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <div className="data-layer">
            <span>ON AWS</span>
            {dataLayer.map(([name, text]) => (
              <p key={name}>
                <b>{name}</b>
                {text}
              </p>
            ))}
          </div>
        </section>

        <section className="split-area proof-area">
          <div className="panel trust">
            <SectionTitle number="05">ENGINEERING DECISIONS</SectionTitle>
            <dl className="qa-list">
              {decisions.map(([decision, detail]) => (
                <div key={decision}>
                  <dt>{decision}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="panel scorecard">
            <SectionTitle number="06">HOW I VALIDATED IT</SectionTitle>
            <div className="validation-story">
              <p className="lead">
                Set invariants, then try to break them.
              </p>
              <p>
                Three invariants drove the design:{" "}
                <b>one identity per repo ID, no uncited claim in a response,
                and AI spend capped before every call.</b> Tests attack each
                one: 20 concurrent writers on one conditional put, a storage
                outage, corrupted rows and prompt-injection payloads.
              </p>
              <p>
                Then real dependencies: a live DynamoDB first-write-wins check,
                repos up to atom/atom&apos;s 38,000+ commits, and one
                budget-capped Bedrock call with the kill switch re-locked
                after. Scripted replies stay the default path.
              </p>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div className="contribution">
            <h2>
              <Icon name="tool" size={24} /> TOOLS &amp; SKILLS
            </h2>
            <div className="tech-stack">
              <b>STACK</b>
              {[
                "Next.js",
                "TypeScript",
                "Zod",
                "GitHub REST",
                "AWS DynamoDB",
                "AWS Bedrock",
                "Vitest",
              ].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="tech-stack skills">
              <b>SKILLS</b>
              {[
                "Backend design",
                "API design",
                "Data modeling",
                "Grounded AI",
                "Kiro · spec-driven dev",
              ].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          </div>
          <div className="contact">
            <img src="/linkedin-qr.svg" alt="QR code linking to Sandy Yang's LinkedIn profile" />
            <p>
              <b>LET&apos;S CONNECT!</b>
            </p>
          </div>
        </footer>
      </article>
    </main>
  )
}

export default App
