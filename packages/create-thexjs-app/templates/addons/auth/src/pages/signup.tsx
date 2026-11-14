import { useState } from "react";

export default function Signup() {
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
    <main style={{ maxWidth: 360, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Create an account</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Name
          <input name="name" style={field} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Email
          <input name="email" type="email" required style={field} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Password
          <input name="password" type="password" required minLength={8} style={field} />
        </label>
        {error && <p style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>}
        <button type="submit" disabled={loading} style={submit}>
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>
      <p style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "1rem" }}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </main>
  );
}

const field: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: "0.95rem",
};

const submit: React.CSSProperties = {
  padding: "0.65rem 1rem",
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
};
