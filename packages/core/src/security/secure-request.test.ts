import { afterEach, describe, expect, test } from "bun:test";
import { isSecureRequest } from "./secure-request";
import { configureTrustedProxy, resetTrustedProxy } from "./trusted-proxy";

describe("isSecureRequest", () => {
  afterEach(() => {
    resetTrustedProxy();
  });

  test("true for a request whose own URL is https", () => {
    const req = new Request("https://example.com/");
    expect(isSecureRequest(req)).toBe(true);
  });

  test("false for a plain http request with no trusted proxy configured", () => {
    const req = new Request("http://example.com/");
    expect(isSecureRequest(req)).toBe(false);
  });

  test("false for an http request with a spoofed X-Forwarded-Proto when trust is not configured", () => {
    // A client can set this header to anything; it must be ignored unless
    // the app has explicitly opted in to trusting forwarded headers.
    const req = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isSecureRequest(req)).toBe(false);
  });

  test("true for an http request with X-Forwarded-Proto: https once trust is configured", () => {
    configureTrustedProxy({ trustForwardedHeaders: true });
    const req = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isSecureRequest(req)).toBe(true);
  });

  test("false for an http request with X-Forwarded-Proto: http even with trust configured", () => {
    configureTrustedProxy({ trustForwardedHeaders: true });
    const req = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "http" },
    });
    expect(isSecureRequest(req)).toBe(false);
  });
});
