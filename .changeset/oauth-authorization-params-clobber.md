---
"@thexjs/auth": patch
---

Fix `buildAuthorizationUrl` letting a provider's `authorizationParams` override security-critical params (`state`, `code_challenge`, `code_challenge_method`, `client_id`, `redirect_uri`, `response_type`). Previously these were applied last and silently clobbered, which could weaken or replace the CSRF/PKCE binding depending on what a config (or an attacker-influenced config value) set. These six keys are now always reserved; any value for them in `authorizationParams` is ignored.
