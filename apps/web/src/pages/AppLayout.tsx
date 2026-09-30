import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SupportChat } from "../components/SupportChat.tsx";
import { UserMenu } from "../components/UserMenu.tsx";
import { ErrorState, PageSpinner } from "../components/ui.tsx";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { useMe } from "../lib/session.ts";
import { APP_NAME } from "../lib/title.ts";

function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="bg-warn-soft px-4 py-2 text-center text-sm text-warn">
      You are offline. Changes will fail until the connection returns.
    </div>
  );
}

const navLink = "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-canvas hover:text-ink";
const navActive = "bg-canvas text-ink font-medium";

export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      void navigate({ to: "/login" });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) void navigate({ to: "/login" });
  }, [me.error, navigate]);

  if (me.isPending) return <PageSpinner label="Checking your session" />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <PageSpinner label="Redirecting to sign in" />;
    return <ErrorState error={me.error} onRetry={() => me.refetch()} retrying={me.isFetching} title="Could not load your session" />;
  }

  const user = me.data;
  return (
    <div className="min-h-screen">
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-3 font-semibold">
            <span className="text-lg font-semibold tracking-tight text-ink">YourCompany</span>
            <span className="hidden border-l border-line pl-3 text-sm text-muted sm:inline">{APP_NAME}</span>
          </Link>
          <nav aria-label="Main" className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
            <Link to="/agreements" className={navLink} activeProps={{ className: navActive }}>
              Agreements
            </Link>
            <Link to="/rules" className={navLink} activeProps={{ className: navActive }}>
              Rules
            </Link>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <UserMenu
              email={user.email}
              name={user.displayName}
              isAdmin={user.role === "admin"}
              onLogout={() => logout.mutate()}
              loggingOut={logout.isPending}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted sm:px-6">
        Logged in as {user.email} (
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="inline-flex items-center gap-1 text-link hover:underline disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 4H4v12h4M13 6l4 4-4 4M17 10H8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          logout
        </button>
        )
      </footer>
      <SupportChat userName={user.displayName} />
    </div>
  );
}
