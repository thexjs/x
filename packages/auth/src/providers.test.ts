import { describe, expect, test } from "bun:test";
import { buildAuthorizationUrl, type OAuth2ProviderConfig } from "./providers";

function makeProvider(authorizationParams?: Record<string, string>): OAuth2ProviderConfig {
  return {
    id: "example",
    name: "Example",
    type: "oauth",
    clientId: "real-client-id",
    clientSecret: "secret",
    authorizationUrl: "https://example.com/oauth/authorize",
    tokenUrl: "https://example.com/oauth/token",
    ...(authorizationParams ? { authorizationParams } : {}),
    profile: () => ({ id: "1" }),
  };
}

describe("buildAuthorizationUrl", () => {
  test("sets client_id, redirect_uri, response_type, and state", () => {
    const url = new URL(buildAuthorizationUrl(makeProvider(), "https://app.example", "real-state"));
    expect(url.searchParams.get("client_id")).toBe("real-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/auth/callback/example",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("real-state");
  });

  test("sets code_challenge and code_challenge_method when PKCE is used", () => {
    const url = new URL(
      buildAuthorizationUrl(makeProvider(), "https://app.example", "real-state", "real-challenge"),
    );
    expect(url.searchParams.get("code_challenge")).toBe("real-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("passes through non-reserved authorizationParams", () => {
    const url = new URL(
      buildAuthorizationUrl(
        makeProvider({ scope: "read:user", prompt: "consent" }),
        "https://app.example",
        "real-state",
      ),
    );
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  test("#174: authorizationParams cannot override state, even if config sets it", () => {
    const url = new URL(
      buildAuthorizationUrl(
        makeProvider({ state: "attacker-controlled" }),
        "https://app.example",
        "real-state",
      ),
    );
    expect(url.searchParams.get("state")).toBe("real-state");
  });

  test("#174: authorizationParams cannot override code_challenge or its method", () => {
    const url = new URL(
      buildAuthorizationUrl(
        makeProvider({ code_challenge: "attacker-challenge", code_challenge_method: "plain" }),
        "https://app.example",
        "real-state",
        "real-challenge",
      ),
    );
    expect(url.searchParams.get("code_challenge")).toBe("real-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("#174: authorizationParams cannot override client_id, redirect_uri, or response_type", () => {
    const url = new URL(
      buildAuthorizationUrl(
        makeProvider({
          client_id: "attacker-client-id",
          redirect_uri: "https://evil.example/callback",
          response_type: "token",
        }),
        "https://app.example",
        "real-state",
      ),
    );
    expect(url.searchParams.get("client_id")).toBe("real-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/auth/callback/example",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});
