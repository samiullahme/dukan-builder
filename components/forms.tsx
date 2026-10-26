"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, FormError, Input, Logo, PageShell, Select, Textarea } from "./ui";

export function useSubmit(url: string, onOk: (data: any) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const isForm = body instanceof FormData;
      const res = await fetch(url, {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      onOk(data);
    } catch (e: any) {
      const msg = e?.message === "Failed to fetch"
        ? "Connection problem — the server didn't answer. Please try again."
        : e.message;
      setError(msg);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function LoginForm() {
  const router = useRouter();
  const { error, busy, submit } = useSubmit("/api/auth/login", () => router.push("/dashboard"));
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);
  const {
    error: forgotError,
    busy: forgotBusy,
    submit: submitForgot,
  } = useSubmit("/api/auth/forgot-password", () => setResetSent(true));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const search = window.location.search;
    const hash = window.location.hash;
    const params = new URLSearchParams(search);
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    if (
      params.get("code") ||
      params.get("token_hash") ||
      hashParams.get("type") === "recovery" ||
      hashParams.get("access_token")
    ) {
      router.replace(`/reset-password${search}${hash}`);
    }
  }, [router]);

  if (mode === "forgot") {
    return (
      <PageShell>
        <div className="mb-8 flex justify-center"><Logo /></div>
        <Card className="p-8">
          <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your email address and we&apos;ll send you a link to set a new password.
          </p>
          {resetSent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                If an account exists for <span className="font-semibold">{email}</span>, we&apos;ve sent a password reset link. Check your inbox and spam folder.
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setMode("login");
                  setResetSent(false);
                }}
              >
                Back to log in
              </Button>
            </div>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitForgot({ email });
              }}
            >
              <FormError message={forgotError} />
              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourshop.pk"
                  autoComplete="email"
                />
              </Field>
              <Button type="submit" disabled={forgotBusy} className="w-full">
                {forgotBusy ? "Sending reset link…" : "Send reset link"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setResetSent(false);
                }}
                className="w-full cursor-pointer text-center text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline"
              >
                ← Back to log in
              </button>
            </form>
          )}
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mb-8 flex justify-center"><Logo /></div>
      <Card className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500">Log in to manage your websites.</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); submit({ email, password }); }}
        >
          <FormError message={error} />
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.pk" autoComplete="email" />
          </Field>
          <div className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="login-password" className="text-sm font-semibold text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setResetSent(false);
                }}
                className="cursor-pointer text-xs font-semibold text-emerald-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500">
          No account yet? <a href="/signup" className="font-semibold text-emerald-700 hover:underline">Create one — it&apos;s free</a>
        </p>
      </Card>
    </PageShell>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { error, busy, submit } = useSubmit("/api/auth/forgot-password", () => setSent(true));

  return (
    <PageShell>
      <div className="mb-8 flex justify-center"><Logo /></div>
      <Card className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter your email address and we&apos;ll send you a link to set a new password.
        </p>
        {sent ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              If an account exists for <span className="font-semibold">{email}</span>, we&apos;ve sent a password reset link. Check your inbox and spam folder.
            </div>
            <a
              href="/login"
              className="block text-center text-sm font-semibold text-emerald-700 hover:underline"
            >
              ← Back to log in
            </a>
          </div>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit({ email });
            }}
          >
            <FormError message={error} />
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourshop.pk"
                autoComplete="email"
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Sending reset link…" : "Send reset link"}
            </Button>
            <p className="mt-4 text-center text-sm text-slate-500">
              Remembered your password?{" "}
              <a href="/login" className="font-semibold text-emerald-700 hover:underline">
                Log in
              </a>
            </p>
          </form>
        )}
      </Card>
    </PageShell>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return (
      searchParams.get("error_description") ||
      hashParams.get("error_description") ||
      null
    );
  });
  const [done, setDone] = useState(false);

  const { error, busy, submit } = useSubmit("/api/auth/reset-password", () => {
    setDone(true);
    router.push("/dashboard");
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError("The two passwords do not match.");
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    submit({
      password,
      code: searchParams.get("code") || "",
      token_hash: searchParams.get("token_hash") || "",
      type: searchParams.get("type") || hashParams.get("type") || "",
      access_token: hashParams.get("access_token") || "",
      refresh_token: hashParams.get("refresh_token") || "",
    });
  };

  return (
    <PageShell>
      <div className="mb-8 flex justify-center"><Logo /></div>
      <Card className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter a new password for your Dukan Builder account.
        </p>
        {done ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Your password has been updated. Redirecting to your dashboard…
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <FormError message={localError || error} />
            <Field label="New password" hint="At least 8 characters.">
              <Input
                type="password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                required
                minLength={8}
                maxLength={72}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Updating password…" : "Update password"}
            </Button>
            <p className="mt-4 text-center text-sm text-slate-500">
              <a href="/login" className="font-semibold text-emerald-700 hover:underline">
                ← Back to log in
              </a>
            </p>
          </form>
        )}
      </Card>
    </PageShell>
  );
}

export function SignupForm() {
  const router = useRouter();
  const { error, busy, submit } = useSubmit("/api/auth/signup", () => router.push("/dashboard"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <PageShell>
      <div className="mb-8 flex justify-center"><Logo /></div>
      <Card className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Free during beta — includes 5 AI website builds.</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); submit({ email, password }); }}
        >
          <FormError message={error} />
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.pk" autoComplete="email" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a strong password" autoComplete="new-password" />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating account…" : "Create free account"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500">
          Already have an account? <a href="/login" className="font-semibold text-emerald-700 hover:underline">Log in</a>
        </p>
      </Card>
    </PageShell>
  );
}

