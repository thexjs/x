// A small island, not a plain server-rendered component: `_layout.tsx` has
// no access to the request's session (layouts only ever receive `children`
// -- see wrapWithLayouts in createApp.ts), so this fetches the already-public
// GET /api/auth/session endpoint client-side instead. The dashboard's own
// authorization still happens server-side via dashboard/_middleware.ts; this
// fetch is purely for display.
import { User } from "lucide-react";
import { useEffect, useState } from "react";

export default function SidebarUserBadge() {
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: { name?: string; email?: string } } | null) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  const name = user?.name ?? user?.email ?? "…";
  const email = user?.email ?? "";

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-sidebar-foreground">{name}</span>
        <span className="text-xs text-sidebar-foreground/60">{email}</span>
      </div>
    </div>
  );
}
