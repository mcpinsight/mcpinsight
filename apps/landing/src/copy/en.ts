// All user-visible strings live here (INV-08: English only, no i18n framework).
// Never import an i18n library. Add a new language by adding a sibling file
// and a runtime locale switch — but not before product/market fit.

export const copy = {
  meta: {
    title: 'MCPInsight — Analytics for MCP servers in Claude Code, Codex, Cursor',
    description:
      'Which MCP server is eating your context? MCPInsight reads your Claude Code, Codex, and Cursor logs. Local, open source, ~60 seconds to first insight.',
  },
  nav: {
    brand: 'MCPInsight',
    githubCtaLabel: 'Star on GitHub',
    teamsCtaLabel: 'For teams',
    primaryCtaLabel: 'Notify me',
  },
  hero: {
    eyebrow: 'Building in public · Week 3 of 6',
    headline: 'Which MCP server is eating your context?',
    subhead:
      'MCPInsight reads your Claude Code, Codex, and Cursor logs, then tells you which servers earn their slot — and which to kill. Local, open source, ~60 seconds to first insight.',
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
    heading: 'The invisible layer of your AI coding setup',
    cards: [
      'Your agent calls the same server 40 times per session. You never see it.',
      'That MCP server you installed 3 weeks ago — still eating context. Do you use it?',
      'Every tool call is logged. Nothing reads those logs — until now.',
    ],
  },
  solution: {
    sectionLabel: 'The solution',
    heading: 'MCPInsight reads the logs you already have',
    localityNote: 'Runs locally. Your data never leaves your machine.',
    cards: [
      { title: 'Find what drags', body: 'Spot the 3 servers that drag every session down.' },
      {
        title: 'Kill the deadweight',
        body: "Kill the 7 servers you haven't touched in 30 days.",
      },
      {
        title: 'Per-tool attribution',
        body: 'See which tools actually saved you tokens — per server, per session.',
      },
      {
        title: 'Multi-client',
        body: 'Compare Claude Code, Codex, and Cursor side by side.',
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
      { week: 'Week 3', title: 'Dashboard + Codex parser', status: 'current' },
      { week: 'Week 4', title: 'Licensing + telemetry', status: 'upcoming' },
      { week: 'Week 5', title: 'Launch + State of MCP', status: 'upcoming' },
      { week: 'Week 6', title: 'Team tier + Cursor', status: 'upcoming' },
    ],
  },
  shareSection: {
    heading: 'Follow the build, not just the launch.',
    subhead: 'Code is public. Commits are weekly. Stars help. Shares help more.',
    githubCtaLabel: 'Star on GitHub',
    twitterCtaLabel: 'Share on X',
    twitterText:
      'Just found MCPInsight — analytics for MCP servers in Claude Code, Codex, and Cursor. Shipping weekly in public.',
    twitterUrl: 'https://mcpinsight.dev',
  },
  teams: {
    eyebrow: 'For teams',
    headline: 'Team tier launches in Week 4.',
    subhead:
      'Compare MCP server usage across your team. Catch noisy servers before they spread. Share waste reports from your dashboards.',
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
