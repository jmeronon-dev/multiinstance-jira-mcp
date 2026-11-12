Read `AGENTS.md` first: it is the source of the working rules of this repository. This file only adds the conventions that apply to `.github/`.

## GitHub Actions conventions

- Every workflow in `.github/workflows/` starts its `name:`, the `name:` of each job and the `name:` of each step with an emoji. Job ids are never renamed; the job name is the check context, so renaming it means updating the required checks of the ruleset (`🧪 validate` in `ci.yml`, `📚 docs` in `docs.yml`).
- Actions are pinned to a full commit SHA with the version in a comment (`uses: actions/checkout@<sha> # v7.0.1`). Resolve the SHA with `git ls-remote` against the real tag; Dependabot keeps the SHAs up to date.
- Least privilege: declare `permissions:` at workflow level, never expose secrets to code from a pull request, and use `pull_request_target` only in workflows that never check out or run PR code.
- Agentic workflows (`*.md` with a `*.lock.yml`) are edited in the `.md` file and recompiled with `gh aw compile <name>`; never edit a `.lock.yml` by hand. Commit both files together.

## Software factory

- Labels are declared in `.github/labels.yml`; Issue templates, skills and workflows may only use labels declared there.
- Changes to `.github/` are 🏭 software-factory changes: they are never 🌙 lights-out and always need a human review.
