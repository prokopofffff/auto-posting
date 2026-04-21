"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INTERVAL_OPTIONS,
  LANGUAGES,
  TOPIC_TEMPLATES,
  WRITING_STYLES,
} from "@/lib/topic-templates";
import { saveSettingsAction } from "@/server/settings-actions";
import { X } from "lucide-react";

type WritingStyle = "professional" | "casual" | "technical" | "provocative" | "custom";
type Mode = "MANUAL" | "AUTOPILOT";

type Props = {
  projectId: string;
  newsApiConfigured: boolean;
  initial: {
    projectName: string;
    topics: string[];
    languages: string[];
    writingStyle: WritingStyle;
    customStyle: string;
    intervalDays: number;
    preferredHour: number;
    timezone: string;
    mode: Mode;
    includeHashtags: boolean;
    includeSource: boolean;
    maxPostChars: number;
    bannedWords: string[];
    moderationEnabled: boolean;
  };
};

export function SettingsForm({ projectId, newsApiConfigured, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.projectName);
  const [topics, setTopics] = useState<string[]>(initial.topics);
  const [customTopic, setCustomTopic] = useState("");
  const [languages, setLanguages] = useState<string[]>(initial.languages);
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(initial.writingStyle);
  const [customStyle, setCustomStyle] = useState(initial.customStyle);
  const [intervalDays, setIntervalDays] = useState(initial.intervalDays);
  const [preferredHour, setPreferredHour] = useState(initial.preferredHour);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [includeHashtags, setIncludeHashtags] = useState(initial.includeHashtags);
  const [includeSource, setIncludeSource] = useState(initial.includeSource);
  const [maxPostChars, setMaxPostChars] = useState(initial.maxPostChars);
  const [bannedWordsText, setBannedWordsText] = useState(initial.bannedWords.join(", "));
  const [moderationEnabled, setModerationEnabled] = useState(initial.moderationEnabled);

  const templateIds = new Set(TOPIC_TEMPLATES.map((t) => t.id));
  const hasCustomTopic = topics.some((t) => !templateIds.has(t));

  function parseBannedWords(): string[] {
    return bannedWordsText
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  function toggleTopic(id: string) {
    setTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }
  function addCustomTopic() {
    const t = customTopic.trim();
    if (!t) return;
    if (topics.includes(t)) return;
    setTopics((prev) => [...prev, t]);
    setCustomTopic("");
  }
  function toggleLang(id: string) {
    setLanguages((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  }

  function save() {
    if (topics.length === 0) {
      toast.error("Add at least one topic.");
      return;
    }
    if (languages.length === 0) {
      toast.error("Pick at least one language.");
      return;
    }
    startTransition(async () => {
      const res = await saveSettingsAction({
        projectId,
        projectName: name,
        topics,
        languages: languages as ("en" | "ru")[],
        writingStyle,
        customStyle,
        intervalDays,
        preferredHour,
        timezone,
        mode,
        includeHashtags,
        includeSource,
        maxPostChars,
        bannedWords: parseBannedWords(),
        moderationEnabled,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Settings saved.");
      router.refresh();
    });
  }

  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="topics">Topics</TabsTrigger>
        <TabsTrigger value="voice">Voice</TabsTrigger>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="mode">Mode</TabsTrigger>
        <TabsTrigger value="safety">Safety</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
            <CardDescription>Project name and output language.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Project name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Languages</Label>
              <div className="flex flex-wrap gap-3">
                {LANGUAGES.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={languages.includes(l.id)}
                      onCheckedChange={() => toggleLang(l.id)}
                    />
                    {l.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick one or more. If both, the agent generates parallel versions.
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="topics">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Topics</CardTitle>
            <CardDescription>
              Pick from templates or add your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-2 block">Templates</Label>
              <div className="flex flex-wrap gap-2">
                {TOPIC_TEMPLATES.map((t) => {
                  const active = topics.includes(t.id);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTopic(t.id)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="mr-1.5">{t.emoji}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custom-topic">Custom topic</Label>
              <div className="flex gap-2">
                <Input
                  id="custom-topic"
                  placeholder="e.g. edge computing, indie hacking"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomTopic();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addCustomTopic}>
                  Add
                </Button>
              </div>
              {hasCustomTopic && !newsApiConfigured && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Custom topics use NewsAPI. Set <code>NEWSAPI_KEY</code> in
                  your env (free tier at newsapi.org) or the agent will fall
                  back to generic tech feeds for these.
                </p>
              )}
            </div>

            <div>
              <Label className="mb-2 block">Selected</Label>
              <div className="flex flex-wrap gap-2">
                {topics.length === 0 && (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                )}
                {topics.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1.5 pr-1">
                    {t}
                    <button
                      type="button"
                      onClick={() => toggleTopic(t)}
                      className="ml-1 rounded-sm hover:bg-muted-foreground/20"
                      aria-label={`Remove ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="voice">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Writing style</CardTitle>
            <CardDescription>How posts should sound.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Preset</Label>
              <Select
                value={writingStyle}
                onValueChange={(v) => setWritingStyle(v as WritingStyle)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WRITING_STYLES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {writingStyle === "custom" && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-style">Custom instructions</Label>
                <Textarea
                  id="custom-style"
                  rows={5}
                  placeholder="Describe the voice, tone, and any rules. e.g. 'Concise, no emojis, always open with a surprising stat.'"
                  value={customStyle}
                  onChange={(e) => setCustomStyle(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Include hashtags</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-generate 3-5 relevant hashtags.
                </p>
              </div>
              <Switch checked={includeHashtags} onCheckedChange={setIncludeHashtags} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Include source link</Label>
                <p className="text-xs text-muted-foreground">
                  Append the article URL (or put in first comment on LinkedIn).
                </p>
              </div>
              <Switch checked={includeSource} onCheckedChange={setIncludeSource} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-chars">Max post length (chars)</Label>
              <Input
                id="max-chars"
                type="number"
                min={200}
                max={3000}
                value={maxPostChars}
                onChange={(e) => setMaxPostChars(Number(e.target.value))}
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="schedule">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
            <CardDescription>How often and when to post.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select
                value={String(intervalDays)}
                onValueChange={(v) => setIntervalDays(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hour">Preferred hour (0-23)</Label>
                <Input
                  id="hour"
                  type="number"
                  min={0}
                  max={23}
                  value={preferredHour}
                  onChange={(e) => setPreferredHour(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Input
                  id="tz"
                  placeholder="e.g. Europe/Moscow"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="mode">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posting mode</CardTitle>
            <CardDescription>
              Autopilot posts without asking. Manual puts each draft in a queue
              for one-click approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${
                mode === "MANUAL" ? "border-foreground" : ""
              }`}
            >
              <input
                type="radio"
                name="mode"
                checked={mode === "MANUAL"}
                onChange={() => setMode("MANUAL")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Manual approval (recommended to start)</div>
                <p className="text-sm text-muted-foreground">
                  Agent drafts posts, you approve each one before it goes out.
                </p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${
                mode === "AUTOPILOT" ? "border-foreground" : ""
              }`}
            >
              <input
                type="radio"
                name="mode"
                checked={mode === "AUTOPILOT"}
                onChange={() => setMode("AUTOPILOT")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Autopilot</div>
                <p className="text-sm text-muted-foreground">
                  Agent writes and publishes automatically on schedule.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="safety">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safety</CardTitle>
            <CardDescription>
              Stop problematic posts before they go out. Combine both for
              belt-and-braces.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="banned-words">Banned words / phrases</Label>
              <Textarea
                id="banned-words"
                rows={4}
                placeholder="competitor-name, unreleased-product, internal-codename"
                value={bannedWordsText}
                onChange={(e) => setBannedWordsText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Single words match whole-word (case-insensitive);
                multi-word phrases match as substrings. Any match blocks the
                post and shows it in the Failed section of Drafts.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">AI moderation</Label>
                <p className="text-xs text-muted-foreground">
                  Run each post through Claude for a safety check before
                  publishing. Catches hate speech, illegal content, and direct
                  incitement. Adds a small per-post cost.
                </p>
              </div>
              <Switch checked={moderationEnabled} onCheckedChange={setModerationEnabled} />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <div className="sticky bottom-4 flex justify-end">
        <Button size="lg" onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </Tabs>
  );
}
