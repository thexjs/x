import { auth } from "../../lib/auth";

export const middleware = auth.requireAuth({ redirectTo: "/login" });
