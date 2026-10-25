"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card } from "./ui";

type Msg = { role: string; content: string; created_at: string };

export function ChatPanel({ siteId, canChat }: { siteId: string; canChat: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [refining, setRefining] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const res = await fetch(`/api/sites/${siteId}/chat`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setRefining(data.refining);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!refining) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [refining]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, refining]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send.");
      setInput("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col p-6">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        Refine with AI
      </h2>
      <p className="mt-3 text-sm text-slate-500">
        {canChat
          ? "Describe a change in plain words — the AI updates your site."
          : "Chat unlocks after the first build finishes."}
      </p>

      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            {canChat ? "No refinements yet. Try: “Make the headline bigger and add our timings to the top.”" : "Your conversation with the AI will appear here."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {refining && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              AI is updating your site…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          disabled={!canChat || busy}
          placeholder={canChat ? "e.g. Add a photo gallery section…" : "Chat unlocks after the first build…"}
          maxLength={2000}
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm transition focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <Button onClick={send} disabled={!canChat || busy || !input.trim()}>Send</Button>
      </div>
    </Card>
  );
}
