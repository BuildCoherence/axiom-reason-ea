import Axiom

namespace g1fbxjjj

structure CapabilityRoute where
  sourceNodeId : Nat
  recipientNodeId : Nat
  capabilityId : Nat
  recipientInterfaceId : Nat
  contextUnits : Nat
  provenancePresent : Bool
  localValidationPassed : Bool
  recipientCorrectionWork : Nat
  validatedUses : Nat


def WellFormedCapabilityRoute (r : CapabilityRoute) : Prop :=
  0 < r.sourceNodeId ∧
    0 < r.recipientNodeId ∧
    0 < r.capabilityId ∧
    0 < r.recipientInterfaceId ∧
    0 < r.contextUnits ∧
    r.sourceNodeId ≠ r.recipientNodeId ∧
    r.validatedUses ≤ r.contextUnits


def CapabilityRouteIsPortable (r : CapabilityRoute) : Prop :=
  r.provenancePresent = true ∧
    r.localValidationPassed = true


def CapabilityRouteProducesValidatedUse (r : CapabilityRoute) : Prop :=
  CapabilityRouteIsPortable r ∧
    r.validatedUses > 0


def CapabilityRouteHasBoundedCorrection (r : CapabilityRoute) : Prop :=
  r.recipientCorrectionWork ≤ r.contextUnits


def capability_route_interface_boundaryPayload :=
  "A capability route is portable only when the receiving node exposes a compatible recipient interface, receives sufficient context, receives provenance, and passes local validation. A route is not universal access, equal competence, or proof that the receiving node internalized the capability."
axiom capability_route_interface_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_route_interface_boundaryPayload, 1786281517)
def capability_route_interface_boundary : Axiom.Statement "hitchhiker2thefuture" capability_route_interface_boundaryPayload 1786281517 := ⟨capability_route_interface_boundary_auth⟩

def capability_route_validated_use_boundaryPayload :=
  "A routed capability counts as validated use only when the receiving node produces an observable useful result after local validation. Transfer, delivery, or message receipt alone does not count as validated use."
axiom capability_route_validated_use_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_route_validated_use_boundaryPayload, 1786281517)
def capability_route_validated_use_boundary : Axiom.Statement "hitchhiker2thefuture" capability_route_validated_use_boundaryPayload 1786281517 := ⟨capability_route_validated_use_boundary_auth⟩

def capability_route_correction_boundaryPayload :=
  "Recipient correction work is a separate observable from transfer and validation. A route with a delivered signal but unmeasured correction work cannot establish lower cost, parity, or reliable reuse."
axiom capability_route_correction_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_route_correction_boundaryPayload, 1786281517)
def capability_route_correction_boundary : Axiom.Statement "hitchhiker2thefuture" capability_route_correction_boundaryPayload 1786281517 := ⟨capability_route_correction_boundary_auth⟩

def capability_route_reuse_boundaryPayload :=
  "A capability route becomes reusable evidence only when the same route or capability is used again under a recorded compatible interface and passes local validation again. A single successful transfer is not reuse reliability."
axiom capability_route_reuse_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", capability_route_reuse_boundaryPayload, 1786281517)
def capability_route_reuse_boundary : Axiom.Statement "hitchhiker2thefuture" capability_route_reuse_boundaryPayload 1786281517 := ⟨capability_route_reuse_boundary_auth⟩

end g1fbxjjj
