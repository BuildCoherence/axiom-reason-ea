# axm

`axm` is the Axiom command-line toolkit. It runs entirely on your machine: there is no account and no server. It
installs the published Axiom corpus and a local viewer beside the CLI.

## What is Axiom
Axiom is an experiment with a new form of communication. That makes it difficult (or even counterproductive) to
explain in prose.

Rather than using our words to explain it, we recommend you ask your agent questions about this repo so you can
understand its shape in your own words.

## Prerequisites

- [git](https://git-scm.com/)
- [elan](https://github.com/leanprover/elan), the Lean toolchain manager
- [Claude Code](https://www.anthropic.com/claude-code) or [Codex](https://openai.com/codex/)

## Quickstart

```
curl -fsSL https://install.axiom.computer | sh   # or install.ps1, a Release download, or go install
irm https://install.axiom.computer/install.ps1 | iex   # Windows (PowerShell)
axm init my-ideas --agents claude && cd my-ideas    # or --agents codex
claude                                            # "help me examine an idea"
axm viewer
```

To build from source instead:

```
go install github.com/BuildCoherence/axiom-reason-ea/v2/cmd/axm@latest
```

Each [Release](https://github.com/BuildCoherence/axiom-reason-ea/releases) also carries the `axm_<os>_<arch>` archives
and their `checksums.txt`.

`axm init` creates a workspace from the [`axiom-client`](https://github.com/BuildCoherence/axiom-client) template, then
installs the corpus and the viewer under `~/.axiom/`. `axm upgrade` updates the CLI, the corpus and the viewer, and in a
workspace merges the current template. `axm viewer` serves the corpus archive and your workspace on `127.0.0.1`.

`axm check` elaborates your modified files and their dependencies locally. The admission rules that only the hosted
service ran no longer run in `check`.

If a published 2.0.0 was superseded by a patch release, reinstall with the install script above.

## Related repositories

- [`axiom-lib`](https://github.com/BuildCoherence/axiom-lib): AxiomLib, the Lean library workspaces build against.
- [`axiom-client`](https://github.com/BuildCoherence/axiom-client): the workspace template `axm init` clones.
- [The skills](https://github.com/BuildCoherence/axiom-client/tree/main/.axiom/skills): `axiom-onboarding`,
  `examine-idea`, `formalize`, `axiom-conventions` and `axiomlib-surface`, delivered into each workspace by `axm init`
  and `axm upgrade`.

## Support

Self-hosting and enterprise deployments are not supported.

## License

The code in this repository is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE).

The `corpus/` directory is excluded from the Apache License 2.0. Each corpus file belongs to its publisher and is
redistributed as the public record under the terms in force when it was published, with no further license granted; see
`corpus/NOTICE`. Each corpus file is attributed to its Publisher, the account that published it, which is not a claim of
authorship; `corpus/AUTHORS` lists the Publishers.

"Axiom" is a trademark of Coherence Labs. The Apache License 2.0 does not grant permission to use it.
