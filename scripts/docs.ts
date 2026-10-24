// The Pages workflow's steps that need GitHub, as docs/versions.md describes:
//
//   node scripts/docs.ts resolve          choose whether to deploy, from EVENT
//                                         (push or dispatch) and REF, the
//                                         run's own branch or tag, and write
//                                         it to GITHUB_OUTPUT
//   node scripts/docs.ts verify <url> <commit>
//                                         read the deployed site back until it
//                                         is <commit>, then check every page
//
// It reads GitHub's API with the token in GH_TOKEN, if set, for the
// repository in GITHUB_REPOSITORY, by default viell-dev/slop-inkline.

import { appendFile, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  docsBranch,
  docsSource,
  isRecord,
  type DocsRequest,
} from "./lib/docs.ts";

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

async function resolve(): Promise<void> {
  const event = process.env.EVENT;
  if (event !== "push" && event !== "dispatch") {
    fail(`EVENT is ${String(event)}, not push or dispatch`);
  }
  const tags = await releases();
  // The ref this run is on, and builds.
  const ref = process.env.REF ?? "main";
  const refType = process.env.REF_TYPE;
  if (refType !== "branch" && refType !== "tag") {
    fail(`REF_TYPE is ${String(refType)}, not branch or tag`);
  }
  const manifest: unknown = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  );
  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    fail("the manifest has no version");
  }
  const request: DocsRequest = {
    event,
    ref,
    refType,
    releases: tags,
    version: manifest.version,
  };
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

/**
 * How long the deployment may take to show: Pages' cache serves a page for
 * up to ten minutes, and each address below asks past it with a query.
 */
const deadline = Date.now() + 12 * 60_000;

/**
 * Reads `url` until `fresh` accepts what it says, or the deadline passes;
 * each attempt asks with a query of its own, so that Pages' cache cannot
 * answer with what an earlier deployment left. The last text read, or
 * undefined if none ever answered.
 */
async function readFresh(
  url: string,
  fresh: (text: string) => boolean,
): Promise<string | undefined> {
  let last: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}v=${String(attempt)}`, {
      headers: { "cache-control": "no-cache" },
    }).catch(() => undefined);
    if (response?.ok === true) {
      last = await response.text();
      if (fresh(last)) return last;
    }
    if (Date.now() > deadline) return last;
    await sleep(10_000);
  }
}

async function verify(site: string, commit: string): Promise<void> {
  const base = site.endsWith("/") ? site : `${site}/`;
  const names = (text: string): unknown => {
    try {
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const version = await readFresh(`${base}version.json`, (text) => {
    const parsed = names(text);
    return isRecord(parsed) && parsed.commit === commit;
  });
  const deployed = version === undefined ? undefined : names(version);
  if (!isRecord(deployed) || deployed.commit !== commit) {
    fail(`${base}version.json does not name ${commit} after 12 minutes`);
  }
  const sitemap = await readFresh(`${base}sitemap.xml`, (text) =>
    text.includes("<loc>"),
  );
  if (sitemap === undefined) fail(`${base}sitemap.xml does not answer`);
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1] ?? "",
  );
  if (pages.length === 0) fail("the sitemap lists no pages");
  const problems: string[] = [];
  const built = `content="${commit}"`;
  for (const page of pages) {
    const html = await readFresh(page, (text) => text.includes(built));
    if (html === undefined) problems.push(`${page} does not answer`);
    else if (!html.includes(built)) {
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
