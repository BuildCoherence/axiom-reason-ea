import Axiom

namespace v04bbve3

structure CapabilityCorrectionObservation where
  routeAttempts : Nat
  downstreamArtifactsTouched : Nat
  errorsDetected : Nat
  errorsDetectedBeforeReuse : Nat
  correctionWorkUnits : Nat
  validatedReuseCount : Nat


def WellFormedCapabilityCorrectionObservation
    (o : CapabilityCorrectionObservation) : Prop :=
  0 < o.routeAttempts ∧
    o.errorsDetected ≤ o.routeAttempts ∧
    o.errorsDetectedBeforeReuse ≤ o.errorsDetected ∧
    o.validatedReuseCount ≤ o.routeAttempts


def CorrectionDetectedBeforeReuse
    (o : CapabilityCorrectionObservation) : Prop :=
  o.errorsDetectedBeforeReuse = o.errorsDetected


def CorrectionDistanceIsBounded
    (o : CapabilityCorrectionObservation) : Prop :=
  o.errorsDetectedBeforeReuse = o.errorsDetected ∧
    o.downstreamArtifactsTouched = 0


def ReuseIsValidated
    (o : CapabilityCorrectionObservation) : Prop :=
  o.validatedReuseCount > 1 ∧
    o.validatedReuseCount ≤ o.routeAttempts


def correction_distance_is_not_transferPayload :=
  "Correction distance is distinct from transfer. A signal may be delivered and still require downstream rework; the route must record where the error was detected, which downstream artifacts were touched, and how much correction work occurred."
axiom correction_distance_is_not_transfer_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", correction_distance_is_not_transferPayload, 1786286173)
def correction_distance_is_not_transfer : Axiom.Statement "hitchhiker2thefuture" correction_distance_is_not_transferPayload 1786286173 := ⟨correction_distance_is_not_transfer_auth⟩

def bounded_correction_boundaryPayload :=
  "A route has bounded correction only when errors are detected before validated reuse and no downstream artifact is touched by the error. Delivery, local validation, or recipient confidence alone does not establish bounded correction."
axiom bounded_correction_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", bounded_correction_boundaryPayload, 1786286173)
def bounded_correction_boundary : Axiom.Statement "hitchhiker2thefuture" bounded_correction_boundaryPayload 1786286173 := ⟨bounded_correction_boundary_auth⟩

def validated_reuse_boundaryPayload :=
  "Validated reuse requires more than one recorded route attempt and repeated local validation under the compatible interface. One successful use is not reuse reliability."
axiom validated_reuse_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", validated_reuse_boundaryPayload, 1786286173)
def validated_reuse_boundary : Axiom.Statement "hitchhiker2thefuture" validated_reuse_boundaryPayload 1786286173 := ⟨validated_reuse_boundary_auth⟩

def correction_cost_boundaryPayload :=
  "Correction work is part of the cost of circulating a capability. A route cannot establish lower cost or parity while correction work, downstream artifact impact, or validation work is missing."
axiom correction_cost_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", correction_cost_boundaryPayload, 1786286173)
def correction_cost_boundary : Axiom.Statement "hitchhiker2thefuture" correction_cost_boundaryPayload 1786286173 := ⟨correction_cost_boundary_auth⟩

end v04bbve3
