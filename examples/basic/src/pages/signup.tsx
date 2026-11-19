import { Island } from "@thexjs/core";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <Input id="name" name="name" />
      </div>
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
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      {error && (
        <p id="signup-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account..." : "Sign up"}
      </Button>
    </form>
  );
}

export const islands = { SignupForm };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm mt-16 space-y-6">
      <h1 className="text-2xl font-bold text-center">Create an account</h1>
      <Island name="SignupForm" client="load">
        <SignupForm />
      </Island>
      <p className="text-xs text-muted-foreground text-center">
        Already have an account?{" "}
        <a href="/login" className="underline hover:text-foreground transition-colors">
          Sign in
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
