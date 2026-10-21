// The Pages workflow's steps that need GitHub, as docs/versions.md describes:
//
//   node scripts/docs.ts resolve          choose what to deploy, from EVENT
//                                         (push, release, or dispatch) and
//                                         REF, and write it to GITHUB_OUTPUT
//   node scripts/docs.ts verify <url> <commit>
//                                         read the deployed site back until it
//                                         is <commit>, then check every page
//
// It reads GitHub's API with the token in GH_TOKEN, if set, for the
// repository in GITHUB_REPOSITORY, by default viell-dev/slop-inkline.

import { appendFile } from "node:fs/promises";
import { docsBranch, docsSource, type DocsRequest } from "./lib/docs.ts";
import { isRecord } from "./lib/settings.ts";

const repository = process.env.GITHUB_REPOSITORY ?? "viell-dev/slop-inkline";
const token = process.env.GH_TOKEN;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function api(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) fail(`GET ${path}: ${String(response.status)}`);
  return response.json();
}

/** The published releases' tags, newest first. */
async function releases(): Promise<string[]> {
  const listed = await api(`repos/${repository}/releases?per_page=100`);
  if (!Array.isArray(listed)) fail("the releases are not a list");
  return listed
    .flatMap((release) =>
      isRecord(release) &&
      release.draft === false &&
      typeof release.tag_name === "string" &&
      typeof release.published_at === "string"
        ? [{ tag: release.tag_name, at: Date.parse(release.published_at) }]
        : [],
    )
    .sort((a, b) => b.at - a.at)
    .map((release) => release.tag);
}

/** Whether the Release run behind a `release` event published anything. */
async function published(jobsUrl: string): Promise<boolean> {
  const response = await api(
    jobsUrl.replace(/^https:\/\/api\.github\.com\//, ""),
  );
  const jobs = isRecord(response) ? response.jobs : undefined;
  return (
    Array.isArray(jobs) &&
    jobs.some(
      (job) =>
        isRecord(job) && job.name === "publish" && job.conclusion === "success",
    )
  );
}

async function resolve(): Promise<void> {
  const event = process.env.EVENT;
  if (event !== "push" && event !== "release" && event !== "dispatch") {
    fail(`EVENT is ${String(event)}, not push, release, or dispatch`);
  }
  const tags = await releases();
  let ref = process.env.REF ?? "main";
  if (event === "release") {
    const jobs = process.env.RELEASE_JOBS_URL ?? "";
    if (jobs === "" || !(await published(jobs))) {
      console.log("The Release run published nothing; the site stays as it is.");
      await output({ deploy: "false" });
      return;
    }
    ref = tags[0] ?? "";
  }
  const request: DocsRequest = { event, ref, releases: tags };
  const latest = tags[0];
  let branch: DocsRequest["branch"];
  if (latest !== undefined && ref === docsBranch(latest)) {
    const compared = await api(
      `repos/${repository}/compare/${encodeURIComponent(latest)}...${encodeURIComponent(ref)}`,
    );
    if (!isRecord(compared)) fail("the comparison is not an object");
    const files = Array.isArray(compared.files) ? compared.files : [];
    branch = {
      containsTag: compared.behind_by === 0,
      changed: files.flatMap((file) =>
        isRecord(file) && typeof file.filename === "string"
          ? [file.filename]
          : [],
      ),
    };
  }
  const source = docsSource({
    ...request,
    ...(branch === undefined ? {} : { branch }),
  });
  if (!source.deploy) {
    console.log(source.reason);
    await output({ deploy: "false" });
    if (source.error) process.exit(1);
    return;
  }
  console.log(`Deploying ${source.ref}, which describes ${source.version}.`);
  await output({ deploy: "true", ref: source.ref, version: source.version });
}

async function output(values: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  if (file === undefined) process.stdout.write(lines);
  else await appendFile(file, lines);
}

/** Reads `url` until it answers, or for about five minutes. */
async function read(url: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache" },
    }).catch(() => undefined);
    if (response?.ok === true) return response.text();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return undefined;
}

async function verify(site: string, commit: string): Promise<void> {
  const base = site.endsWith("/") ? site : `${site}/`;
  // Pages can serve the previous deployment for a while.
  let deployed: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    const text = await read(`${base}version.json?${String(attempt)}`);
    deployed = text === undefined ? undefined : JSON.parse(text);
    if (isRecord(deployed) && deployed.commit === commit) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!isRecord(deployed) || deployed.commit !== commit) {
    fail(`${base}version.json does not name ${commit}`);
  }
  const sitemap = await read(`${base}sitemap.xml`);
  if (sitemap === undefined) fail(`${base}sitemap.xml does not answer`);
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1] ?? "",
  );
  if (pages.length === 0) fail("the sitemap lists no pages");
  const problems: string[] = [];
  for (const page of pages) {
    const html = await read(page);
    if (html === undefined) problems.push(`${page} does not answer`);
    else if (!html.includes(`content="${commit}"`)) {
      problems.push(`${page} is not from ${commit}`);
    }
  }
  if (problems.length > 0) fail(problems.join("\n"));
  console.log(
    `${base} serves ${commit}, which describes ${String(deployed.version)}, on all ${String(pages.length)} pages.`,
  );
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "resolve":
    await resolve();
    break;
  case "verify": {
    const [site, commit] = rest;
    if (site === undefined || commit === undefined) {
      fail("usage: docs.ts verify <url> <commit>");
    }
    await verify(site, commit);
    break;
  }
  default:
    fail("usage: docs.ts resolve | verify <url> <commit>");
}
