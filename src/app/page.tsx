import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock,
  Languages,
  PenLine,
  Rss,
  Send,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: Sparkles,
    title: "AI-written posts",
    body: "Claude drafts content in your voice, based on topics you choose.",
  },
  {
    icon: Rss,
    title: "Fresh news sourcing",
    body: "Pulls from curated RSS feeds and the open web for each topic.",
  },
  {
    icon: CalendarClock,
    title: "Flexible schedule",
    body: "Daily, every 3 days, weekly — at the time that fits your audience.",
  },
  {
    icon: Languages,
    title: "Multi-language",
    body: "Generates parallel versions in English, Russian, or both.",
  },
  {
    icon: PenLine,
    title: "Autopilot or approve",
    body: "Fully automatic or draft queue with one-tap publish.",
  },
  {
    icon: Send,
    title: "LinkedIn + Telegram",
    body: "Post to your personal LinkedIn and Telegram channels in one click.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold">
            <div className="grid size-7 place-items-center rounded-md bg-foreground text-background">
              AM
            </div>
            <span>Account Manager</span>
          </div>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-up">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-5">
              Phase 1 preview
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Your social presence on autopilot.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              Pick topics. Pick a schedule. Pick a voice. Account Manager writes
              and posts fresh news to LinkedIn and Telegram for you — on
              autopilot or with a one-click approval step.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">Create your account</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/sign-in">I already have one</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <Card key={title}>
                <CardHeader>
                  <Icon className="size-5 text-muted-foreground" />
                  <CardTitle className="mt-2 text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {body}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl px-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Account Manager. Posts via official
          LinkedIn and Telegram APIs.
        </div>
      </footer>
    </div>
  );
}
