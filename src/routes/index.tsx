import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarClock,
  Languages,
  PenLine,
  Rss,
  Send,
  Sparkles,
} from "lucide-react";

// Ported from src/app/page.tsx. Static marketing landing page served at "/".
export const Route = createFileRoute("/")({
  component: Home,
});

const features = [
  {
    icon: Sparkles,
    tag: "generate",
    title: "AI-written posts",
    body: "Claude drafts content in your voice, based on the topics you choose.",
  },
  {
    icon: Rss,
    tag: "source",
    title: "Fresh news sourcing",
    body: "Pulls from curated RSS feeds and the open web for every topic.",
  },
  {
    icon: CalendarClock,
    tag: "schedule",
    title: "Flexible cadence",
    body: "Daily, every 3 days, or weekly — at the time that fits your audience.",
  },
  {
    icon: Languages,
    tag: "translate",
    title: "Multi-language",
    body: "Generates parallel versions in English, Russian, or both at once.",
  },
  {
    icon: PenLine,
    tag: "review",
    title: "Autopilot or approve",
    body: "Run fully automatic, or keep a draft queue with one-tap publish.",
  },
  {
    icon: Send,
    tag: "publish",
    title: "LinkedIn + Telegram",
    body: "Ship to your personal LinkedIn and Telegram channels in one click.",
  },
];

// Hoisted out of the feature .map() so the identical chip style isn't
// re-allocated for every card on each render.
const ICON_CHIP_STYLE = {
  background: "var(--accent-bg)",
  color: "var(--accent)",
} as const;

function Home() {
  const year = new Date().getFullYear();

  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <Link to="/" className="flex items-center gap-2">
          <div className="brand-mark">AM</div>
          <span className="brand-name">Account Manager</span>
        </Link>
        <div className="flex-1" />
        <nav className="flex items-center gap-2">
          <Link to="/sign-in" className="btn ghost sm">
            Sign in
          </Link>
          <Link to="/sign-up" className="btn accent sm">
            Get started
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-14 pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <span className="badge-pill accent">
                <span className="dot" />
                phase 1 preview
              </span>
              <h1
                className="mt-5 text-4xl font-semibold sm:text-5xl"
                style={{ letterSpacing: "-0.03em", lineHeight: 1.04 }}
              >
                Your social presence,
                <br />
                on autopilot.
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Pick topics. Pick a schedule. Pick a voice. Account Manager
                writes and posts fresh news to LinkedIn and Telegram for you —
                fully automatic, or with a one-click approval step.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2">
                <Link to="/sign-up" className="btn accent">
                  Create your account
                  <ArrowRight className="size-3.5" />
                </Link>
                <Link to="/sign-in" className="btn">
                  I already have one
                </Link>
              </div>
              <p className="mt-4 font-mono text-[11px] text-[var(--fg-4)]">
                no card required · official linkedin + telegram apis
              </p>
            </div>

            {/* App preview — built from the real dashboard primitives */}
            <div
              className="surface-card overflow-hidden"
              style={{ boxShadow: "var(--shadow-pop)" }}
            >
              <div
                className="flex items-center gap-2 border-b border-border px-3"
                style={{ height: "var(--topbar-h)", background: "var(--bg-2)" }}
              >
                <div className="crumb">
                  <span className="cur">Dashboard</span>
                </div>
                <div className="flex-1" />
                <div className="run-state">
                  <span className="pulse" />
                  running
                </div>
              </div>

              <div className="p-3.5">
                <div className="grid-cols-3">
                  <div className="kpi">
                    <div className="label">posts · 7d</div>
                    <div className="value">
                      42<span className="unit">sent</span>
                    </div>
                    <div className="delta up">▲ 12 vs prev</div>
                  </div>
                  <div className="kpi">
                    <div className="label">success</div>
                    <div className="value">
                      98<span className="unit">%</span>
                    </div>
                    <div className="delta up">▲ 3 pts</div>
                  </div>
                  <div className="kpi">
                    <div className="label">topics</div>
                    <div className="value">
                      9<span className="unit">active</span>
                    </div>
                    <div className="delta">2 idle</div>
                  </div>
                </div>

                <div className="dash-card" style={{ marginTop: 12 }}>
                  <div className="dash-card-head">
                    <h3 className="dash-card-title">Recent activity</h3>
                    <span className="badge-pill ok">
                      <span className="dot" />
                      live
                    </span>
                  </div>
                  <div className="dash-card-body">
                    <div className="timeline">
                      <div className="tl-item ok">
                        <span className="when">09:14</span>
                        <span className="what">
                          <b>LinkedIn</b> post published
                        </span>
                      </div>
                      <div className="tl-item accent">
                        <span className="when">09:12</span>
                        <span className="what">
                          Draft generated · <span className="mono">en / ru</span>
                        </span>
                      </div>
                      <div className="tl-item info">
                        <span className="when">06:00</span>
                        <span className="what">
                          <b>Telegram</b> post published
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-16">
          <div className="mb-5">
            <div className="auth-eyebrow">capabilities</div>
            <h2
              className="mt-1.5 text-xl font-semibold"
              style={{ letterSpacing: "-0.02em" }}
            >
              Everything the agent handles
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, tag, title, body }) => (
              <div key={title} className="dash-card" style={{ padding: 14 }}>
                <div className="flex items-center gap-2">
                  <span
                    className="grid size-7 place-items-center rounded-[var(--r-1)]"
                    style={ICON_CHIP_STYLE}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--fg-4)]">
                    {tag}
                  </span>
                </div>
                <h3 className="mt-3 text-[13px] font-semibold">{title}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <span className="text-[12px] text-muted-foreground">
            © {year} Account Manager
          </span>
          <span className="font-mono text-[11px] text-[var(--fg-4)]">
            official linkedin + telegram apis
          </span>
        </div>
      </footer>
    </div>
  );
}
