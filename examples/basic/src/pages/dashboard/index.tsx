import type { RouteProps } from "@thexjs/core";
import { Island } from "@thexjs/core";
import DashboardActions from "../../components/dashboard-actions";
import Head from "../../components/Head";

// No server loader here on purpose -- see dashboard-actions.tsx for why a
// route exporting `islands` can't also have a loader that imports
// server-only code (lib/auth) without leaking it into the client bundle.
// `dashboard/_middleware.ts` (auth.requireAuth) is the actual server-side
// authorization; this route itself doesn't need to read the session.
export const islands = { DashboardActions };

export default function DashboardPage(_props: RouteProps) {
  return (
    <>
      <Head title="Dashboard" description="User dashboard" />
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Island name="DashboardActions" client="load">
          <DashboardActions />
        </Island>
      </div>
    </>
  );
}
