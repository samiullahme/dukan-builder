"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  action,
  requireReason = false,
  reasonPlaceholder = "Why is this action needed?",
  variant = "outline",
  tone = "destructive",
  size = "sm",
  className,
  disabled,
  formFields,
}: {
  label: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  tone?: "destructive" | "default";
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
  formFields?: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (requireReason && reason.trim().length < 4) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("reason", reason.trim());
    for (const [k, v] of Object.entries(formFields ?? {})) fd.set(k, v);
    try {
      const res = await action(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <AlertDialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            className={cn(tone === "destructive" && "text-red-700 hover:text-red-700", className)}
            disabled={disabled}
          />
        }
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

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

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            render={
              <Button
                className={cn(tone === "destructive" && "bg-red-700 text-white hover:bg-red-800")}
                disabled={busy || (requireReason && reason.trim().length < 4)}
              />
            }
            onClick={(e) => {
              e.preventDefault();
              run();
            }}
          >
            {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
