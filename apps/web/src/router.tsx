import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { ErrorState } from "./components/ui.tsx";
import { ApiError, api } from "./lib/api.ts";
import { meQueryKey } from "./lib/session.ts";
import { AgreementDetailPage } from "./pages/AgreementDetailPage.tsx";
import { AgreementsPage, parseAgreementSearch } from "./pages/AgreementsPage.tsx";
import { AnonymizationSettingsPage } from "./pages/AnonymizationSettingsPage.tsx";
import { AppLayout } from "./pages/AppLayout.tsx";
import { AuditLogPage } from "./pages/AuditLogPage.tsx";
import { AuditReportPage } from "./pages/AuditReportPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { IntegrationsPage } from "./pages/IntegrationsPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { RulesPage } from "./pages/RulesPage.tsx";
import { AuditModelSettingsPage, SettingsLayout } from "./pages/SettingsPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  errorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} title="This page crashed" />,
  notFoundComponent: () => <ErrorState error={new Error("Page not found")} title="Page not found" />,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });

const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: DashboardPage });
/** Admin-only pages send other roles back to the dashboard. */
const requireAdmin = async ({ context }: { context: { queryClient: QueryClient } }) => {
  const me = await context.queryClient.ensureQueryData({ queryKey: meQueryKey, queryFn: api.me }).catch(() => null);
  if (me && me.role !== "admin") throw redirect({ to: "/" });
};

const auditLogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/audit-log",
  beforeLoad: requireAdmin,
  component: AuditLogPage,
});
const rulesRoute = createRoute({ getParentRoute: () => appRoute, path: "/rules", component: RulesPage });
const agreementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agreements",
  validateSearch: parseAgreementSearch,
  component: AgreementsPage,
});
const agreementRoute = createRoute({ getParentRoute: () => appRoute, path: "/agreements/$agreementId", component: AgreementDetailPage });
const auditRoute = createRoute({ getParentRoute: () => appRoute, path: "/audits/$runId", component: AuditReportPage });
const usersRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings/users", beforeLoad: requireAdmin, component: UsersPage });
const integrationsRoute = createRoute({ getParentRoute: () => appRoute, path: "/integrations", component: IntegrationsPage });
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  beforeLoad: requireAdmin,
  component: SettingsLayout,
});
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/anonymization" });
  },
});
const anonymizationRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/anonymization",
  component: AnonymizationSettingsPage,
});
const auditModelRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/model", component: AuditModelSettingsPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    agreementsRoute,
    agreementRoute,
    auditRoute,
    rulesRoute,
    auditLogRoute,
    usersRoute,
    settingsRoute.addChildren([settingsIndexRoute, anonymizationRoute, auditModelRoute]),
    integrationsRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
