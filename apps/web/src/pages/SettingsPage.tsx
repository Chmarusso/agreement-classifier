import { Link, Outlet } from "@tanstack/react-router";
import { AuditModelCard } from "../components/AuditModelCard.tsx";
import { usePageTitle } from "../lib/title.ts";

/** The router marks the current tab with data-status="active". */
const tab =
  "-mb-px whitespace-nowrap border-b-2 border-transparent px-1 pb-3 text-sm text-muted transition-colors hover:text-ink data-[status=active]:border-brand data-[status=active]:font-medium data-[status=active]:text-ink";

/** Admin settings: one place for the audit model and anonymization. */
export function SettingsLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          How agreements are anonymized and which model audits them. Changes apply to new uploads and audits.
        </p>
      </div>
      <nav aria-label="Settings" className="flex gap-6 overflow-x-auto border-b border-line">
        <Link to="/settings/anonymization" className={tab}>
          Anonymization
        </Link>
        <Link to="/settings/model" className={tab}>
          Audit model
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export function AuditModelSettingsPage() {
  usePageTitle("Audit model");
  return (
    <div className="max-w-2xl">
      <AuditModelCard />
    </div>
  );
}
