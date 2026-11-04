import Lake
open Lake DSL

package axiomCorpus where
  leanOptions := #[⟨`autoImplicit, false⟩]

require AxiomLib from git "https://github.com/BuildCoherence/axiom-lib" @ "v1.0.6-beta"

@[default_target]
lean_lib A where
  roots := #[`A]
  globs := #[Glob.submodules `A]
