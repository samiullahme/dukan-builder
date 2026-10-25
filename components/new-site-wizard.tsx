"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmit } from "./forms";

const CATEGORY_CHOICES = [
  { value: "restaurant", label: "Restaurant / Café / Food" },
  { value: "salon", label: "Salon / Barber / Beauty" },
  { value: "clinic", label: "Clinic / Doctor / Dental" },
  { value: "retail", label: "Shop / Retail / Boutique" },
  { value: "real-estate", label: "Real estate / Property" },
  { value: "other", label: "Other local business" },
];

// The value strings are the exact palette labels lib/provision.ts resolves
// into real hex palettes — keep them in sync with CATEGORY_COLORS.
const COLOR_TILES = [
  { value: "", name: "Auto", sub: "Surprise me", grad: "linear-gradient(135deg,#0B5949,#F6B948)" },
  { value: "Deep green & gold (classic)", name: "Deep green & gold", sub: "Classic", grad: "linear-gradient(135deg,#0b3d2e,#e0aa33)" },
  { value: "Navy & white (clean)", name: "Navy & white", sub: "Clean", grad: "linear-gradient(135deg,#1e3a5f,#4f9cf0)" },
  { value: "Maroon & cream (traditional)", name: "Maroon & cream", sub: "Traditional", grad: "linear-gradient(135deg,#6b1f2a,#d9a441)" },
  { value: "Charcoal & lime (modern)", name: "Charcoal & lime", sub: "Modern", grad: "linear-gradient(135deg,#22252a,#b8d62e)" },
  { value: "Teal & sand (fresh)", name: "Teal & sand", sub: "Fresh", grad: "linear-gradient(135deg,#0f6a6a,#e8b04b)" },
];

const STEPS = [
  { n: 1, label: "Business basics", sub: "Name, type & contact" },
  { n: 2, label: "Products & story", sub: "What you offer" },
  { n: 3, label: "Look & feel", sub: "Colours & reference" },
];

const STEP_COPY: Record<number, { title: string; sub: string }> = {
  1: { title: "Tell us about your business", sub: "Start with the basics. You can update these details anytime." },
  2: { title: "What do you offer?", sub: "Menus, price lists and the story behind the shop — the AI writes your website copy from this." },
  3: { title: "Choose your visual direction", sub: "Pick a colour palette and optionally upload a design you like. The AI matches the look." },
};

const TIPS = [
  "Write your shop name exactly as customers know it — it becomes your site title and web address.",
  "The more specific your story, the better the AI writes your copy. Prices and specialties all help.",
  "A reference image guides the whole look. No image? Auto picks a palette that fits your business.",
];

const DRAFT_KEY = "dukan-site-draft-v1";

type FormState = {
  business_name: string;
  category: string;
  phone: string;
  address: string;
  hours: string;
  services: string;
  colors: string;
  instructions: string;
  design_notes: string;
};

const EMPTY_FORM: FormState = {
  business_name: "",
  category: "restaurant",
  phone: "",
  address: "",
  hours: "",
  services: "",
  colors: "",
  instructions: "",
  design_notes: "",
};

function sanitizeDraft(raw: unknown): Partial<FormState> {
  const out: Partial<FormState> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(EMPTY_FORM)) {
    const val = src[k];
    if (typeof val !== "string") continue;
    if (k === "category" && !CATEGORY_CHOICES.some((c) => c.value === val)) continue;
    if (k === "colors" && !COLOR_TILES.some((c) => c.value === val)) continue;
    out[k as keyof FormState] = val.slice(0, 4000);
  }
  return out;
}

