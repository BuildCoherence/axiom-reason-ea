import Axiom

namespace b2rnf1rk

structure CapabilityCompressionPilotObservation where
  packetCount : Nat
  isolatedMeanKeywordCoverageMilli : Nat
  routedMeanKeywordCoverageMilli : Nat
  isolatedWallMillis : Nat
  routedWallMillis : Nat
  isolatedPromptTokens : Nat
  routedPromptTokens : Nat
  isolatedOutputTokens : Nat
  routedOutputTokens : Nat


def WellFormedCapabilityCompressionPilotObservation
    (o : CapabilityCompressionPilotObservation) : Prop :=
  0 < o.packetCount ∧
    o.isolatedMeanKeywordCoverageMilli ≤ 1000 ∧
    o.routedMeanKeywordCoverageMilli ≤ 1000 ∧
    0 < o.isolatedWallMillis ∧
    0 < o.routedWallMillis ∧
    0 < o.isolatedPromptTokens ∧
    0 < o.routedPromptTokens ∧
    0 < o.isolatedOutputTokens ∧
    0 < o.routedOutputTokens


def RoutedKeywordCoverageImproves
    (o : CapabilityCompressionPilotObservation) : Prop :=
  o.routedMeanKeywordCoverageMilli > o.isolatedMeanKeywordCoverageMilli


def capability_compression_machine_pilot_observationPayload :=
  "In a three-packet redacted synthetic machine-side pilot using qwen3:4b, a recipient-routed prompt produced higher mean deterministic keyword/actionability proxy coverage than an isolated prompt: 0.656 versus 0.344, an absolute difference of 0.311. The proxy is lexical and task-specific; it is not recipient absorption, validated use, capability parity, or evidence that a human source node was replicated."
axiom capability_compression_machine_pilot_observation_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_compression_machine_pilot_observationPayload, 1786281335)
def capability_compression_machine_pilot_observation : Axiom.Statement "hitchhiker2thefuture" capability_compression_machine_pilot_observationPayload 1786281335 := ⟨capability_compression_machine_pilot_observation_auth⟩

def capability_compression_machine_pilot_cost_receiptPayload :=
  "The same pilot recorded 86.284 seconds of isolated wall time and 30.604 seconds of routed wall time, with 316 versus 419 prompt tokens and 7,995 versus 2,965 output tokens. These local timings and token counts are implementation receipts, not a general cost advantage: model warm-up, request order, provider pricing, human attention, recipient correction, and validation cost were not controlled or priced."
axiom capability_compression_machine_pilot_cost_receipt_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_compression_machine_pilot_cost_receiptPayload, 1786281335)
def capability_compression_machine_pilot_cost_receipt : Axiom.Statement "hitchhiker2thefuture" capability_compression_machine_pilot_cost_receiptPayload 1786281335 := ⟨capability_compression_machine_pilot_cost_receipt_auth⟩

def capability_compression_machine_pilot_missing_cellsPayload :=
  "The machine-side pilot did not include a fresh Steph response, blinded recipient absorption, recipient-selected next action, recipient correction distance, causal artifact or decision change, or human time and energy cost. Those missing cells prevent a claim of Steph-versus-model superiority, parity, lower network cost, or successful capability transfer."
axiom capability_compression_machine_pilot_missing_cells_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_compression_machine_pilot_missing_cellsPayload, 1786281335)
def capability_compression_machine_pilot_missing_cells : Axiom.Statement "hitchhiker2thefuture" capability_compression_machine_pilot_missing_cellsPayload 1786281335 := ⟨capability_compression_machine_pilot_missing_cells_auth⟩

def capability_compression_machine_pilot_protocol_boundaryPayload :=
  "The pilot compared isolated and recipient-routed prompts on the same three redacted synthetic packets and used deterministic keyword/actionability coverage as its scoring proxy. A stronger experiment must freeze a held-out task suite, include a fresh human response, blind the recipient condition, score recipient use and correction work, and preserve the negative result if transfer is not demonstrated."
axiom capability_compression_machine_pilot_protocol_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_compression_machine_pilot_protocol_boundaryPayload, 1786281335)
def capability_compression_machine_pilot_protocol_boundary : Axiom.Statement "hitchhiker2thefuture" capability_compression_machine_pilot_protocol_boundaryPayload 1786281335 := ⟨capability_compression_machine_pilot_protocol_boundary_auth⟩

end b2rnf1rk
