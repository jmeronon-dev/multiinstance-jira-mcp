# Releasing

> **Purpose:** explain how a new version of the package reaches npm, and the one-time setup that makes it possible.
> **Keep up to date:** the workflow, the npmjs.com and GitHub settings and the release steps. Review this page when `.github/workflows/publish.yml`, the `version`, `files` or `repository` fields of `package.json`, or `CHANGELOG.md` conventions change.

## How it works

The package is published to npm as [`multiinstance-jira-mcp`](https://www.npmjs.com/package/multiinstance-jira-mcp) by the workflow `🚀 Publish to npm` (`.github/workflows/publish.yml`):

1. A maintainer publishes a GitHub Release whose tag is `v<version>`, for example `v0.1.1`.
2. The workflow checks that the tag matches `version` in `package.json`, then runs `npm ci`, typecheck, tests, build and a CLI smoke test.
3. It runs `npm stage publish`. npm authenticates the workflow with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): there is no npm token in the repository, and npm adds a [provenance](https://docs.npmjs.com/generating-provenance-statements) attestation automatically.
4. The version stays in the [staging area](https://docs.npmjs.com/staged-publishing) until a maintainer approves it with 2FA. Only then is it public.

Pre-releases (GitHub Releases marked as *pre-release*) are skipped. Promoting a pre-release to a full release does not publish it either: create a new release instead. The workflow only runs in `jmeronon-dev/multiinstance-jira-mcp`, never in forks.

## One-time setup

Trusted publishing can only be configured for a package that already exists on npm, so the first version is published by hand. This was done with `0.1.1` on 2026-11-13; the steps stay here in case the package has to be bootstrapped again.

### 1. Publish the first version by hand

First prepare the version as in step 1 of [Release a new version](#release-a-new-version): `CHANGELOG.md` must have a section for the version in `package.json` that includes every `[Unreleased]` entry, because all of them ship in the tarball.

Then, from an up-to-date default branch, with an npm account that has 2FA enabled, run these commands in an interactive terminal (npm opens the browser to confirm with the security key, so an agent cannot run them):

```sh
npm login
npm pack --dry-run             # review the file list
npm publish --access public    # prepublishOnly runs typecheck, test and build
git tag vx.y.z
git push origin vx.y.z
```

npm may stage this first publish too: the registry answers `202 Accepted`, creates a public placeholder version `0.0.0-stage` and keeps the real version in *Staged Packages* until it is approved with 2FA. The placeholder stays in the version list; `latest` moves to the approved version.

This version has no provenance because it was not built in CI.

### 2. Create the GitHub environment

In *Settings → Environments*, create the environment `npm`. Under *Deployment branches and tags*, choose *Selected branches and tags* and add the tag rule `v*`.

Also create a tag ruleset (*Settings → Rules → Rulesets → New tag ruleset*) that targets `v*` and restricts creation, update and deletion to maintainers, so nobody else can point a release tag at an arbitrary commit.

### 3. Add the trusted publisher on npmjs.com

In the package *Settings → Trusted Publisher*, choose GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `jmeronon-dev` |
| Repository | `multiinstance-jira-mcp` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | Stage publish only |

The same configuration from the CLI (npm 11.15.0 or later):

```sh
npm trust github multiinstance-jira-mcp --repo jmeronon-dev/multiinstance-jira-mcp --file publish.yml --env npm --allow-stage-publish
```

A new trusted publisher expires if it does not complete a successful publish within 2 days, so add it when the next release is ready.

### 4. Disallow tokens

After the first release from CI works, set the package *Settings → Publishing access* to *Require two-factor authentication and disallow tokens*.

## Release a new version

Agents follow the skill [`release-version`](../.github/skills/release-version/SKILL.md), which automates these steps and stops at the human gates (approval of the release PR, merge, creation of the GitHub Release and the 2FA approval on npm).

1. In a pull request, move the `## [Unreleased]` entries of `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section and bump the version without creating a tag:

   ```sh
   npm version patch --no-git-tag-version   # or minor / major
   ```

2. Merge the pull request.
3. In *Releases → Draft a new release*, create the tag `vx.y.z` on the merge commit and publish the release, or run `gh release create vx.y.z --target <merge-sha>`. Use a person's session: releases created by a workflow with `GITHUB_TOKEN` do not trigger other workflows.
4. Wait for `🚀 Publish to npm` to finish.
5. Approve the staged version on npmjs.com (*Staged Packages → Approve*) or with `npm stage approve <stage-id>` (npm 11.15.0 and Node.js 22.14 or later). Both ask for 2FA.
6. Check the result (`--prefer-online` skips the local npm cache; run `npx` outside the repository):

   ```sh
   npm view multiinstance-jira-mcp dist-tags --prefer-online
   npx -y multiinstance-jira-mcp@x.y.z --version
   ```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ENEEDAUTH` / unable to authenticate | The workflow filename or environment name differ from the trusted publisher (they are case-sensitive), or the job lacks `id-token: write`. |
| Provenance or repository mismatch | `repository.url` in `package.json` must match `jmeronon-dev/multiinstance-jira-mcp`. |
| `Release tag … does not match package.json version` | The version bump was not merged before the release, or the tag has a typo. Delete the release and the tag, fix it and publish again. |
| The workflow did not run | The release is a pre-release, or it was created by a workflow with `GITHUB_TOKEN`. |
| The trusted publisher stopped working right after creating it | It expired after 2 days without a publish. Delete it and create it again. |
| `npm stage` is an unknown command | Update npm: `npm install -g npm@11` (11.15.0 or later, on Node.js 22.14 or later). |
| `npm view` still shows the old version | The local npm cache answered. Add `--prefer-online`. |
