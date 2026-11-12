#!/usr/bin/env bash
# Synthetic cases for lights-out-guard.sh. Run: bash .github/scripts/lights-out-guard.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$here/lights-out-guard.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GITHUB_REPOSITORY="jmeronon-dev/multiinstance-jira-mcp"
export BASE_BRANCH="develop"

good_pr='{"state":"open","draft":true,"user":{"login":"Copilot","type":"Bot"},"head":{"repo":{"full_name":"jmeronon-dev/multiinstance-jira-mcp"}},"base":{"ref":"develop"}}'
good_files='[{"filename":"docs/architecture.md","additions":20,"deletions":3},{"filename":"README.md","additions":5,"deletions":0}]'
good_issues='[{"number":12,"state":"OPEN","labels":{"nodes":[{"name":"🌙 lights-out"},{"name":"📝 documentation"}]}}]'

failures=0
# run NAME EXPECTED_EXIT PR FILES ISSUES [EXPECTED_REASON]
run() {
  local name="$1" expected="$2" pr="$3" files="$4" issues="$5" reason="${6:-}"
  printf '%s' "$pr" > "$tmp/pr.json"
  printf '%s' "$files" > "$tmp/files.json"
  printf '%s' "$issues" > "$tmp/issues.json"
  local out code=0
  out="$(bash "$guard" "$tmp/pr.json" "$tmp/files.json" "$tmp/issues.json")" || code=$?
  if [ "$code" -ne "$expected" ] || { [ -n "$reason" ] && ! grep -qF -- "$reason" <<<"$out"; }; then
    echo "FAIL: $name (exit $code, output: $out)"
    failures=$((failures + 1))
  else
    echo "ok:   $name"
  fi
}

run "eligible pull request" 0 "$good_pr" "$good_files" "$good_issues"
run "low-risk source file is allowed" 0 "$good_pr" '[{"filename":"src/tools/metadata.ts","additions":3,"deletions":1}]' "$good_issues"
run "touches .github/" 1 "$good_pr" '[{"filename":".github/workflows/ci.yml","additions":1,"deletions":0}]' "$good_issues" "protected path: .github/workflows/ci.yml"
run "touches src/auth/" 1 "$good_pr" '[{"filename":"src/auth/cookie-store.ts","additions":1,"deletions":0}]' "$good_issues" "protected path: src/auth/cookie-store.ts"
run "renamed from a protected path" 1 "$good_pr" '[{"filename":"docs/AGENTS.md","previous_filename":"AGENTS.md","additions":0,"deletions":0}]' "$good_issues" "protected path: AGENTS.md"
run "renamed out of src/auth/" 1 "$good_pr" '[{"filename":"src/x.ts","previous_filename":"src/auth/x.ts","additions":0,"deletions":0}]' "$good_issues" "protected path: src/auth/x.ts"
run "touches package-lock.json" 1 "$good_pr" '[{"filename":"package-lock.json","additions":1,"deletions":1}]' "$good_issues" "protected path: package-lock.json"
run "touches .npmrc" 1 "$good_pr" '[{"filename":".npmrc","additions":1,"deletions":0}]' "$good_issues" "protected path: .npmrc"
run "nested package.json is allowed" 0 "$good_pr" '[{"filename":"examples/demo/package.json","additions":1,"deletions":1}]' "$good_issues"
run "too many lines" 1 "$good_pr" '[{"filename":"docs/a.md","additions":150,"deletions":1}]' "$good_issues" "151 lines"
run "exactly at the line limit" 0 "$good_pr" '[{"filename":"docs/a.md","additions":100,"deletions":50}]' "$good_issues"
run "too many files" 1 "$good_pr" "$(jq -nc '[range(11) | {filename: "docs/f\(.).md", additions: 1, deletions: 0}]')" "$good_issues" "11 files"
run "Issue not lights-out" 1 "$good_pr" "$good_files" '[{"number":5,"state":"OPEN","labels":{"nodes":[{"name":"💡 lights-on"}]}}]' "Issue #5 is not 🌙 lights-out"
run "Issue is software-factory" 1 "$good_pr" "$good_files" '[{"number":6,"state":"OPEN","labels":{"nodes":[{"name":"🌙 lights-out"},{"name":"🏭 software-factory"}]}}]' "Issue #6 is 🏭 software-factory"
run "Issue closed" 1 "$good_pr" "$good_files" '[{"number":5,"state":"CLOSED","labels":{"nodes":[{"name":"🌙 lights-out"}]}}]' "Issue #5 is not open"
run "no linked Issue" 1 "$good_pr" "$good_files" '[]' "no linked Issue"
run "author is not Copilot" 1 "${good_pr/Copilot/someone}" "$good_files" "$good_issues" "author"
run "fork branch" 1 "${good_pr//jmeronon-dev\/multiinstance-jira-mcp/evil\/multiinstance-jira-mcp}" "$good_files" "$good_issues" "branch does not come"
run "targets another branch" 1 "${good_pr/\"develop\"/\"release\"}" "$good_files" "$good_issues" "does not target develop"
run "closed pull request" 1 "${good_pr/\"open\"/\"closed\"}" "$good_files" "$good_issues" "not open"
run "no changed files" 1 "$good_pr" '[]' "$good_issues" "no changed files"

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "All cases passed"
