# corpus-gate

`corpus-gate` checks a Published Corpus directory (the `corpus/` that `corpus-export` writes) offline. It reads no
database and calls no service except the git fetch of AxiomLib that `lake build` makes. It imports only the Go standard
library.

```sh
go run . [-report findings.json] [-lake-log lake.log] [-literals file|-] /path/to/corpus
```

## Contract

- **Input.** One argument: the corpus directory. The gate does not write into it. `lake build` runs on a temporary copy
  of `lean-toolchain`, `lakefile.lean`, `lake-manifest.json` and `A/`. A top-level `.lake/` is skipped.
- **Exit codes.**
  - `0`: no blocking finding. Review findings may exist.
  - `1`: at least one blocking finding.
  - `2`: the gate could not run (bad usage, unreadable directory, `lake` not on `PATH`, report not writable).
- **Diagnostics.** Each finding is one stdout line: `<severity> <check> <path><where> <kind>`.
  - `<severity>` is `block` or `review`.
  - `<where>` is empty, a line (`:12`), or a JSON pointer (`#/profile/bio`). A pointer segment that itself matches a PII
    pattern prints as `<key>`.
  - A diagnostic never prints the matched value or Lean source. `-lake-log` saves lake's full output for debugging.
  - The last stderr line is `corpus-gate: <n> blocking, <m> for review`.
- **Report.** `-report` writes `{"findings": [{severity, check, path, where, kind}]}`. The Corpus Export gate copies it
  into `export-report.json`.
- **Literals.** `-literals` reads a JSON array of `{kind, values, review_in_source}` from a file, or from stdin with
  `-`. The `pii` check reports each value under its `kind`. The Corpus Export gate passes display names, bios and the
  usernames of users it does not export, on stdin, so no file holds them.

## Checks

All checks block, except the review findings named under `pii`.

| Check           | Rule                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `layout`        | The root files exist: `lean-toolchain`, `lakefile.lean`, `lake-manifest.json`, `corpus.json`, `modeling-refs.json`, `search-index.json`, `heads.json`, `theorem-redirects.json`, `AUTHORS` and `NOTICE`. Every entry is a regular file.                                                                                                                                                                                  |
| `reserved-name` | No path part is a Windows reserved device name. The stem before the first dot is compared, case-insensitively, against `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`, and `COM`/`LPT` with `¹`, `²` or `³`.                                                                                                                                                                                                   |
| `json`          | `corpus.json`, `heads.json`, `search-index.json`, `modeling-refs.json`, `theorem-redirects.json` and every file under `data/` and `graph/` decode as exactly one JSON value.                                                                                                                                                                                                                                             |
| `pins`          | `lean-toolchain`, the AxiomLib entry of `lake-manifest.json`, and `corpus.json` name lean4 `v4.34.0` and AxiomLib `v1.0.6-beta` at rev `ba3a485c`.                                                                                                                                                                                                                                                                       |
| `sha256`        | Each `corpus.json` `files` entry has `A/<id>.lean`, and its SHA-256 equals `sha256`. Every file under `A/` is listed.                                                                                                                                                                                                                                                                                                    |
| `import`        | Every header `import A.<id>` of an `A/*.lean` file resolves to `A/<id>.lean`.                                                                                                                                                                                                                                                                                                                                            |
| `graph`         | `graph/<graph_generation>/` exists. Each generation directory has `manifest.json`, `graph.json` and `labels.json`. The manifest's `geometry_path` and `labels_path` are canonical corpus-rooted paths of files in the corpus.                                                                                                                                                                                            |
| `pii`           | Emails, Firebase-uid-shaped tokens (28 base62 characters with both letter cases), valid IPv4 and IPv6 addresses, and user-agent product tokens. Hits in `AUTHORS` and in the JSON files the `json` check names block. Hits in `A/*.lean`, and in JSON strings under a Lean-source key (`content`, `file_content`, `source`, `text`, `label`, names and types), are `review`. The `-literals` values are checked as well. |
| `lake-build`    | `lake build` succeeds. Each failed `A` module is named by its path; any other failure is reported against `.`.                                                                                                                                                                                                                                                                                                           |

A literal matches without regard to case or surrounding whitespace.

- A JSON string, a JSON key or an `AUTHORS` line that equals a literal is a hit. A hit blocks, except under a
  Lean-source key, where it is `review`.
- In `A/*.lean` and in strings under a Lean-source key, a literal of a set with `review_in_source` is also a `review`
  hit when it occurs as whole words. A whole-word match is not part of a longer run of letters, digits and `_`.

## Tests

`go test ./...` runs every check on fixture corpora and needs no Lean. The `lake build` tests carry the `corpusgate_e2e`
build tag. They need elan on `PATH` and network access to fetch AxiomLib:

```sh
go test -tags corpusgate_e2e ./...
```
