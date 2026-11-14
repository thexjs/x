// Catch-all for every @thexjs/auth route:
//   POST /api/auth/signin/local   -- credentials sign-in (form data)
//   POST /api/auth/signout        -- sign out
//   GET  /api/auth/session        -- { user } or 401
import { auth } from "../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  return auth.handleRequest(req);
}

export async function POST(req: Request): Promise<Response> {
  return auth.handleRequest(req);
}
