import { Island } from "@thexjs/core";
import { UserPlus } from "lucide-react";
import { useState } from "react";

// See login.tsx: pages ship as static HTML with no client JS by default, so
// the interactive form is wrapped in an <Island> rather than relying on a
// bare onSubmit that would never actually hydrate.
function SignupForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = e.currentTarget;
    // HTMLFormElement already has its own `name` string property (the
    // form's own name attribute), which shadows a named-input lookup for a
    // field also called "name" -- go through `elements` explicitly for it.
    const nameField = form.elements.namedItem("name") as HTMLInputElement;
    const data = {
      email: form.email.value,
      password: form.password.value,
      name: nameField.value || undefined,
    };
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        const err = (await res.json()) as { error?: string };
        setError(err.error ?? "Signup failed");
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
        <label htmlFor="name" className="block text-sm font-medium text-card-foreground mb-1.5">
          Name
        </label>
        <input
          id="name"
          name="name"
          placeholder="Jane Doe"
          className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>
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
          minLength={8}
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
        {loading ? "Creating account..." : "Sign up"}
      </button>
    </form>
  );
}

export const islands = { SignupForm };

export default function SignupPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl shadow-black/10">
          <div className="mb-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserPlus className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-card-foreground">
              Create an account
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">Get started in a few seconds</p>
          </div>
          <Island name="SignupForm" client="load">
            <SignupForm />
          </Island>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a
              href="/login"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
