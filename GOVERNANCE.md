# Governance

How decisions get made in `x`, who can merge what, and how that grows over time. Companion to [`CONTRIBUTING.md`](./CONTRIBUTING.md) (how to contribute) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) (how to behave while doing it) — this document covers authority and process, neither of which they do.

## Current state

`x` has one maintainer with merge rights across the entire repository: [@abdelkabirouadoukou](https://github.com/abdelkabirouadoukou). That is the single biggest risk to anyone depending on this project long-term, not a code-quality issue — an availability one. [This is being actively addressed](https://github.com/thexjs/x/discussions/356): the project is looking for a second maintainer, starting scoped and widening as trust builds, per the model below.

## Three kinds of calls

Every PR review and every design question falls into one of these. Knowing which one you're looking at is most of the judgment call.

- **Bug fixes.** A clear gap between documented/intended behavior and actual behavior, with no real design choice involved. Anyone with merge rights in the relevant area can fix and merge these on their own judgment — that's the baseline of what merge rights mean.
- **Scoped design calls.** A real choice exists (which store to make the default, how to structure an API, whether a change is additive or breaking), but it's contained to the area a reviewer already owns via `CODEOWNERS`. The owner decides, documents the reasoning in the PR description (and in a new ADR under `docs/adr/` if it clears [the bar in the ADR format doc](./.claude/skills/domain-modeling/ADR-FORMAT.md) — hard to reverse, surprising without context, and the result of a real trade-off), and merges.
- **Cross-cutting design calls.** Anything that changes a convention used across multiple packages, touches the security/versioning/governance documents at the repo root, or would be expensive to reverse once other code depends on it. These are not any one area owner's to decide alone — flag them explicitly rather than guessing, the same way [PR #309's empty-directory race](https://github.com/thexjs/x/pull/309) was correctly left to the maintainer rather than resolved either way by the contributor who found it. That flag-rather-than-guess instinct is exactly the judgment this project looks for when considering someone for broader merge rights.

## How CODEOWNERS scope grows

New contributors start with none. The path from "has sent a few good PRs" to "has merge rights" runs through `.github/CODEOWNERS`, scoped narrow before it's ever scoped wide:

1. **Track record first.** A handful of clean, focused PRs in real bug territory (not drive-by typo fixes), ideally touching the same one or two files/directories more than once. [jay23606's PRs #309 (Redis rate-limiter atomicity), #322, and #324 (the scaffolder race condition)](https://github.com/thexjs/x/discussions/356) are the reference example of what this looks like.
2. **A scoped CODEOWNERS entry.** The maintainer adds a path-specific line to `.github/CODEOWNERS` for the area the contributor has already demonstrated judgment in — e.g. a line for `packages/core/src/security/` once someone has shown they understand this project's trust-boundary conventions (ADR-0003, ADR-0007), not day one.
3. **Widen as trust builds.** More paths, or eventually commit access without a scoped boundary, only after the scoped arrangement has actually run for a while without needing correction. There's no fixed timeline — this is deliberately slower than "merge a few PRs, get full access," because the thing being protected is every other consumer's trust in what gets merged to `main`.

Nothing above requires the maintainer search to succeed first — scoped `CODEOWNERS` entries for trusted contributors are a normal, ongoing part of growing the project regardless of whether a formal co-maintainer is found.

## Escalation

Disagree with a judgment call, or think something was merged that shouldn't have been? Open a GitHub Discussion (not an issue — issues are for bugs, not process disputes) or comment directly on the PR in question. There is no vote; with one maintainer there is one tiebreaker, which is itself a reason the co-maintainer search above matters.
