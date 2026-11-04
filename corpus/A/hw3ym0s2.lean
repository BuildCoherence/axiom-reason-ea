import Axiom.Elab.Statement

namespace hw3ym0s2

-- In the measured two-dependent live slice, independent mechanical state checks passed for every completed call while model task success was lower in two conditions.
def CT_V_001_mechanical_and_response_correctness_are_separablePayload : String :=
  "In the measured two-dependent live slice, all 93 completed calls passed the independent mechanical state checks, while model task success was lower in the dependency-aware rebuild and hidden target-only conditions. Evidence: openrouter_two_dependent_rebuild_3rep_retry_receipt.json. Observed values: mechanical exactness 93/93; model success dependency-aware 33/39; hidden target-only 23/27; global 27/27. Scope: one live mechanism pilot. Falsifier: a matched rerun shows model success and mechanical state correctness indistinguishable across conditions, or the mechanical checker depends on the model answer."
axiom CT_V_001_mechanical_and_response_correctness_are_separable_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", CT_V_001_mechanical_and_response_correctness_are_separablePayload, 1787493013)
def CT_V_001_mechanical_and_response_correctness_are_separable : Axiom.Statement "hitchhiker2thefuture" CT_V_001_mechanical_and_response_correctness_are_separablePayload 1787493013 := ⟨CT_V_001_mechanical_and_response_correctness_are_separable_auth⟩

-- Selective reset safety depends on a dependency graph that contains the relevant edges.
def CT_V_002_selective_reset_safety_depends_on_dependency_completenessPayload : String :=
  "In the measured two-dependent protocol, target-only invalidation removed network/current while leaving both dependent namespaces available; dependency-aware invalidation removed network/current, derived/report, and derived/audit. Evidence: openrouter_two_dependent_rebuild_3rep_retry_receipt.json. Scope: one live mechanism pilot. Falsifier: a complete dependency-aware rerun leaves a dependent namespace available after source invalidation, or target-only invalidation removes all declared dependents without being instructed to do so."
axiom CT_V_002_selective_reset_safety_depends_on_dependency_completeness_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", CT_V_002_selective_reset_safety_depends_on_dependency_completenessPayload, 1787493013)
def CT_V_002_selective_reset_safety_depends_on_dependency_completeness : Axiom.Statement "hitchhiker2thefuture" CT_V_002_selective_reset_safety_depends_on_dependency_completenessPayload 1787493013 := ⟨CT_V_002_selective_reset_safety_depends_on_dependency_completeness_auth⟩

-- The measured topology provides a bounded dependent-count scaling observation.
def CT_V_003_dependent_rebuild_work_increases_with_dependent_countPayload : String :=
  "In the measured live pilots, increasing the topology from one dependent to two increased per-agent dependency-aware rebuild work from 6 to 8 writes, 3 to 4 retrievals, and 6 to 8 verification actions. Evidence: openrouter_measured_rebuild_10rep_receipt.json and openrouter_two_dependent_rebuild_3rep_retry_receipt.json. Scope: one compressed three-replica substrate topology; descriptive mechanism result, not a universal scaling law. Falsifier: a preregistered dependent-count sweep with matched source, replicas, prompts, and provider conditions shows no increase in measured rebuild operations as dependent count rises."
axiom CT_V_003_dependent_rebuild_work_increases_with_dependent_count_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", CT_V_003_dependent_rebuild_work_increases_with_dependent_countPayload, 1787493013)
def CT_V_003_dependent_rebuild_work_increases_with_dependent_count : Axiom.Statement "hitchhiker2thefuture" CT_V_003_dependent_rebuild_work_increases_with_dependent_countPayload 1787493013 := ⟨CT_V_003_dependent_rebuild_work_increases_with_dependent_count_auth⟩

-- Global reset trades post-invalidation retrieval work for destruction of valid scoped state.
def CT_V_004_global_reset_trades_work_for_valid_state_lossPayload : String :=
  "In the measured two-dependent protocol, scoped global reset performed no retrievals or verifications after invalidation but removed the authoritative source, current record, both dependent reports, and independent archive. Evidence: openrouter_two_dependent_rebuild_3rep_retry_receipt.json. Scope: one live mechanism pilot. Falsifier: an independently instrumented global reset preserves any of those namespaces, or performs equivalent reconstruction work without recording it."
axiom CT_V_004_global_reset_trades_work_for_valid_state_loss_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", CT_V_004_global_reset_trades_work_for_valid_state_lossPayload, 1787493013)
def CT_V_004_global_reset_trades_work_for_valid_state_loss : Axiom.Statement "hitchhiker2thefuture" CT_V_004_global_reset_trades_work_for_valid_state_lossPayload 1787493013 := ⟨CT_V_004_global_reset_trades_work_for_valid_state_loss_auth⟩

-- Replica agreement is not sufficient evidence of semantic validity.
def CT_V_005_replica_agreement_is_insufficient_for_semantic_validityPayload : String :=
  "In the correlated-corruption fixture, three replicas agreed on the same wrong record; semantic verification rejected the record despite replica agreement. Evidence: openrouter_correlated_fault_receipt.json and openrouter-correlated-fault-readout.md. Scope: deterministic and live correlated-fault mechanism fixture. Falsifier: a source-independent semantic check cannot distinguish the correlated wrong record from the expected record, or the replicas are shown not to contain identical corrupted payloads."
axiom CT_V_005_replica_agreement_is_insufficient_for_semantic_validity_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", CT_V_005_replica_agreement_is_insufficient_for_semantic_validityPayload, 1787493013)
def CT_V_005_replica_agreement_is_insufficient_for_semantic_validity : Axiom.Statement "hitchhiker2thefuture" CT_V_005_replica_agreement_is_insufficient_for_semantic_validityPayload 1787493013 := ⟨CT_V_005_replica_agreement_is_insufficient_for_semantic_validity_auth⟩

end hw3ym0s2
