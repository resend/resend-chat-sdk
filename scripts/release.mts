// Adapted from https://github.com/resend/react-email/blob/canary/scripts/release.mts
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getIDToken, warning } from "@actions/core";
import { type ExecOutput, exec, getExecOutput } from "@actions/exec";
import { context, getOctokit } from "@actions/github";
import { readPreState } from "@changesets/pre";
import { toString as mdastToString } from "mdast-util-to-string";
import { remark } from "remark";

const octokit = getOctokit(process.env.GITHUB_TOKEN || "placeholder");
const processor = remark();

export function getChangelogEntry(changelog: string, version: string) {
  const ast = processor.parse(changelog);

  const nodes = ast.children;
  let headingStartInfo: { index: number; depth: number } | undefined;
  let endIndex: number | undefined;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "heading") {
      const stringified: string = mdastToString(node);
      if (headingStartInfo === undefined && stringified === version) {
        headingStartInfo = { index: i, depth: node.depth };
        continue;
      }
      if (
        endIndex === undefined &&
        headingStartInfo !== undefined &&
        headingStartInfo.depth === node.depth
      ) {
        endIndex = i;
        break;
      }
    }
  }
  if (headingStartInfo) {
    ast.children = ast.children.slice(headingStartInfo.index + 1, endIndex);
  }
  return processor.stringify(ast);
}

const releaseAlreadyExists = async (tagName: string) => {
  try {
    await octokit.rest.repos.getReleaseByTag({
      ...context.repo,
      tag: tagName,
    });
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: number }).status === 404
    ) {
      return false;
    }
    throw error;
  }
};

const ensureGithubRelease = async ({
  name,
  version,
}: {
  name: string;
  version: string;
}) => {
  const tagName = `${name}@${version}`;

  await octokit.rest.git
    .createRef({
      ...context.repo,
      ref: `refs/tags/${tagName}`,
      sha: context.sha,
    })
    .catch((error: unknown) => {
      warning(`Failed to create tag ${tagName}: ${error}`);
    });

  if (await releaseAlreadyExists(tagName)) {
    console.log(`Release for ${tagName} already exists, skipping`);
    return;
  }

  const changelog = await fs.readFile("CHANGELOG.md", "utf8");
  const changelogEntry = getChangelogEntry(changelog, version);
  const isPrerelease = version.includes("-");

  console.log(`Creating release for ${tagName}`);
  await octokit.rest.repos.createRelease({
    name: tagName,
    tag_name: tagName,
    body: changelogEntry,
    prerelease: isPrerelease,
    make_latest: isPrerelease ? "false" : "true",
    ...context.repo,
  });
};

const TRUTHY_ENV_RE = /^(1|true|yes)$/i;
const isTruthyEnv = (value: string | undefined) =>
  value !== undefined && TRUTHY_ENV_RE.test(value);

const NPM_404_RE =
  /\bE404\b|404 Not Found|is not in (?:this|the npm) registry/i;

/**
 * Parses the output of `npm view <pkg> versions --json`. A missing package
 * (npm 404) means nothing is published yet, so we return an empty list. Any
 * other failure is re-thrown — a flaky registry must never be mistaken for an
 * unpublished package, which would make us republish or mis-tag.
 */
export function parseNpmVersions(
  packageName: string,
  result: Pick<ExecOutput, "exitCode" | "stdout" | "stderr">
): string[] {
  if (result.exitCode === 0) {
    const stdout = result.stdout.trim();
    if (stdout.length === 0) {
      return [];
    }
    const parsed = JSON.parse(stdout) as string | string[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const output = `${result.stderr}\n${result.stdout}`;
  if (NPM_404_RE.test(output)) {
    return [];
  }

  throw new Error(
    `Failed to read published versions for ${packageName}: ${
      result.stderr.trim() || `npm exited with code ${result.exitCode}`
    }`
  );
}

const getPublishedVersions = async (packageName: string): Promise<string[]> => {
  const result = await getExecOutput(
    "npm",
    ["view", packageName, "versions", "--json"],
    { ignoreReturnCode: true, silent: true }
  );
  return parseNpmVersions(packageName, result);
};

const prereleaseTagOf = (version: string): string | undefined =>
  version.split("-")[1]?.split(".")[0];

/**
 * The npm dist-tag for a version, taken from the version itself: a plain
 * `x.y.z` release goes to `latest`, while a prerelease goes to its prerelease
 * identifier (`0.2.0-canary.2` -> `canary`). This guarantees a prerelease
 * never overwrites `latest`.
 */
export function selectDistTag(version: string): string {
  return prereleaseTagOf(version) ?? "latest";
}

const publish = async (distTag: string, env: Record<string, string>) => {
  await exec(
    "pnpm",
    [
      "publish",
      "--no-git-checks",
      "--access",
      "public",
      "--provenance",
      "--tag",
      distTag,
    ],
    { env }
  );
};

/**
 * Canary only auto-releases while in changesets prerelease mode (`canary:enter`);
 * main always releases. Returns false when canary is out of prerelease mode, so
 * the caller can skip publishing instead of erroring.
 */
const shouldReleaseForRef = async (ref: string): Promise<boolean> => {
  if (ref === "refs/heads/canary") {
    console.log("Detected canary branch, checking prerelease state");
    const preState = await readPreState(process.cwd());
    if (preState?.mode !== "pre") {
      console.log(
        "Was not in prerelease, skipping automated release. To release this you should rebase onto main"
      );
      return false;
    }
    console.log("Is in prerelease mode, proceeding with automated release");
    return true;
  }
  if (ref === "refs/heads/main") {
    console.log("Detected main branch, proceeding with stable release");
    return true;
  }
  throw new Error(
    `Unexpected branch/ref: ${ref}. Expected refs/heads/main or refs/heads/canary`
  );
};

const main = async () => {
  const isDryRun = process.argv.includes("--dry-run");
  const skipNpmPublish =
    isTruthyEnv(process.env.SKIP_NPM_PUBLISH) ||
    process.argv.includes("--skip-npm-publish") ||
    process.argv.includes("--only-github-releases");

  if (!(isDryRun || (context.repo.owner && context.repo.repo))) {
    throw new Error(
      "GitHub context is missing. This script must be run in a GitHub Actions workflow."
    );
  }

  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
  const { name, version } = packageJson;

  const gatingApplies = !(isDryRun || skipNpmPublish);
  if (gatingApplies && !(await shouldReleaseForRef(context.ref))) {
    return;
  }

  let didPublish = false;

  if (skipNpmPublish) {
    console.log(
      "SKIP_NPM_PUBLISH is set, skipping npm publish and only ensuring the GitHub release exists"
    );
    didPublish = true;
  } else {
    const publishedVersions = await getPublishedVersions(name);
    if (publishedVersions.includes(version)) {
      console.log(`${name}@${version} is already published, skipping`);
      return;
    }

    const distTag = selectDistTag(version);
    console.log(`Publishing ${name}@${version} -> ${distTag}`);

    if (isDryRun) {
      return;
    }

    await exec("pnpm", ["release:build"]);

    // https://docs.npmjs.com/generating-provenance-statements#publishing-packages-with-provenance-via-github-actions
    const npmIdToken = await getIDToken("npm:registry.npmjs.org");
    const publishEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NPM_ID_TOKEN: npmIdToken,
    };

    await publish(distTag, publishEnv);
    console.log(`Published ${name}@${version}`);
    didPublish = true;
  }

  if (didPublish) {
    await ensureGithubRelease({ name, version });
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
