import type { LoaderArgs, RouteProps } from "@thexjs/core";
import { Island } from "@thexjs/core";
import DashboardActions from "../../components/dashboard-actions";
import Head from "../../components/Head";
import { auth } from "../../lib/auth";

// `dashboard/_middleware.ts` already enforces sign-in (auth.requireAuth),
// so a session is guaranteed here -- this loader just reads it for display.
//
// DashboardActions is declared below as a *path string*, not the live
// `DashboardActions` reference imported above for SSR -- that string is what
// lets the client island bundle import dashboard-actions.tsx directly
// instead of re-importing this whole route file (and this loader's
// `lib/auth` import, which touches node:crypto) into the browser bundle.
// See packages/core/src/island-bundle.ts's `resolveIslandPaths`: a route
// combining a server-only loader with a *co-located* island used to leak the
// loader's imports into the client bundle, because the browser-side
// hydration entry had no way to get at the island without re-evaluating the
// whole module. A string-valued `islands` entry sidesteps that entirely.
//
// Note: hydration never passes props to an island (see `hydrateRoot(el,
// React.createElement(Component))` in island-bundle.ts), so the username
// itself is rendered directly here from `loaderData` -- outside the island,
// with no client fetch and no hydration-mismatch risk -- rather than inside
// DashboardActions.
export async function loader({ request }: LoaderArgs) {
  const session = await auth.getSession(request);
  return { username: session?.user.name ?? session?.user.email ?? "User" };
}

export const islands = { DashboardActions: "../../components/dashboard-actions" };

export default function DashboardPage({ loaderData }: RouteProps) {
  const username = (loaderData?.username as string) ?? "User";

  return (
    <>
      <Head title={`Dashboard — ${username}`} description="User dashboard" />
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome, {username}!</p>
        <hr className="border-border" />
        <Island name="DashboardActions" client="load">
          <DashboardActions />
        </Island>
      </div>
    </>
  );
}
