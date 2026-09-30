import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui.tsx";

/** The signed-in user's email in the header; opens a small menu with Integrations, the admin pages (Settings, Users, Audit log) and Logout. */
export function UserMenu({
  email,
  name,
  isAdmin,
  onLogout,
  loggingOut,
}: {
  email: string;
  name: string;
  /** Admins also get Settings, Users and Audit log. */
  isAdmin: boolean;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          root.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[8rem] items-center sm:max-w-[16rem] gap-1.5 rounded-sm px-2 py-1.5 text-sm text-ink hover:bg-canvas"
      >
        <span className="truncate">{email}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className={cx("shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 min-w-40 rounded-sm border border-line bg-white py-1">
          <p className="border-b border-line px-3 pb-2 pt-1 text-xs text-muted">{name}</p>
          <Link
            to="/integrations"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M7.5 12.5l5-5M8.5 5.5l1-1a3.5 3.5 0 015 5l-1 1M11.5 14.5l-1 1a3.5 3.5 0 01-5-5l1-1" strokeLinecap="round" />
            </svg>
            Integrations
          </Link>
          {isAdmin && (
            <Link
              to="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M3 5h8M15 5h2M3 10h2M9 10h8M3 15h10M17 15h0" strokeLinecap="round" />
                <circle cx="13" cy="5" r="2" />
                <circle cx="7" cy="10" r="2" />
                <circle cx="15" cy="15" r="2" />
              </svg>
              Settings
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/settings/users"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75">
                <circle cx="8" cy="7" r="3" />
                <path
                  d="M2.5 16.5c.8-2.8 3-4.3 5.5-4.3s4.7 1.5 5.5 4.3M13.5 4.5a3 3 0 010 5M15.5 12.6c1 .8 1.7 2 2 3.9"
                  strokeLinecap="round"
                />
              </svg>
              Users
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/audit-log"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M5 2.5h7l3 3v12H5z" strokeLinejoin="round" />
                <path d="M8 9h4M8 12h4M8 15h2" strokeLinecap="round" />
              </svg>
              Audit log
            </Link>
          )}
          <button
            ref={item}
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M8 4H4v12h4M13 6l4 4-4 4M17 10H8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
