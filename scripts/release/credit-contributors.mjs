#!/usr/bin/env bun
/**
 * Enriches newly published GitHub release notes with a "Contributors" section.
 *
 * Changesets/action creates one release per published package from the
 * changelog, but those notes credit no one. This script finds each release
 * tag and appends a row of avatars for the distinct humans whose commits
 * shipped in that release -- linked to their GitHub profile, no names in the
 * row itself (GitHub's own hover card shows the name on a profile link).
 * GitHub's dependabot/actions bots are excluded from the human shout-outs.
 *
 * Each commit's GitHub-resolved author (login + avatar, from the commit API,
 * not the raw git author email) is used so the avatar actually matches the
 * account GitHub itself attributes the commit to. A commit whose email isn't
 * linked to any GitHub account falls back to a plain name credit, since
 * there's no profile/avatar to link.
 *
 * Contributors are the distinct authors of every commit between the release's
 * tag and the previous tag of the *same package*. The baseline is resolved per
 * package via `git tag --list` so mixed tag namespaces never interfere.
 *
 * Run in CI after `changesets/action` publishes. Requires `GITHUB_TOKEN` with
 * `contents: write` and read access to the repo. Idempotent: releases that
 * already carry a `## Contributors` section are skipped.
 */

import { execSync } from "node:child_process";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? "thexjs/x";
const dryRun = process.argv.includes("--dry-run");
if (!token && !dryRun) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const GH = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path, method = "GET", body) {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Distinct human commit authors (name/email/sha) in the given git range. */
function humanCommits(range) {
  const log = execSync(`git log --format='%H|%an|%ae' ${range}`, { encoding: "utf-8" });
  const seen = new Map(); // email -> { name, sha }
  for (const line of log.split("\n")) {
    if (!line) continue;
    const [sha, name, email] = line.split("|");
    const cleanEmail = email?.trim().toLowerCase();
    const cleanName = name?.trim();
    if (!sha || !cleanName || !cleanEmail) continue;
    // Bots are called out separately; never credit them as humans.
    if (
      /bot|dependabot|github-actions|\[bot\]/i.test(cleanName) ||
      /\bbot\b|noreply\.github\.com$/.test(cleanEmail)
    ) {
      continue;
    }
    if (!seen.has(cleanEmail)) seen.set(cleanEmail, { name: cleanName, sha });
  }
  return seen;
}

/**
 * Resolves each commit to the GitHub account it displays on that commit
 * (login + avatar), via the commit API rather than guessing from the raw git
 * email. Returns `null` for a commit whose email isn't linked to any account
 * (GitHub returns `author: null` in that case) -- there's no profile to show
 * an avatar for, so the caller falls back to a plain name credit.
 */
async function resolveGithubProfile(sha, dryRun) {
  if (dryRun) return null;
  const commit = await api(`/repos/${repo}/commits/${sha}`);
  if (!commit.author) return null;
  return {
    login: commit.author.login,
    avatarUrl: commit.author.avatar_url,
    htmlUrl: commit.author.html_url,
  };
}

/** Version namespace (tag prefix before the `@x.y.z` portion). */
function familyPrefix(tag) {
  return tag.replace(/@?\d+(\.\d+){0,2}(-\d+)?$/, "");
}

async function run() {
  // All release tags, newest-first per package namespace.
  const tags = execSync(`git tag --sort=-v:refname`, { encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);

  // Group tags by family, preserving newest-first order for each.
  const byFamily = new Map();
  for (const tag of tags) {
    const prefix = familyPrefix(tag);
    if (!byFamily.has(prefix)) byFamily.set(prefix, []);
    byFamily.get(prefix).push(tag);
  }

  for (const [_prefix, familyTags] of byFamily) {
    for (let i = 0; i < familyTags.length; i++) {
      const tag = familyTags[i];
      const prevTag = familyTags[i + 1] ?? null; // next in newest-first = previous release

      let release;
      if (dryRun) {
        release = { id: 0, tag_name: tag, draft: false, prerelease: false, body: "" };
      } else {
        try {
          release = await api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
        } catch (_err) {
          continue; // no release object for this tag yet
        }
      }
      if (!release || release.draft || release.prerelease) continue;
      if (release.body?.includes("## Contributors")) continue; // idempotent

      const range = prevTag ? `${prevTag}..${tag}` : `${tag}`;
      const commits = humanCommits(range);
      if (commits.size === 0) continue;

      // One avatar per contributor, linked to their profile. A commit whose
      // email GitHub can't attribute to an account has no avatar to show --
      // credit the name instead rather than silently dropping the person.
      const credits = [];
      for (const { name, sha } of commits.values()) {
        const profile = await resolveGithubProfile(sha, dryRun);
        if (profile) {
          credits.push(
            `<a href="${profile.htmlUrl}" title="${profile.login}"><img src="${profile.avatarUrl}&s=64" width="32" height="32" style="border-radius:50%;vertical-align:middle;" alt="${profile.login}" /></a>`,
          );
        } else {
          credits.push(`**${name}**`);
        }
      }

      const section = [`## Contributors`, ``, credits.join(" "), ``].join("\n");

      const newBody = `${release.body ?? ""}\n\n${section}`;
      if (dryRun) {
        console.log(
          `[dry-run] ${tag}: crediting ${[...commits.values()].map((c) => c.name).join(", ")}`,
        );
        continue;
      }
      await api(`/repos/${repo}/releases/${release.id}`, "PATCH", { body: newBody });
      console.log(`Credited ${commits.size} contributor(s) on release ${tag}`);
    }
  }
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
