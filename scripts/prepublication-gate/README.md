# prepublication-gate

`prepublication-gate` checks this repository before it is made public, and again in CI. Its diagnostics name locations,
never matched values or deny-list patterns.

```sh
go run ./scripts/prepublication-gate [-root .] [-legs deny,gitleaks,licenses,fonts,corpus]
go run ./scripts/prepublication-gate -scope OWNER/NAME [-root .]
```

## Legs

| Leg        | Rule                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deny`     | No line of the tree (tracked and untracked-but-not-ignored files; outside git, every file except `.git` and build output) and no line of `git log -p --all` (diffs, messages, author and committer) contains a `DENY_PATTERNS` pattern, compared case-insensitively. Paths listed in `allowlist.txt` are skipped; only `corpus/A/` paths may be listed, each by developer ruling. |
| `gitleaks` | `gitleaks git --log-opts=--all` (outside git, `gitleaks dir`) reports nothing beyond the reviewed false positives that `.gitleaks.toml` allowlists by path and match.                                                                                                                                                                                                             |
| `licenses` | `go-licenses check ./...` finds only notice, permissive or unencumbered licenses. `license-checker --production` over the installed `viewer/node_modules` finds only permissive SPDX licenses, except the packages excluded by name in `licenses.go`, each with its reason. The viewer's own `package.json` license must be permissive.                                           |
| `fonts`    | Every font file under `viewer/` has a `<prefix>.OFL.txt` beside it, where `<prefix>` is a leading run of the font's dash-separated name, and that file is the SIL Open Font License.                                                                                                                                                                                              |
| `corpus`   | Once `corpus/` exists, `scripts/corpus-gate` passes on it (its checks include the PII grep). Before then the leg prints `skipped: no corpus/`.                                                                                                                                                                                                                                    |

`DENY_PATTERNS` holds one literal per line; blank lines and `#` lines are ignored. The patterns are never committed
here: CI supplies them from an Actions secret. When the variable is unset or empty the `deny` leg fails, except on a
fork `pull_request` (GitHub passes no secrets to forks), where it prints `skipped: DENY_PATTERNS unset` and passes; the
push to `main` reruns it.

The `licenses` leg needs `go-licenses` on `PATH` and `npm ci` already run in `viewer/`; it fetches `license-checker`
with `npx`. The `gitleaks` leg needs `gitleaks` on `PATH`.

## Gate scope

`-scope OWNER/NAME` runs in a fresh clone whose `origin` is that repository, with `gh` authenticated. Before the legs
run it collects, with full pagination:

1. **Git objects and ref names.** Every branch, tag and `refs/pull/*/head`, and every `before` SHA of a `force_push` or
   `branch_deletion` in the repository activity, fetched into `refs/prepub/` so the history scans reach them. A `before`
   SHA that cannot be fetched is a blocking finding. Every ref name from `git ls-remote`, every activity `ref` (deleted
   refs included) and every PR head branch name.
2. **Issue, PR and comment text.** Every issue and PR title and body, PR review, issue comment, inline review comment
   and commit comment; every prior revision of each (GraphQL `userContentEdits`); every old and new title from `renamed`
   events.
3. **Actions runs.** Not scanned: every run must already be deleted. The scope fails while `actions/runs` or
   `actions/artifacts` is not empty.

The `deny` and `gitleaks` legs scan classes 1 and 2. A text finding is located by its source, for example
`issue-comment/123 edit/2:1`; a ref name by the object it points to (`ref-to <sha>`).

Before the visibility flip, with no run in progress:

```sh
gh repo clone OWNER/NAME scope-clone && cd scope-clone
gh run list --all --limit 10000 --json databaseId -q '.[].databaseId' | xargs -n1 gh run delete
gh run list --all
gh api repos/OWNER/NAME/actions/artifacts
DENY_PATTERNS="$DENY_PATTERNS" go run ./scripts/prepublication-gate -scope OWNER/NAME
```

## Exit codes

- `0`: no finding.
- `1`: at least one finding, one stdout line each: `<leg> <location> <kind>`.
- `2`: the gate could not run (bad usage, a missing tool, `DENY_PATTERNS` unset outside a fork pull request).

## Tests

`go test ./...` covers every leg with fixtures and needs only `git`. The tests that run the real `gitleaks`,
`license-checker` and `go-licenses` carry the `prepub_e2e` build tag:

```sh
go test -tags prepub_e2e ./scripts/prepublication-gate
```
