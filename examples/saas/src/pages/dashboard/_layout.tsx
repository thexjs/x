import { Island } from "@thexjs/core";
import { BarChart3, LayoutDashboard, Settings } from "lucide-react";
import type { ReactNode } from "react";
import SidebarUserBadge from "../../components/sidebar-user-badge";
import { cn } from "../../lib/utils";

interface LayoutProps {
  children: ReactNode;
  page?: string;
}

// Declared as a *path string*, not the live `SidebarUserBadge` reference
// imported above for SSR -- this layout sits in the chain for every
// /dashboard/* route, including dashboard/index.tsx, whose own loader
// dynamically imports lib/auth (defineAuth, node:crypto). A live-reference
// island here would force the client hydration entry to import the whole
// layout chain (route included) to resolve it, leaking that loader's
// imports into the browser bundle -- the same bug closed in
// packages/core/src/island-bundle.ts's `resolveIslandPaths`. A path-backed
// entry imports this file directly instead.
export const islands = { SidebarUserBadge: "../../components/sidebar-user-badge" };

const sidebarLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children, page }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-64 flex-col border-r border-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
            S
          </div>
          <span className="text-lg font-bold text-sidebar-foreground">SaaS</span>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const isActive = page === link.label;
            return (
              <a
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </a>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <Island name="SidebarUserBadge" client="load">
            <SidebarUserBadge />
          </Island>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b border-border bg-background px-8">
          <h1 className="text-lg font-semibold text-foreground">{page || "Dashboard"}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
