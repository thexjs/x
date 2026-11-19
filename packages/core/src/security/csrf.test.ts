import { describe, expect, test } from "bun:test";
import { withCsrfCookie } from "./csrf";

describe("withCsrfCookie", () => {
  test("does not set Secure on a plain http request outside production", () => {
    const req = new Request("http://example.com/");
    const res = withCsrfCookie(req, new Response("ok"));
    const setCookie = res.headers.getSetCookie()[0] ?? "";
    expect(setCookie).not.toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  test('sets Secure on an https request even when NODE_ENV isn\'t exactly "production"', () => {
    // A platform that names its production env var something else, or a
    // staging deployment genuinely served over HTTPS, must not silently
    // lose Secure just because NODE_ENV isn't the literal string
    // "production" -- the request's own scheme is an independent signal.
    const req = new Request("https://example.com/");
    const res = withCsrfCookie(req, new Response("ok"));
    const setCookie = res.headers.getSetCookie()[0] ?? "";
    expect(setCookie).toContain("Secure");
  });

  test("does not overwrite an already-present CSRF cookie", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "x_csrf_token=existing" },
    });
    const res = withCsrfCookie(req, new Response("ok"));
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
