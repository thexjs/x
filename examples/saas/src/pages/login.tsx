import { Island } from "@thexjs/core";
import { LogIn } from "lucide-react";
import { useState } from "react";

// Pages ship as static HTML with no client JS by default (zero hydration
// tax) -- the form needs real onSubmit/fetch behavior, so it's wrapped in an
// <Island> below rather than relying on a bare onSubmit that would never
// actually hydrate.
function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = e.currentTarget;
    const data = new FormData();
    data.set("email", form.email.value);
    data.set("password", form.password.value);
    try {
      // @thexjs/auth's credentials sign-in expects form data and redirects
      // (302 -> successRedirect) on success; fetch follows that redirect
      // automatically and returns the final response.
      const res = await fetch("/api/auth/signin/local", { method: "POST", body: data });
      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        setError(res.status === 429 ? "Too many attempts, try again later" : "Invalid credentials");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-card-foreground mb-1.5">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-card-foreground mb-1.5">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          placeholder="••••••••"
          className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/25 disabled:opacity-60"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export const islands = { LoginForm };

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl shadow-black/10">
          <div className="mb-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LogIn className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-card-foreground">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in to your account</p>
          </div>
          <Island name="LoginForm" client="load">
            <LoginForm />
          </Island>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <a
              href="/signup"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
            >
              Register
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
