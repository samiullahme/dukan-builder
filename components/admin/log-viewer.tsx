"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  prepare: "bg-sky-100 text-sky-800",
  agent: "bg-violet-100 text-violet-800",
  repair: "bg-amber-100 text-amber-800",
  qa: "bg-emerald-100 text-emerald-800",
  finished: "bg-pine-100 text-pine-900",
  failed: "bg-red-100 text-red-800",
};

function cleanLine(line: string): string {
  return line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r$/, "");
}

export function LogViewer({ log }: { log: string }) {
  const [query, setQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const lines = useMemo(() => {
    const cleaned = log
      .split("\n")
      .map((l) => cleanLine(l))
      .filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    const q = query.toLowerCase();
    return cleaned.map((text, i) => {
      const stageMatch = text.match(/^\[stage:([a-z_]+)\]\s*(.*)$/);
      const failedMatch = text.match(/FAILED:/);
      let stage: string | null = null;
      if (stageMatch) stage = stageMatch[1];
      else if (failedMatch) stage = "failed";
      else if (/finished successfully/.test(text)) stage = "finished";
      const matches = q ? text.toLowerCase().includes(q) : true;
      return { i, text, stage, matches };
    });
  }, [log, query]);

  const visible = onlyMatches ? lines.filter((l) => l.matches) : lines;

  useEffect(() => {
    if (!scrolled.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <InputGroup className="w-full sm:max-w-xs">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <Input value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder="Search the log…" className="h-8" />
        </InputGroup>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <Switch checked={onlyMatches} onCheckedChange={setOnlyMatches} />
          Matches only
        </label>
        <span className="text-xs tabular-nums text-slate-400">{visible.length} lines</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={copy}>
          {copied ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
          {copied ? "Copied" : "Copy log"}
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="bg-slate-950 py-10">
          <Empty className="text-slate-400">
            <EmptyTitle>No matching lines</EmptyTitle>
            <EmptyContent>
              <EmptyDescription>Nothing in this log matches your search.</EmptyDescription>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div
          className="max-h-[28rem] overflow-auto bg-slate-950 py-2 font-mono text-xs leading-5"
          onScroll={(e: React.UIEvent<HTMLDivElement>) => {
            const el = e.currentTarget;
            scrolled.current = el.scrollTop + el.clientHeight < el.scrollHeight - 40;
          }}
        >
          {visible.map(({ i, text, stage }) => {
            const isFailure = text.includes("FAILED:");
            return (
              <div key={i} className={cn("flex gap-3 px-3 hover:bg-slate-900", isFailure && "bg-red-950/60 hover:bg-red-950")}>
                <span className="w-10 shrink-0 select-none text-right tabular-nums text-slate-600">{i + 1}</span>
                {stage && (
                  <span className={cn("mt-0.5 h-fit shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", STAGE_COLORS[stage])}>
                    {stage}
                  </span>
                )}
                <span className={cn("whitespace-pre-wrap break-all", isFailure ? "font-semibold text-red-300" : "text-slate-200")}>{text}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
