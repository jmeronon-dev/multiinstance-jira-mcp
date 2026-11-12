#!/usr/bin/env bash
# Guardrails for the lights-out auto-merge. Pure: reads three JSON files and
# decides; it never calls the network.
#
#   lights-out-guard.sh PR_JSON FILES_JSON ISSUES_JSON
#
#   PR_JSON      REST object of the pull request (GET /pulls/{n})
#   FILES_JSON   flat array of REST file objects (GET /pulls/{n}/files)
#   ISSUES_JSON  array of the issues the PR closes, as GraphQL nodes:
#                { number, state, labels: { nodes: [{ name }] } }
#
# Exit 0 when the pull request is eligible. Otherwise exit 1 and print one
# reason per line to stdout. Limits come from MAX_CHANGED_LINES (default 150)
# and MAX_CHANGED_FILES (default 10); GITHUB_REPOSITORY is the base repository
# and BASE_BRANCH (default develop) the only branch PRs may target.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 PR_JSON FILES_JSON ISSUES_JSON" >&2
  exit 2
fi

reasons="$(jq -rn \
  --slurpfile pr "$1" \
  --slurpfile files "$2" \
  --slurpfile issues "$3" \
  --arg repo "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}" \
  --arg base "${BASE_BRANCH:-develop}" \
  --argjson maxLines "${MAX_CHANGED_LINES:-150}" \
  --argjson maxFiles "${MAX_CHANGED_FILES:-10}" '
  $pr[0] as $p
  | $files[0] as $f
  | $issues[0] as $i
  | ($f | map(.filename, (.previous_filename // empty))) as $paths
  | ($f | map((.additions // 0) + (.deletions // 0)) | add // 0) as $lines
  | (
      if ($p.state != "open") then "the pull request is not open" else empty end,
      if (($p.user.login // "") != "Copilot" or ($p.user.type // "") != "Bot")
        then "the author is not the Copilot cloud agent" else empty end,
      if (($p.head.repo.full_name // "") != $repo)
        then "the branch does not come from this repository" else empty end,
      if ($p.base.ref != $base) then "the pull request does not target \($base)" else empty end,
      if ($i | length) == 0 then "no linked Issue" else empty end,
      ($i[] | select(.state != "OPEN") | "Issue #\(.number) is not open"),
      ($i[] | select((.labels.nodes | map(.name) | index("🌙 lights-out")) == null)
        | "Issue #\(.number) is not 🌙 lights-out"),
      ($i[] | select((.labels.nodes | map(.name) | index("🏭 software-factory")) != null)
        | "Issue #\(.number) is 🏭 software-factory"),
      if ($f | length) == 0 then "the pull request has no changed files" else empty end,
      if ($f | length) > $maxFiles then "it changes \($f | length) files (limit \($maxFiles))" else empty end,
      if $lines > $maxLines then "it changes \($lines) lines (limit \($maxLines))" else empty end,
      ($paths | unique[]
        | select(
            startswith(".github/") or startswith(".vscode/") or startswith("src/auth/")
            or . == "AGENTS.md" or . == "package.json" or . == "package-lock.json"
            or . == ".npmrc"
          )
        | "protected path: \(.)")
    )')"

if [ -n "$reasons" ]; then
  echo "$reasons"
  exit 1
fi
