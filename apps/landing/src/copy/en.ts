// All user-visible strings live here (INV-08: English only, no i18n framework).
// Never import an i18n library. Add a new language by adding a sibling file
// and a runtime locale switch — but not before product/market fit.

export const copy = {
  meta: {
    title: 'MCPInsight — Which of your MCP servers actually earn their seat?',
    description:
      'MCPInsight scores every MCP server you run in Claude Code, Codex, and Cursor on activation, success rate, tool use, and clarity. Local, open source, ~60 seconds to first insight.',
  },
  nav: {
    brand: 'MCPInsight',
    githubCtaLabel: 'Star on GitHub',
    teamsCtaLabel: 'For teams',
    primaryCtaLabel: 'Notify me',
  },
  hero: {
    eyebrow: 'Building in public · Week 3 of 6',
    headline: 'Which of your MCP servers actually earn their seat?',
    subhead:
      "Claude Code's Tool Search defuses context bloat — but it won't tell you which of your MCP servers are zombies, which are drag, and which are actually pulling their weight. MCPInsight reads the logs you already have and scores each server 0–100. Local, open source.",
    proofLinkLabel: 'Open source on GitHub',
  },
  waitlist: {
    emailLabel: 'Email address',
    emailPlaceholder: 'you@company.dev',
    submit: 'Get early access — launches Week 4',
    privacy: 'We email you when we launch. No spam, unsubscribe anytime.',
    errorInvalid: 'Please enter a valid email address.',
    errorGeneric: 'Something went wrong. Please try again in a moment.',
    successHeading: "You're on the list.",
    successBody: "We'll email you the moment MCPInsight opens. Thanks for the trust.",
  },
  problem: {
    sectionLabel: 'The problem',
    heading: 'Tool Search made the token bill quieter — not the usage question clearer',
    cards: [
      'You installed 12 MCP servers. You remember configuring 6 of them. Which of the other 6 actually fire?',
      'Your agent picks the wrong tool 30 % of the time. Is the culprit one bad server, or all of them?',
      'Every tool call is logged in `~/.claude/projects/*.jsonl`. Nothing reads those logs — until now.',
    ],
  },
  solution: {
    sectionLabel: 'The solution',
    heading: 'A Health Score for every MCP server you run',
    localityNote: 'Runs locally. Your data never leaves your machine. MIT-licensed.',
    cards: [
      {
        title: 'Health Score 0–100',
        body: 'Per-server score from activation (30 %), success rate (30 %), tool utilization (20 %), clarity (10 %), token efficiency (10 %).',
      },
      {
        title: 'Zombie detection',
        body: "The 7 servers you haven't touched in 30 days — flagged, with one-line actions to remove them.",
      },
      {
        title: 'Per-tool attribution',
        body: 'See which tools each server actually called, error rates, and average output cost — across every session.',
      },
      {
        title: 'Cross-client',
        body: 'Claude Code and Codex today. Cursor next. Your MCP picture in one place.',
      },
    ],
  },
  buildInPublic: {
    sectionLabel: 'Build in public',
    heading: 'Shipping weekly. Follow the build.',
    subhead:
      'Code, roadmap, and commit log are public from day one. Starring the repo is the cheapest way to keep tabs.',
    roadmap: [
      { week: 'Week 1', title: 'Landing + waitlist', status: 'done' },
      { week: 'Week 2', title: 'Parser + CLI top', status: 'done' },
      { week: 'Week 3', title: 'Dashboard + Health Score v2', status: 'done' },
      { week: 'Week 4', title: 'State of MCP + soft launch', status: 'current' },
      { week: 'Week 5', title: 'Licensing + telemetry', status: 'upcoming' },
      { week: 'Week 6', title: 'Team tier + Cursor', status: 'upcoming' },
    ],
  },
  shareSection: {
    heading: 'Follow the build, not just the launch.',
    subhead: 'Code is public. Commits are weekly. Stars help. Shares help more.',
    githubCtaLabel: 'Star on GitHub',
    twitterCtaLabel: 'Share on X',
    twitterText:
      'Just found MCPInsight — a Health Score for every MCP server you run in Claude Code / Codex / Cursor. Spots the zombies Tool Search still hides. Shipping weekly in public.',
    twitterUrl: 'https://mcpinsight.dev',
  },
  teams: {
    eyebrow: 'For teams',
    headline: 'Team tier after the solo launch.',
    subhead:
      'Aggregate Health Scores across your team. Catch a wobbly MCP server before it spreads. Compare usage against the public State of MCP benchmark. Shipping after the solo tier finds its footing.',
    sub: 'Until then — the solo waitlist gets you in first.',
    backCta: 'Back to home',
  },
  footer: {
    tagline: 'Built by one dev, in public.',
    links: {
      github: { label: 'GitHub', href: 'https://github.com/mcpinsight/mcpinsight' },
      twitter: { label: '@mcpinsight', href: 'https://twitter.com/mcpinsight' },
    },
    copyright: '© 2026 MCPInsight',
  },
} as const;
