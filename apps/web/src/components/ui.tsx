import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useEffect, useId } from "react";
import { ApiError, errorMessage } from "../lib/api.ts";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Spinner({ size = 16, className, label = "Loading" }: { size?: number; className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx("inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} style={{ animation: "spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function PageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-muted">
      <Spinner size={22} label={label} />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
// Brand buttons: white or transparent fill with an orange border; the fill turns orange on hover.
const variants: Record<Variant, string> = {
  primary: "bg-white text-ink border border-brand hover:bg-brand hover:text-white disabled:border-brand/40 disabled:text-muted",
  secondary: "bg-transparent text-ink border border-brand hover:bg-brand/10 disabled:border-brand/40 disabled:text-muted",
  danger: "bg-white text-danger border border-danger/30 hover:bg-danger-soft disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-canvas disabled:opacity-50",
};

export function Button({
  loading,
  variant = "primary",
  size = "md",
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner size={14} label="Working" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-canvas aria-[invalid=true]:border-danger";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, "pr-8", props.className)} />;
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-white", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const tones = {
  neutral: "bg-canvas text-muted border-line",
  brand: "bg-brand/8 text-brand border-brand/15",
  good: "bg-accent/10 text-accent border-accent/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  bad: "bg-danger-soft text-danger border-danger/20",
};
export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-line/70", className)} />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  retrying,
  title = "Could not load this",
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.5v.01" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-muted">{errorMessage(error)}</p>
        {requestId && (
          <p className="mt-1 font-mono text-xs text-muted">
            Request id: <span className="select-all">{requestId}</span>
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
