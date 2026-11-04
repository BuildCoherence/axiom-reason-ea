import Axiom

namespace xgh0dd28

structure HumanpowerExternalOutcomeCandidate where
  candidateId : String
  outcomeClass : String
  validationStatus : String
  distributionStatus : String
  externalAdoptionStatus : String
  causalStatus : String
  rewardStatus : String

def HumanpowerExternalOutcomeCandidates : List HumanpowerExternalOutcomeCandidate := [
  {
    candidateId := "erdos-728"
    outcomeClass := "solved"
    validationStatus := "public mathematical artifact identified"
    distributionStatus := "public research and episode artifacts identified"
    externalAdoptionStatus := "community acceptance receipt not attached"
    causalStatus := "unresolved"
    rewardStatus := "unresolved"
  },
  {
    candidateId := "fgg-qaoa"
    outcomeClass := "solved"
    validationStatus := "public mathematical artifact identified"
    distributionStatus := "public research and episode artifacts identified"
    externalAdoptionStatus := "community acceptance receipt not attached"
    causalStatus := "unresolved"
    rewardStatus := "unresolved"
  },
  {
    candidateId := "anderson-quasi-completeness"
    outcomeClass := "solved"
    validationStatus := "public mathematical artifact identified"
    distributionStatus := "public research and episode artifacts identified"
    externalAdoptionStatus := "community acceptance receipt not attached"
    causalStatus := "unresolved"
    rewardStatus := "unresolved"
  },
  {
    candidateId := "jacobian-conjecture"
    outcomeClass := "human_ai"
    validationStatus := "formal or community-check artifacts identified"
    distributionStatus := "public research and episode artifacts identified"
    externalAdoptionStatus := "community acceptance receipt not attached"
    causalStatus := "unresolved"
    rewardStatus := "unresolved"
  }
]

def humanpower_external_outcome_receipt_boundaryPayload :=
  "The current mathematical-outcome ledger contains 18 candidate records: 3 disproved, 4 advanced, 8 solved, 1 formalized-existing, and 2 human-AI. The records identify public mathematical artifacts and distribution packages, but the present humanpower ledger does not attach a complete chain from our local validation to external mathematical acceptance, downstream adoption, disappearance of the network behind the work, or reward to the originating contributor. The candidates are therefore leads for outcome receipts, not proof of causal impact."
axiom humanpower_external_outcome_receipt_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", humanpower_external_outcome_receipt_boundaryPayload, 1786150754)
def humanpower_external_outcome_receipt_boundary : Axiom.Statement "hitchhiker2thefuture" humanpower_external_outcome_receipt_boundaryPayload 1786150754 := ⟨humanpower_external_outcome_receipt_boundary_auth⟩

def humanpower_external_outcome_receipt_contractPayload :=
  "A completed external-outcome receipt must bind one named work to its originating human request, validation artifact, validator identity or role, publication or distribution event, external acceptance or adoption event, attribution boundary, downstream reuse, and reward status. Each link must carry a timestamp, artifact locator, content hash or public URL, and confidence class. Missing links remain unresolved rather than being inferred from temporal proximity or public visibility."
axiom humanpower_external_outcome_receipt_contract_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", humanpower_external_outcome_receipt_contractPayload, 1786150754)
def humanpower_external_outcome_receipt_contract : Axiom.Statement "hitchhiker2thefuture" humanpower_external_outcome_receipt_contractPayload 1786150754 := ⟨humanpower_external_outcome_receipt_contract_auth⟩

end xgh0dd28
