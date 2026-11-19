// Kept in its own file with zero server-only imports, and declared in
// dashboard/index.tsx's `islands` map as a *path string* rather than a live
// component reference -- that's what lets the client island bundle import
// this file directly instead of re-importing the whole route module (and
// its server-only `loader`, which touches node:crypto via lib/auth) into
// the browser bundle. See packages/core/src/island-bundle.ts.
import { useState } from "react";
import { Button } from "./ui/button";

export default function DashboardActions() {
  const [greeting, setGreeting] = useState("");

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
