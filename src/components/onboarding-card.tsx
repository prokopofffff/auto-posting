import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Step = {
  title: string;
  body: string;
  done: boolean;
  cta: { href: string; label: string };
};

export function OnboardingCard({ steps }: { steps: Step[] }) {
  const firstUndone = steps.find((s) => !s.done);

  return (
    <Card className="border-foreground/10 bg-gradient-to-br from-muted/60 to-background">
      <CardHeader>
        <CardTitle className="text-base">Getting started</CardTitle>
        <CardDescription>
          Finish these steps to start publishing. Takes about 2 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((s, i) => {
          const active = !s.done && s === firstUndone;
          return (
            <div
              key={s.title}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                active ? "border-foreground/60 bg-background" : "bg-background/60"
              }`}
            >
              <div
                className={`grid size-6 flex-none place-items-center rounded-full border text-xs font-medium ${
                  s.done ? "border-foreground bg-foreground text-background" : "border-muted-foreground/30"
                }`}
              >
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{s.title}</div>
                <p className="text-xs text-muted-foreground">{s.body}</p>
              </div>
              {!s.done && (
                <Button asChild size="sm" variant={active ? "default" : "outline"}>
                  <Link href={s.cta.href}>
                    {s.cta.label} <ArrowRight className="ml-1 size-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
