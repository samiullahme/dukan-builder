"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function FormAction({
  label,
  title,
  description,
  confirmLabel,
  action,
  field,
  requireReason = false,
  reasonPlaceholder = "Why is this action needed?",
  variant = "outline",
  tone = "default",
  size = "sm",
  className,
}: {
  label: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  field?: {
    name: string;
    label: string;
    placeholder?: string;
    type?: "text" | "number" | "password";
    min?: number;
    max?: number;
    hint?: string;
  };
  requireReason?: boolean;
  reasonPlaceholder?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  tone?: "destructive" | "default";
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = !field || value.trim() !== "";

  const run = async () => {
    if (!valid) return;
    if (requireReason && reason.trim().length < 4) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("reason", reason.trim());
    if (field) fd.set(field.name, value.trim());
    try {
      const res = await action(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setValue("");
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <DialogTrigger render={<Button variant={variant} size={size} className={className} />}>
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {field && (
          <Field className="mt-2">
            <FieldLabel>{field.label}</FieldLabel>
            <Input
              type={field.type ?? "text"}
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
            />
            {field.hint && <p className="text-xs text-slate-400">{field.hint}</p>}
            {!valid && <FieldError>This field is required.</FieldError>}
          </Field>
        )}

        {requireReason && (
          <Field className="mt-2">
            <FieldLabel>Reason</FieldLabel>
            <Textarea
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              maxLength={500}
            />
            {reason.trim().length > 0 && reason.trim().length < 4 && (
              <FieldError>Write at least a few words so the audit log is useful.</FieldError>
            )}
          </Field>
        )}

        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="mt-4">
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button
            className={cn(tone === "destructive" && "bg-red-700 text-white hover:bg-red-800")}
            disabled={busy || !valid || (requireReason && reason.trim().length < 4)}
            onClick={run}
          >
            {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
