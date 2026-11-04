import Axiom

namespace ja9spykq

structure HumanpowerObservation where
  generatedUnits : Nat
  leveragedUnits : Nat
  detectedErrors : Nat
  locallyCorrectedErrors : Nat
  validationWork : Nat
  reuseAttempts : Nat
  reuseSuccesses : Nat

def WellFormedHumanpowerObservation (o : HumanpowerObservation) : Prop :=
  0 < o.generatedUnits ∧
    o.leveragedUnits ≤ o.generatedUnits ∧
    o.locallyCorrectedErrors ≤ o.detectedErrors ∧
    o.reuseSuccesses ≤ o.reuseAttempts

def LeverageRatioImproves (before after : HumanpowerObservation) : Prop :=
  after.leveragedUnits * before.generatedUnits >
    before.leveragedUnits * after.generatedUnits

def LocalCorrectionCoverageImproves (before after : HumanpowerObservation) : Prop :=
  0 < before.detectedErrors ∧
    0 < after.detectedErrors ∧
    after.locallyCorrectedErrors * before.detectedErrors >
      before.locallyCorrectedErrors * after.detectedErrors

def ReuseReliabilityImproves (before after : HumanpowerObservation) : Prop :=
  0 < before.reuseAttempts ∧
    0 < after.reuseAttempts ∧
    after.reuseSuccesses * before.reuseAttempts >
      before.reuseSuccesses * after.reuseAttempts

def SupernodeImprovesHumanpower (before after : HumanpowerObservation) : Prop :=
  LeverageRatioImproves before after ∧
    LocalCorrectionCoverageImproves before after ∧
    ReuseReliabilityImproves before after

def humanpower_measurement_specPayload :=
  "Measure humanpower over comparable observation windows using generated information units, leveraged information units, detected errors, locally corrected errors, validation work, reuse attempts, and reuse successes; a superpowered node multiplies humanpower when leverage, local correction coverage, and reuse reliability all improve rather than allowing validation and coordination demand to overwhelm the network"
axiom humanpower_measurement_spec_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", humanpower_measurement_specPayload, 1786106788)
def humanpower_measurement_spec : Axiom.Statement "hitchhiker2thefuture" humanpower_measurement_specPayload 1786106788 := ⟨humanpower_measurement_spec_auth⟩

end ja9spykq