const CATEGORY_CHOICES = [
  { value: "restaurant", label: "Restaurant / Café / Food" },
  { value: "salon", label: "Salon / Barber / Beauty" },
  { value: "clinic", label: "Clinic / Doctor / Dental" },
  { value: "retail", label: "Shop / Retail / Boutique" },
  { value: "real-estate", label: "Real estate / Property" },
  { value: "other", label: "Other local business" },
];

const COLOR_CHOICES = [
  { value: "", label: "Auto — match the business" },
  { value: "Deep green & gold (classic)", label: "Deep green & gold" },
  { value: "Navy & white (clean)", label: "Navy & white" },
  { value: "Maroon & cream (traditional)", label: "Maroon & cream" },
  { value: "Charcoal & lime (modern)", label: "Charcoal & lime" },
  { value: "Teal & sand (fresh)", label: "Teal & sand" },
];

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
        {title.charAt(0)}
      </span>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h2>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

export function NewSiteForm() {
  const router = useRouter();
  const { error, busy, submit } = useSubmit("/api/sites", (d) => router.push(`/sites/${d.id}`));
  const [form, setForm] = useState({
    business_name: "", category: "restaurant", phone: "", address: "", hours: "",
    services: "", colors: "", instructions: "", design_notes: "",
  });
  const [design, setDesign] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onDesign = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setDesignError(null);
    if (!f) {
      setDesign(null);
      setPreview(null);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setDesignError("Use a PNG, JPEG or WebP image.");
      e.target.value = "";
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setDesignError("The image must be 8 MB or smaller.");
      e.target.value = "";
      return;
    }
    setDesign(f);
    setPreview(URL.createObjectURL(f));
  };

  const clearDesign = () => {
    setDesign(null);
    setPreview(null);
    setDesignError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (designError) return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, v);
    if (design) fd.append("design", design);
    submit(fd);
  };

  return (
    <form className="space-y-7" onSubmit={onSubmit}>
      <FormError message={error} />

      <section className="space-y-4">
        <SectionHeading title="Core business information" sub="What the AI writes your site from" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name *">
            <Input required value={form.business_name} onChange={set("business_name")} placeholder="e.g. Rahim Tea House" maxLength={80} />
          </Field>
          <Field label="Business type *" hint="Sets the booking form, copy and photo style.">
            <Select value={form.category} onChange={set("category")}>
              {CATEGORY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Phone / WhatsApp">
            <Input value={form.phone} onChange={set("phone")} placeholder="e.g. 0300 1234567" maxLength={40} />
          </Field>
          <Field label="Opening hours">
            <Input value={form.hours} onChange={set("hours")} placeholder="e.g. Mon–Sat, 9am – 9pm" maxLength={120} />
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={set("address")} placeholder="e.g. Main Bazaar, Lahore" maxLength={160} />
        </Field>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Products, services & story" sub="Menus, price lists and the story behind the shop" />
        <Field label="Products / services" hint="One per line. Optionally add a description and price with | — prices are only used when you provide them.">
          <Textarea
            value={form.services}
            onChange={set("services")}
            placeholder={"Doodh patti | Slow-brewed, creamy, house special | Rs 180\nKashmiri chai\nBun kebab | Freshly baked bun, grilled seekh"}
          />
        </Field>
        <Field label="Tell us about your business *" hint="What makes you special? Who are your customers? The AI writes your website copy from this.">
          <Textarea
            required
            value={form.instructions}
            onChange={set("instructions")}
            placeholder="A 40-year-old family tea house famous for its doodh patti. Students and office workers are our regulars. We are proud of our quick service and low prices."
          />
        </Field>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Visual identity & aesthetic reference" sub="Colours and a design the vision model can learn from" />
        <Field label="Colour direction" hint="Optional. A reference image or your business type can drive the palette instead.">
          <Select value={form.colors} onChange={set("colors")}>
            {COLOR_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Design reference <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                Upload a screenshot or mockup you like. The vision model reads its layout, colours and type, then writes a detailed design brief for your site.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
              </svg>
              {design ? "Replace image" : "Choose image"}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onDesign} className="hidden" />
          </div>
          {designError && <p className="mt-3 text-sm text-red-600">{designError}</p>}
          {preview && design && (
            <div className="mt-4 flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Design reference preview" className="h-20 w-28 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{design.name}</p>
                <p className="text-xs text-slate-400">{(design.size / 1024 / 1024).toFixed(1)} MB · PNG, JPEG or WebP</p>
              </div>
              <button type="button" onClick={clearDesign} className="cursor-pointer text-sm font-semibold text-red-600 hover:underline">
                Remove
              </button>
            </div>
          )}
          <div className="mt-4">
            <Field label="Notes about the design" hint="Optional — e.g. 'keep this layout, but use our green and a warmer tone'.">
              <Textarea value={form.design_notes} onChange={set("design_notes")} className="min-h-[80px]" maxLength={1000} placeholder="Anything the AI should know about this reference?" />
            </Field>
          </div>
        </div>
      </section>

      <div className="flex flex-col items-stretch gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">The AI writes your hero tagline, About Us story and SEO metadata from your story.</p>
        <Button type="submit" disabled={busy} variant="success" className="shrink-0">
          {busy ? "Creating…" : "Create my website →"}
        </Button>
      </div>
    </form>
  );
}
