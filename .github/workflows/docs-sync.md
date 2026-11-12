---
name: "📚 Docs sync"
description: Keeps docs/ and README.md in sync with the code after each change on the default branch.

on:
  push:
    branches: [develop, main]
    paths:
      - "src/**"
      - "package.json"
      - ".github/workflows/**"
      - ".github/skills/**"
      - "AGENTS.md"
  # Reconciliation: a push skipped by skip-if-match while a docs PR was open is picked up daily.
  schedule: daily
  workflow_dispatch:
  permissions:
    # Required by the skip-if-match search on private repositories.
    pull-requests: read
  # Skip when a previous docs sync PR is still open, so runs never stack.
  skip-if-match: 'is:pr is:open label:"🌙 lights-out" in:title "docs:"'

jobs:
  # Runs outside the agent, after the pull request exists, and only touches that pull request.
  auto-merge:
    name: 🔀 Enable auto-merge
    needs: [agent, safe_outputs]
    if: ${{ always() && needs.agent.result == 'success' && needs.safe_outputs.outputs.created_pr_number != '' }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: 🔍 Verify that the pull request only touches documentation
        id: verify
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ needs.safe_outputs.outputs.created_pr_number }}
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
        shell: bash
        run: |
          set -euo pipefail
          pr=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")
          draft=$(jq -r '.draft' <<< "$pr")
          head_repo=$(jq -r '.head.repo.full_name' <<< "$pr")
          base=$(jq -r '.base.ref' <<< "$pr")
          if [ "$draft" != false ] || [ "$head_repo" != "$GITHUB_REPOSITORY" ] || [ "$base" != "$DEFAULT_BRANCH" ]; then
            echo "::warning::PR #$PR_NUMBER is a draft, comes from a fork or does not target $DEFAULT_BRANCH; auto-merge not enabled."
            echo "eligible=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          # Every changed path (including the previous name of a renamed file) must be docs/ or README.md.
          files=$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/files?per_page=100" \
            --jq '.[] | .filename, (.previous_filename // empty)')
          if [ -z "$files" ]; then
            echo "::warning::PR #$PR_NUMBER has no changed files; auto-merge not enabled."
            echo "eligible=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          while IFS= read -r file; do
            case "$file" in
              docs/* | README.md) ;;
              *)
                echo "::warning::PR #$PR_NUMBER touches $file outside docs/ and README.md; auto-merge not enabled."
                echo "eligible=false" >> "$GITHUB_OUTPUT"
                exit 0
                ;;
            esac
          done <<< "$files"
          echo "eligible=true" >> "$GITHUB_OUTPUT"

      - name: 🔀 Enable auto-merge (squash)
        if: ${{ steps.verify.outputs.eligible == 'true' }}
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ needs.safe_outputs.outputs.created_pr_number }}
        shell: bash
        run: |
          gh pr merge "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --auto --squash
          echo "✅ Auto-merge enabled on PR #$PR_NUMBER" >> "$GITHUB_STEP_SUMMARY"

permissions:
  contents: read
  copilot-requests: write

engine: copilot

# The agent runs behind a firewall: the npm registry is allowed so it can run markdownlint
# itself, but the .github/hooks checks are skipped there (they exit when GITHUB_AW is set).
network:
  allowed:
    - defaults
    - node

# Safety net on the runner, after the agent: if the documentation does not pass the checks of
# the required "📚 docs" check, the agent job fails and auto-merge is not enabled.
post-steps:
  - name: 🟢 Set up Node.js
    uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version: 22
  - name: 📝 Lint Markdown before the pull request
    shell: bash
    run: npx --yes markdownlint-cli2@0.24.0
  - name: 🔗 Check relative links before the pull request
    run: node scripts/check-markdown-links.mjs

timeout-minutes: 20

tools:
  bash: ["cat", "ls", "grep", "find", "head", "tail", "wc", "diff", "npx --yes markdownlint-cli2@0.24.0", "node scripts/check-markdown-links.mjs", "git log", "git diff", "git show", "git status"]
  edit:

safe-outputs:
  create-pull-request:
    title-prefix: "docs: "
    labels: ["📝 documentation", "🌙 lights-out"]
    draft: false
    max: 1
    if-no-changes: ignore
    fallback-as-issue: false
    # The default GITHUB_TOKEN cannot trigger the required pull_request checks.
    github-token: ${{ secrets.DOCS_SYNC_PR_TOKEN }}
    allowed-files:
      - "docs/**"
      - "README.md"
    protected-files:
      policy: blocked
      exclude:
        - /README.md
---

# 📚 Docs sync

You keep the documentation of this repository in sync with its code. The repository is an MCP server for Jira (TypeScript, Node.js 20+, stdio) that connects to several Jira Cloud and Data Center sites at once. Its `docs/` folder is a wiki and `README.md` is the user-facing entry point.

## Scope

- You may only create or modify files under `docs/` and the root `README.md`. Any other path is refused by the pipeline.
- Never modify `AGENTS.md`, `CHANGELOG.md`, `.github/`, source code, tests or configuration.
- Write all documentation in English, matching the tone and structure of the existing pages. Keep code identifiers, commands, flags, environment variables and file names unchanged.
- Do not rewrite pages that are already accurate. Prefer small, precise edits over large rewrites.

## Method

1. Read `docs/index.md`, then every page it lists. Each page starts with a note describing its purpose and what must be kept up to date; follow it.
2. Compare each statement with the code as it is now: `src/`, `package.json`, `examples/`, `.github/workflows/`, `.github/skills/` and `AGENTS.md`. When documentation and code disagree, the code is right.
3. Check in particular: the tool list and their descriptions (`src/tools/*.ts`) against the README tables, CLI flags and environment variables (`src/cli.ts`, `src/config/`), routing rules (`src/instances/registry.ts`), workflows and checks named in the docs, the skills, and that every page of `docs/` appears in the index.
4. Relative links and images must keep working, and Markdown must pass `markdownlint` (`.markdownlint-cli2.jsonc`). Before opening the pull request, run `npx --yes markdownlint-cli2@0.24.0` and `node scripts/check-markdown-links.mjs` and fix every problem they report: these are the same checks as the required `📚 docs` check, and a pull request that fails them cannot be merged.
5. If you find nothing that needs updating, do not create a pull request: call `noop` with a short reason.

## Pull request

When something needs updating, make the edits in the working tree and open one pull request. Write the title (after the `docs: ` prefix) and the body in English. The body lists the pages changed and, for each, the code fact that justified the change. Do not mention internal tooling details. Do not add closing keywords for issues.
