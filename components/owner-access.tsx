"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormError, Input } from "./ui";
import { ShieldCheck, KeyRound, Copy, Check, RefreshCw, Lock } from "lucide-react";

type Credential = { username: string; password: string };

function dbTimeToMs(value: string | null): number {
  return value ? Date.parse(value.replace(" ", "T") + "Z") : 0;
}

function remainingLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function CredRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="mt-0.5 truncate font-mono text-sm text-slate-800">{value}</p>
      </div>
      <Button variant="secondary" className="shrink-0 px-3 py-2" onClick={onCopy}>
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function OwnerAccess({
  siteId,
  enabled,
  unlockedUntil,
}: {
  siteId: string;
  enabled: boolean;
  unlockedUntil: string | null;
}) {
  const router = useRouter();
  const [totpEnabled, setTotpEnabled] = useState(enabled);
  const [unlockedUntilMs, setUnlockedUntilMs] = useState(() => dbTimeToMs(unlockedUntil));
  const [unlocked, setUnlocked] = useState(() => dbTimeToMs(unlockedUntil) > Date.now());
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [cred, setCred] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!unlocked) return;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    if (unlockedUntilMs > nowMs) return;
    setUnlocked(false);
    setCred(null);
    router.refresh();
  }, [unlocked, unlockedUntilMs, nowMs, router]);

  const loadCredential = async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/credentials`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "locked" ? "locked" : data.error || "Could not load the credentials.");
      setCred(data as Credential);
    } catch (e: any) {
      if (e.message === "locked") {
        setUnlocked(false);
        router.refresh();
        return;
      }
      setError(e.message);
    }
  };

  useEffect(() => {
    if (unlocked && !cred) void loadCredential();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    const data = await post("setup");
    if (data) setSetup(data);
  };

  const confirmSetup = async () => {
    const data = await post("confirm", { code });
    if (data) {
      setTotpEnabled(true);
      setSetup(null);
      setCode("");
    }
  };

  const unlock = async () => {
    const data = await post("unlock", { code });
    if (data) {
      setUnlockedUntilMs(dbTimeToMs(data.unlocked_until));
      setUnlocked(true);
      setCode("");
    }
  };

  const rotate = async () => {
    if (!window.confirm("Generate a new password for this site? The current password will be replaced.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/credentials`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not rotate the password.");
      setCred(data as Credential);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <KeyRound className="h-5 w-5 text-emerald-700" />
          Owner access
        </h2>
        {totpEnabled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            2FA on
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-500">
        This site has a unique username and password for the business owner. Viewing passwords requires
        Google Authenticator — one code unlocks all of your sites for 12 hours.
      </p>

      {error && <FormError message={error} />}

      {unlocked && cred ? (
        <div className="mt-4 space-y-3">
          <CredRow label="Username" value={cred.username} copied={copied === "u"} onCopy={() => copy("u", cred.username)} />
          <CredRow label="Password" value={cred.password} copied={copied === "p"} onCopy={() => copy("p", cred.password)} />
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-400">Locks again in {remainingLabel(unlockedUntilMs - nowMs)}</span>
            <Button variant="secondary" onClick={rotate} disabled={busy}>
              <RefreshCw className="h-4 w-4" />
              Regenerate password
            </Button>
          </div>
        </div>
      ) : setup ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qr}
              alt="Google Authenticator QR code"
              className="h-44 w-44 shrink-0 rounded-xl border border-slate-200 bg-white p-2"
            />
            <div className="space-y-2 text-sm text-slate-600">
              <p>1. Open <span className="font-medium text-slate-800">Google Authenticator</span> (or Authy) on your phone.</p>
              <p>
                2. Tap <span className="font-medium text-slate-800">+</span> and scan the QR code, or enter this key
                manually:
              </p>
              <p className="break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">{setup.secret}</p>
              <p>3. Enter the 6-digit code the app shows:</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              maxLength={6}
              className="w-44"
            />
            <Button onClick={confirmSetup} disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Verify & enable"}
            </Button>
          </div>
        </div>
      ) : totpEnabled ? (
        <div className="mt-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            Passwords are locked. Enter a fresh Google Authenticator code to view them for 12 hours.
          </div>
          <div className="mt-3 flex gap-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              maxLength={6}
              className="w-44"
            />
            <Button onClick={unlock} disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Unlock passwords"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Every site gets a unique owner username and password automatically. Set up Google Authenticator once —
          after that, one fresh 6-digit code unlocks all of your sites&apos; passwords for 12 hours.
          <Button onClick={startSetup} disabled={busy} className="mt-3 w-full">
            <ShieldCheck className="h-4 w-4" />
            {busy ? "Preparing…" : "Set up Google Authenticator"}
          </Button>
        </div>
      )}
    </Card>
  );
}
