import { useState } from "react";

export default function Login() {
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
    <main style={{ maxWidth: 360, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Sign in</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Email
          <input name="email" type="email" required style={field} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Password
          <input name="password" type="password" required style={field} />
        </label>
        {error && <p style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>}
        <button type="submit" disabled={loading} style={submit}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "1rem" }}>
        No account yet? <a href="/signup">Sign up</a>
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
