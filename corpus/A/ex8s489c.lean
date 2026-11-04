import Axiom

namespace ex8s489c

structure MachineControlProtocol where
  packetCount : Nat
  heldOutPacketCount : Nat
  repetitions : Nat
  randomizedOrder : Bool
  warmupPerformed : Bool
  finalAnswerExtraction : Bool
  structuredScoring : Bool
  humanAbsorptionMeasured : Bool


def WellFormedMachineControlProtocol (p : MachineControlProtocol) : Prop :=
  0 < p.packetCount ∧
    0 < p.heldOutPacketCount ∧
    0 < p.repetitions ∧
    p.randomizedOrder = true ∧
    p.warmupPerformed = true ∧
    p.finalAnswerExtraction = true ∧
    p.structuredScoring = true


def MachineOnlyControlEvidence (p : MachineControlProtocol) : Prop :=
  p.humanAbsorptionMeasured = false


def MachineControlIsNotRecipientTransfer (p : MachineControlProtocol) : Prop :=
  MachineOnlyControlEvidence p


def machine_control_protocol_boundaryPayload :=
  "A machine-only connected-compression control should use a frozen packet set, a held-out packet set, explicit warm-up handling, randomized condition order, repeated requests, final-answer extraction, and structured scoring. These controls reduce harness noise; they do not create human recipient absorption evidence."
axiom machine_control_protocol_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", machine_control_protocol_boundaryPayload, 1786286178)
def machine_control_protocol_boundary : Axiom.Statement "hitchhiker2thefuture" machine_control_protocol_boundaryPayload 1786286178 := ⟨machine_control_protocol_boundary_auth⟩

def held_out_machine_suite_boundaryPayload :=
  "A held-out synthetic suite may test required distinctions, recipient fit, bounded next actions, uncertainty preservation, and unsupported overclaims with deterministic answer keys. Its result remains machine-proxy evidence and cannot establish successful transfer to a human recipient."
axiom held_out_machine_suite_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", held_out_machine_suite_boundaryPayload, 1786286178)
def held_out_machine_suite_boundary : Axiom.Statement "hitchhiker2thefuture" held_out_machine_suite_boundaryPayload 1786286178 := ⟨held_out_machine_suite_boundary_auth⟩

def machine_control_failure_boundaryPayload :=
  "If model responses hit the generation ceiling, echo the prompt, fail final-answer extraction, or produce empty scored answers, the run is a harness diagnostic and not an observation of routing quality. A failed control run must remain visible and must not be replaced by plausible-looking aggregate scores."
axiom machine_control_failure_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", machine_control_failure_boundaryPayload, 1786286178)
def machine_control_failure_boundary : Axiom.Statement "hitchhiker2thefuture" machine_control_failure_boundaryPayload 1786286178 := ⟨machine_control_failure_boundary_auth⟩

def structured_machine_score_boundaryPayload :=
  "A structured machine score can measure lexical or rubric-proxy properties of an extracted answer, including signal components, recipient-fit terms, bounded actions, uncertainty markers, and overclaim penalties. It is not comprehension, validated use, correction distance, or capability parity."
axiom structured_machine_score_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", structured_machine_score_boundaryPayload, 1786286178)
def structured_machine_score_boundary : Axiom.Statement "hitchhiker2thefuture" structured_machine_score_boundaryPayload 1786286178 := ⟨structured_machine_score_boundary_auth⟩

end ex8s489c
