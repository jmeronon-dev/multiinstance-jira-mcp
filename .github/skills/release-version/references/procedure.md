# Procedure: release a version

Part of `release-version`. `docs/releasing.md` and `.github/workflows/publish.yml` are the source of truth: when this page disagrees with them, follow them and propose a fix to this page.

Repository: `jmeronon-dev/multiinstance-jira-mcp`. Package: `multiinstance-jira-mcp`. Read the default branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` (today `develop`).

## 1. Preflight

Run and check every item; stop and report the first failure:

| Check | Command | Expected |
|---|---|---|
| Clean working tree | `git status --short` | No output |
| Up-to-date default branch | `git switch <default> && git pull --ff-only` | Fast-forward or up to date |
| GitHub CLI | `gh auth status` | Logged in as a person who can create releases (contents: write) |
| CI on the default branch | `gh run list --branch <default> --workflow ci.yml --limit 1` | Last run `success` |
| Something to release | Read `## [Unreleased]` in `CHANGELOG.md` | At least one entry |
| Current versions | `node -p 'require("./package.json").version'` and `npm view multiinstance-jira-mcp version --prefer-online` | Both equal: the last release is fully published |
| No pending stage | Ask the user, or `npm stage list multiinstance-jira-mcp` (npm 11.15.0 and Node.js 22.14 or later, needs their login) | Nothing staged |
| Trusted publisher | Ask the user. If it is not configured, ask the maintainer to complete steps 2 and 3 of *One-time setup* in `docs/releasing.md` right before the GitHub Release (step 5 here; it expires after 2 days without a publish) and wait for confirmation. `gh api repos/jmeronon-dev/multiinstance-jira-mcp/environments/npm` checks the environment | Configured |

## 2. Choose the version

Read the categories under `[Unreleased]` and propose a version. The user confirms it.

| Change in `[Unreleased]` | From `>= 1.0.0` | From `0.y.z` |
|---|---|---|
| Breaking change: removed or renamed tool, argument, output field, flag or environment variable; Node.js minimum raised (see the `Changed` rules in `AGENTS.md`) | major | minor |
| `Added`, `Deprecated` or compatible `Changed` user-visible behaviour (tools, flags, options) | minor | patch |
| Only `Fixed`, `Security`, internal or documentation changes | patch | patch |

Moving to `1.0.0` is a maintainer decision: never propose it on your own. The version must be greater than the npm `latest` and must never have been used before, not even as a staged or unpublished version (`npm view multiinstance-jira-mcp versions --json`).

## 3. Tracking Issue

Search first: `gh issue list --search "Release vx.y.z in:title" --state all`. If there is none, create one:

```sh
gh issue create --title "🚀 Release vx.y.z" --label "🚀 ci-release" \
  --body "Release x.y.z of multiinstance-jira-mcp. Changes: see [Unreleased] in CHANGELOG.md."
```

## 4. Release PR

```sh
git switch -c chore/<issue>-release-x.y.z
```

1. In `CHANGELOG.md`:
   - Move every entry under `## [Unreleased]` into a new `## [x.y.z] - YYYY-MM-DD` section (today's date, UTC) and leave `## [Unreleased]` empty above it.
   - Update the link references at the bottom (keep the older ones):

     ```text
     [Unreleased]: https://github.com/jmeronon-dev/multiinstance-jira-mcp/compare/vx.y.z...HEAD
     [x.y.z]: https://github.com/jmeronon-dev/multiinstance-jira-mcp/compare/v<previous>...vx.y.z
     ```

2. `npm version x.y.z --no-git-tag-version` (updates `package.json` and `package-lock.json`, no commit and no tag).
3. Checks, all green:

   ```sh
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
   npm run typecheck && npm test && npm run build
   node dist/index.js --version          # prints x.y.z
   npm run docs:lint && npm run docs:links
   npm pack --dry-run                    # only dist/, examples/, README, CHANGELOG, LICENSE, package.json; no .map, no src/
   ```

4. Show the diff (three files) and wait for explicit approval.
5. Commit `chore(release): x.y.z (#<issue>)`, push, and open the PR against the default branch with title `chore(release): x.y.z`, `Refs #<issue>` in the body and `--label "🚀 ci-release"`. Report the PR URL and its checks.
6. `package.json` has a code owner, so a person reviews and merges. If the PR was opened with the maintainer's own `gh` session, they are its author and cannot approve it: they merge with the ruleset bypass, or someone else opens or approves it.

## 5. GitHub Release

After the PR is merged, and only with explicit confirmation:

```sh
git switch <default> && git pull --ff-only
sha=$(gh pr view <pr> --json mergeCommit --jq .mergeCommit.oid)
test "$sha" = "$(git rev-parse HEAD)" || echo "STOP: other commits landed after the release PR"
git show "$sha:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'   # must print x.y.z
notes=$(mktemp)
awk '/^## \[x\.y\.z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > "$notes"
gh release create vx.y.z --target "$sha" --title "vx.y.z" --notes-file "$notes"
```

If other commits landed after the release PR, stop and ask: the tag must point to the merge commit so that the package matches its CHANGELOG section. Never mark the release as pre-release: the workflow skips pre-releases. Create it with the user's `gh` session: a release created by a workflow with `GITHUB_TOKEN` does not trigger `🚀 Publish to npm`.

## 6. Follow the workflow

For release events the run's branch is the tag. The run can take a few seconds to appear; retry until it does:

```sh
gh run list --workflow publish.yml --event release --branch vx.y.z --limit 1
gh run watch <run-id> --exit-status
```

When it succeeds, the version is staged, not public.

## 7. Approval (human)

Ask the maintainer to open npmjs.com → avatar → **Staged Packages**, check `multiinstance-jira-mcp@x.y.z`, and click **Approve** with 2FA (or run `npm stage approve <stage-id>` with npm 11.15.0 and Node.js 22.14 or later). Wait for them to confirm.

## 8. Verify and close

```sh
npm view multiinstance-jira-mcp dist-tags --prefer-online                 # latest: x.y.z
npm view multiinstance-jira-mcp@x.y.z dist.attestations --prefer-online   # provenance present
npx -y multiinstance-jira-mcp@x.y.z --version                             # x.y.z (run outside the repo)
```

Close the tracking Issue with the npm link, the release link and the workflow run. After the first release published from CI, remind the maintainer of step 4 of *One-time setup* (*Disallow tokens*).

## Recovery

| Symptom | Action |
|---|---|
| `Release tag … does not match package.json version` | Nothing was published. With confirmation, `gh release delete vx.y.z --cleanup-tag --yes`, fix the version through a PR and create the release again. |
| `ENEEDAUTH` or OIDC error in `📤 Stage publish` | Trusted publisher missing, expired or with a different workflow file or environment. The maintainer fixes it on npmjs.com (`docs/releasing.md`); then re-run the failed job with `gh run rerun <run-id> --failed`. |
| Typecheck, tests or build fail in the workflow | Nothing was published. Delete the release and tag (with confirmation), fix through a normal PR, and release the same version again. |
| `You cannot publish over the previously published versions` | That number is taken. Prepare a new patch release. |
| Staged version is wrong | The maintainer rejects it on npmjs.com. Fix through a PR and release a new patch version. |
| The workflow did not start | The release is a pre-release, was created with a workflow `GITHUB_TOKEN`, or `publish.yml` is missing at the tagged commit. |
| A bad version is already public | Do not unpublish. Release a fixed patch version; if needed, the maintainer runs `npm deprecate multiinstance-jira-mcp@x.y.z "<reason>"`. |
