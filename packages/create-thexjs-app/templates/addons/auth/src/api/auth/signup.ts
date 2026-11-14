import { auth, createUser } from "../../lib/auth";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { email?: string; password?: string; name?: string };
    const { email, password, name } = body;

    if (!email || !password) {
      return Response.json({ error: "email and password required" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
    }

    const user = await createUser(email, password, name);
    const res = Response.json({ user });
    return auth.setSessionCookie(res, user, "local", req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signup failed";
    // createUser's "already exists" check is the only expected failure mode;
    // anything else is a real server error, not a 400 to the client.
    const status = message.includes("already exists") ? 409 : 500;
    return Response.json({ error: status === 409 ? message : "Signup failed" }, { status });
  }
}
