"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PlatformSettings } from "@/lib/admin";

export function SettingsForm({
  initial,
  action,
}: {
  initial: PlatformSettings;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [beta, setBeta] = useState(initial.feature_beta_builds);
  const [quota, setQuota] = useState(String(initial.default_builds_allowed));
  const [banner, setBanner] = useState(initial.announcement_banner);
  const [words, setWords] = useState(initial.banned_words.join(", "));

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("default_builds_allowed", quota);
    fd.set("feature_beta_builds", beta ? "1" : "0");
    fd.set("announcement_banner", banner);
    fd.set("banned_words", words);
    try {
      const res = await action(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert variant="default" className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>Platform settings updated.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Build limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Default builds allowed per new user</FieldLabel>
            <Input type="number" min={0} max={1000} value={quota} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuota(e.target.value)} className="max-w-32" />
          </Field>
          <Field>
            <FieldLabel className="flex items-center gap-2">
              <Switch checked={beta} onCheckedChange={setBeta} />
              Beta builds enabled
            </FieldLabel>
            <p className="text-xs text-slate-400">
              When off, new build requests are rejected and users see a “beta is closed” message.
            </p>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Announcement banner</CardTitle>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel>Message shown at the top of every user&apos;s dashboard</FieldLabel>
            <Textarea value={banner} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBanner(e.target.value)} rows={3} placeholder="Leave empty to hide the banner." />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Banned words</CardTitle>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel>Comma-separated list of words blocked in business names and site content</FieldLabel>
            <Textarea value={words} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWords(e.target.value)} rows={3} placeholder="casino, adult, …" />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy} className="bg-pine-900 text-gold-400 hover:bg-pine-800">
          {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
          Save settings
        </Button>
      </div>
    </div>
  );
}
