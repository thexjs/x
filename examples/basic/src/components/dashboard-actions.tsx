// Kept in its own file with zero server-only imports. The island bundler's
// client entry does `import * as Route from "<the route file>"` to read its
// `islands` export, which means it evaluates the WHOLE route module -- a
// server loader that imports lib/auth (defineAuth, node:crypto) in that same
// file would get pulled into the browser bundle too, even as an unused
// export (confirmed: a dynamic `import()` inside the loader doesn't avoid
// it either, since Bun's bundler still statically discovers and bundles it).
// So this component fetches its own data from the already-public
// `GET /api/auth/session` endpoint instead of the page using a server
// loader -- `dashboard/_middleware.ts` still enforces the actual
// authorization server-side; this fetch is display-only.
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export default function DashboardActions() {
  const [username, setUsername] = useState("User");
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: { name?: string; email?: string } } | null) => {
        const name = data?.user?.name ?? data?.user?.email;
        if (name) setUsername(name);
      })
      .catch(() => {});
  }, []);

  async function handleGreet() {
    setGreeting("Loading...");
    try {
      const res = await fetch("/__x/actions/dashboard/greet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["Dashboard User"]),
      });
      if (!res.ok) throw new Error("Request failed");
      setGreeting(await res.text());
    } catch {
      setGreeting("Error");
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <>
      <p className="text-muted-foreground">Welcome, {username}!</p>
      <hr className="border-border" />
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Server Functions Demo</h2>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={handleGreet}>
            Greet
          </Button>
          <span className="italic text-muted-foreground">{greeting}</span>
        </div>
      </div>
      <hr className="border-border" />
      <div className="flex items-center gap-3">
        <Button type="button" variant="destructive" onClick={handleLogout}>
          Logout
        </Button>
        <a
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back home
        </a>
      </div>
    </>
  );
}