const inputCls =
  "w-full rounded-xl border border-[#E4E8E5] bg-white px-4 py-3 text-sm text-[#17201E] outline-none transition placeholder:text-[#9DA5A2] focus:border-[#0B5949] focus:ring-4 focus:ring-[#0B5949]/10";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  error?: string | false;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-[#17201E]">{label}</label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-[#9DA5A2]">{hint}</p>
      ) : null}
    </div>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function NewSiteWizard() {
  const router = useRouter();
  const { error, busy, submit } = useSubmit("/api/sites", (d) => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
    router.push(`/sites/${d.id}`);
  });

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [attempted, setAttempted] = useState(false);
  const [design, setDesign] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepEnteredAt = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    stepEnteredAt.current = Date.now();
  }, [step]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { form?: unknown; step?: unknown };
        setForm((f) => ({ ...f, ...sanitizeDraft(d.form) }));
        if (d.step === 1 || d.step === 2 || d.step === 3) setStep(d.step);
      }
    } catch { /* corrupted draft — start fresh */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step })); } catch { /* private mode */ }
  }, [hydrated, form, step]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const nameInvalid = form.business_name.trim().length < 2;
  const storyInvalid = !form.instructions.trim();
  const stepValid = step === 1 ? !nameInvalid : step === 2 ? !storyInvalid : !designError;

  const next = () => {
    if (!stepValid) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep((s) => Math.min(3, s + 1));
  };

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
    if (step < 3) {
      next();
      return;
    }
    // A double-click on the previous step's Continue lands here (same spot in
    // the footer) — ignore activations within 350ms of entering step 3.
    if (Date.now() - stepEnteredAt.current < 350) return;
    if (designError || submittingRef.current) return;
    submittingRef.current = true;
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, v);
    if (design) fd.append("design", design);
    submit(fd).finally(() => { submittingRef.current = false; });
  };

  const copy = STEP_COPY[step];

  return (
    <div className="min-h-screen bg-white text-[#17201E] lg:grid lg:grid-cols-[280px_1fr]">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 border-b border-[#E4E8E5] bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <a
            href="/dashboard"
            aria-label="Back to websites"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#59635F] transition hover:bg-[#F1F5F3] hover:text-[#17201E]"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </a>
          <div className="flex-1">
            <p className="text-[13px] font-semibold leading-tight">
              Step {step} of 3 · {STEPS[step - 1].label}
            </p>
            <div className="mt-1.5 flex gap-1">
              {STEPS.map((s) => (
                <span
                  key={s.n}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${s.n <= step ? "bg-[#0B5949]" : "bg-[#DCE7E2]"}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col bg-[linear-gradient(180deg,#0B5949,#073F35)] px-6 pb-8 pt-7 lg:flex">
        <a href="/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/70 transition hover:text-white">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to websites
        </a>

        <div className="mt-9 flex items-center gap-2.5 text-[18px] font-extrabold text-white">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-white/10 text-[#EFB43F]">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
              <path d="M2 7h20" />
              <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
            </svg>
          </span>
          Dukan<span className="text-[#D99A22]">Builder</span>
        </div>

        <h2 className="mt-7 text-[26px] font-extrabold leading-tight text-white">
          Let&apos;s build something great.
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">
          Answer three short steps — the AI does the rest.
        </p>

        <ol className="mt-9">
          {STEPS.map((s, i) => {
            const done = s.n < step;
            const current = s.n === step;
            return (
              <li key={s.n} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                      done
                        ? "bg-[#E5F2ED] text-[#0B5949]"
                        : current
                          ? "bg-[#F6B948] text-[#17201E] ring-4 ring-[#F6B948]/25"
                          : "border border-white/25 text-white/70"
                    }`}
                  >
                    {done ? <CheckIcon /> : s.n}
                  </span>
                  {i < STEPS.length - 1 && <span className="w-px flex-1 bg-white/15" />}
                </div>
                <div className={i < STEPS.length - 1 ? "pb-7" : ""}>
                  <p className={`text-sm leading-8 ${current ? "font-semibold text-white" : done ? "font-medium text-white/80" : "font-medium text-white/50"}`}>
                    {s.label}
                  </p>
                  <p className="text-[11px] text-white/45">{s.sub}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-auto rounded-[14px] border border-white/15 bg-white/10 p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[1.2px] text-[#F6B948]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
            </svg>
            AI tip
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/85">{TIPS[step - 1]}</p>
        </div>
      </aside>

      {/* Main column */}
      <div>
        <main className="px-5 py-8 sm:px-10 lg:px-14 lg:py-12">
          <div className="mx-auto w-full max-w-[640px]">
            <p className="text-[11px] font-bold uppercase tracking-[1.6px] text-[#D99A22]">
              Step {step} of 3
            </p>
            <h1 className="mt-2 text-[26px] font-extrabold tracking-tight">{copy.title}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#6D7774]">{copy.sub}</p>

            <form className="mt-8" onSubmit={onSubmit} noValidate>
              {error && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <Field
                    label={<>Business name <span className="text-red-500">*</span></>}
                    error={attempted && nameInvalid && "Enter your business name (2–80 characters)."}
                  >
                    <input
                      className={inputCls}
                      value={form.business_name}
                      onChange={set("business_name")}
                      placeholder="e.g. Rahim Tea House"
                      maxLength={80}
                      autoFocus
                    />
                  </Field>
                  <Field
                    label={<>Business type <span className="text-red-500">*</span></>}
                    hint="Sets the booking form, copy and photo style."
                  >
                    <div className="relative">
                      <select className={`${inputCls} appearance-none pr-10`} value={form.category} onChange={set("category")}>
                        {CATEGORY_CHOICES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#9DA5A2]">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Phone / WhatsApp">
                      <input className={inputCls} value={form.phone} onChange={set("phone")} placeholder="e.g. 0300 1234567" maxLength={40} />
                    </Field>
                    <Field label="Opening hours">
                      <input className={inputCls} value={form.hours} onChange={set("hours")} placeholder="e.g. Mon–Sat, 9am – 9pm" maxLength={120} />
                    </Field>
                  </div>
                  <Field label="Address">
                    <input className={inputCls} value={form.address} onChange={set("address")} placeholder="e.g. Main Bazaar, Lahore" maxLength={160} />
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <Field
                    label="Products / services"
                    hint="One per line. Optionally add a description and price with | — prices are only used when you provide them."
                  >
                    <textarea
                      className={`${inputCls} min-h-[130px] resize-y`}
                      value={form.services}
                      onChange={set("services")}
                      placeholder={"Doodh patti | Slow-brewed, creamy, house special | Rs 180\nKashmiri chai\nBun kebab | Freshly baked bun, grilled seekh"}
                    />
                  </Field>
                  <Field
                    label={<>Your business story <span className="text-red-500">*</span></>}
                    hint="What makes you special? Who are your customers? The AI writes your website copy from this."
                    error={attempted && storyInvalid && "Tell us a little about your business — this is what the AI writes from."}
                  >
                    <textarea
                      className={`${inputCls} min-h-[150px] resize-y`}
                      value={form.instructions}
                      onChange={set("instructions")}
                      maxLength={4000}
                      placeholder="A 40-year-old family tea house famous for its doodh patti. Students and office workers are our regulars. We are proud of our quick service and low prices."
                    />
                  </Field>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <p className="mb-2 text-sm font-semibold">Colour direction</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {COLOR_TILES.map((c) => {
                        const selected = form.colors === c.value;
                        return (
                          <button
                            key={c.value || "auto"}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, colors: c.value }))}
                            className={`relative cursor-pointer rounded-[14px] border p-3 text-left transition ${
                              selected
                                ? "border-[#0B5949] bg-[#F2F8F5] ring-2 ring-[#0B5949]/15"
                                : "border-[#E4E8E5] bg-white hover:border-[#CBD4CF]"
                            }`}
                          >
                            {selected && (
                              <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-[#0B5949] text-white">
                                <CheckIcon />
                              </span>
                            )}
                            <span className="block h-10 w-full rounded-lg" style={{ backgroundImage: c.grad }} />
                            <span className="mt-2 block text-[13px] font-semibold text-[#17201E]">{c.name}</span>
                            <span className="block text-[11px] text-[#9DA5A2]">{c.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[14px] border-2 border-dashed border-[#CBD4CF] bg-[#F6F8F7] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#17201E]">
                          Design reference <span className="font-normal text-[#9DA5A2]">(optional)</span>
                        </p>
                        <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#6D7774]">
                          Upload a screenshot or mockup you like. The vision model reads its layout, colours and type, then writes a detailed design brief for your site. PNG, JPEG or WebP up to 8 MB.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4E8E5] bg-white px-4 py-2 text-sm font-semibold text-[#17201E] shadow-sm transition hover:border-[#CBD4CF] hover:bg-[#F6F8F7]"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="M17 8l-5-5-5 5" />
                          <path d="M12 3v12" />
                        </svg>
                        {design ? "Replace image" : "Choose image"}
                      </button>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onDesign} className="hidden" />
                    </div>
                    {designError && <p className="mt-3 text-sm text-red-600">{designError}</p>}
                    {preview && design && (
                      <div className="mt-4 flex items-center gap-4 rounded-lg border border-[#E4E8E5] bg-white p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview} alt="Design reference preview" className="h-20 w-28 rounded-lg object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#17201E]">{design.name}</p>
                          <p className="text-xs text-[#9DA5A2]">{(design.size / 1024 / 1024).toFixed(1)} MB · PNG, JPEG or WebP</p>
                        </div>
                        <button type="button" onClick={clearDesign} className="cursor-pointer text-sm font-semibold text-red-600 hover:underline">
                          Remove
                        </button>
                      </div>
                    )}
                    <div className="mt-4">
                      <Field label="Notes about the design" hint="Optional — e.g. 'keep this layout, but use our green and a warmer tone'.">
                        <textarea
                          className={`${inputCls} min-h-[80px] resize-y`}
                          value={form.design_notes}
                          onChange={set("design_notes")}
                          maxLength={1000}
                          placeholder="Anything the AI should know about this reference?"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[#E4E8E5] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-[#9DA5A2]">
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-[#E5F2ED] text-[#0B5949]">
                    <CheckIcon />
                  </span>
                  Your progress is saved automatically
                </p>
                <div className="flex items-center gap-3">
                  {step > 1 && (
                    <button
                      type="button"
                      onClick={() => { setAttempted(false); setStep((s) => Math.max(1, s - 1)); }}
                      className="cursor-pointer rounded-xl border border-[#E4E8E5] bg-white px-5 py-3 text-sm font-semibold text-[#17201E] transition hover:border-[#CBD4CF] hover:bg-[#F6F8F7]"
                    >
                      ← Back
                    </button>
                  )}
                  {step < 3 ? (
                    <button
                      type="button"
                      onClick={next}
                      className="cursor-pointer rounded-xl bg-[#0B5949] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#073F35]"
                    >
                      Continue →
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy || !!designError}
                      className="cursor-pointer rounded-xl bg-[#0B5949] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#073F35] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? "Creating your website…" : "✨ Generate my website"}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
