---
name: release-version
description: "Release a new version of the npm package: SemVer bump from CHANGELOG.md, release PR, GitHub Release that triggers `🚀 Publish to npm`, 2FA approval hand-off and npm verification. USE FOR: release, publish or bump a version. DO NOT USE FOR: the one-time npm setup, changing publish.yml or pre-releases."
---

# Release a version

> Commands, version rules and recovery: [procedure](references/procedure.md). Background: `docs/releasing.md`.

## Steps

1. **Preflight**: clean, up-to-date default branch, CI green, `gh` logged in, `[Unreleased]` not empty, npm `latest` equal to `package.json`. Stop on any failure.
2. **Version**: propose `x.y.z` with the SemVer table and wait for confirmation.
3. **Issue**: reuse or create `🚀 Release vx.y.z` with `🚀 ci-release`.
4. **Release PR**: branch `chore/<issue>-release-x.y.z`; move `[Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, update compare links, `npm version x.y.z --no-git-tag-version`, run the checks. Show the diff and wait for approval before commit, push and PR.
5. **Merge**: a person merges it.
6. **GitHub Release**: with confirmation, `gh release create vx.y.z` on the merge commit, notes from the CHANGELOG.
7. **Workflow**: watch `🚀 Publish to npm`; on failure use the recovery table.
8. **Approval**: the maintainer approves the staged version on npmjs.com with 2FA.
9. **Verify**: `latest` is `x.y.z` with provenance and `npx` prints it; close the Issue.

## Limits

- Never run `npm publish`, `npm stage approve` or `npm trust`; never ask for or store OTPs, tokens or passwords.
- Never push to the default branch, merge or force-push. Never move or delete a tag without confirmation.
- Published versions are immutable: fix forward with a new patch.
- Do not change `publish.yml` or npm settings during a release.
