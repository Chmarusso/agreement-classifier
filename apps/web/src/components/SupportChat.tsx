import { useRouterState } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { cx } from "./ui.tsx";

/**
 * Mockup of a live support chat. Nothing is sent anywhere: replies are canned and
 * the conversation lives only in this tab. It shows where a real chat would sit and
 * what context (the current page, never agreement text) it would pass to support.
 */

type Message = { id: number; from: "agent" | "user"; text: string; at: Date };

const AGENT = { name: "Marta", team: "Legal Ops support" };
const QUICK_REPLIES = ["A finding looks wrong", "Question about anonymization", "How do I add a rule?"];

const CANNED: [RegExp, string][] = [
  [
    /anonymi|pii|personal|dane osobowe|rodo|gdpr/i,
    "Personal data is replaced on our own server before any model sees the text. On the agreement page, use “Show extracted text” → “Sent to model” to see exactly what left.",
  ],
  [/rule|regu/i, "Admins add rules on the Rules page. You can limit a rule to agreement types and to Polish or English agreements."],
  [
    /finding|wrong|błęd|incorrect|audit/i,
    "Sorry about that. Open the report and tell me which rule looks wrong. I'll check the quoted clause with the legal team.",
  ],
];

const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function reply(text: string, page: string): string {
  const match = CANNED.find(([re]) => re.test(text))?.[1];
  return `${match ?? "Thanks, I've got your message."} (Demo: in production this would reach the support team with a link to ${page}. No agreement text is shared.)`;
}

export function SupportChat({ userName }: { userName: string }) {
  const page = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(1);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 1,
      from: "agent",
      text: `Hi ${userName.split(" ")[0]}, I'm ${AGENT.name}. How can I help with your agreements today?`,
      at: new Date(),
    },
  ]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setUnread(0);
      input.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, typing]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = (text: string) => {
    const body = text.trim();
    if (!body) return;
    setMessages((m) => [...m, { id: m.length + 1, from: "user", text: body, at: new Date() }]);
    setDraft("");
    setTyping(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: m.length + 1, from: "agent", text: reply(body, page), at: new Date() }]);
      if (!open) setUnread((n) => n + 1);
    }, 1200);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          aria-label="Live support chat"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="flex h-[30rem] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-sm border border-line bg-white sm:w-96"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
              {AGENT.name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">
                {AGENT.name} · {AGENT.team}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" /> Online · usually replies in 2 min
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-sm p-1 text-muted hover:bg-canvas hover:text-ink"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </header>
          <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-xs text-warn">
            Demo: not connected to a support team yet. Messages stay in this tab.
          </p>
          <ol ref={list} aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-canvas px-4 py-4">
            {messages.map((m) => (
              <li key={m.id} className={cx("flex max-w-[85%] flex-col gap-1", m.from === "user" ? "self-end items-end" : "self-start")}>
                <p
                  className={cx(
                    "rounded-sm px-3 py-2 text-sm leading-relaxed",
                    m.from === "user" ? "bg-brand text-white" : "border border-line bg-white text-ink",
                  )}
                >
                  {m.text}
                </p>
                <span className="text-[11px] text-muted">
                  {m.from === "agent" ? AGENT.name : "You"} · {time(m.at)}
                </span>
              </li>
            ))}
            {typing && (
              <li className="self-start text-xs text-muted" aria-label={`${AGENT.name} is typing`}>
                {AGENT.name} is typing…
              </li>
            )}
          </ol>
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-sm border border-line px-2 py-1 text-xs text-ink hover:border-brand hover:text-brand"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
            <label htmlFor="support-chat-input" className="sr-only">
              Message
            </label>
            <input
              id="support-chat-input"
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your message…"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-sm border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-sm bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close live support chat" : "Support chat"}
        className="relative flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-hover"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" />
        </svg>
        <span className="hidden sm:inline">{open ? "Close" : "Support"}</span>
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] text-white">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}
