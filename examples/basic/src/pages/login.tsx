import { Island } from "@thexjs/core";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

// Pages render as static HTML with no client JS by default (zero hydration
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input id="password" name="password" type="password" required />
      </div>
      {error && (
        <p id="login-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

export const islands = { LoginForm };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm mt-16 space-y-6">
      <h1 className="text-2xl font-bold text-center">Login</h1>
      <Island name="LoginForm" client="load">
        <LoginForm />
      </Island>
      <p className="text-xs text-muted-foreground text-center">
        No account yet?{" "}
        <a href="/signup" className="underline hover:text-foreground transition-colors">
          Sign up
        </a>
      </p>
      <p className="text-center">
        <a
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back home
        </a>
      </p>
    </div>
  );
}
