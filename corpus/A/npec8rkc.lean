import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.r59jf3ak

open ta3nj1a4
open r59jf3ak

-- Hunter Ash: https://x.com/ArtemisConsort/status/2030019327928492320
-- BFO-register version of Workspace/AIConsciousnessDilemma.lean

open t0d1zdc3

namespace npec8rkc

rigid universal AISystem extends Object := "AI system"
rigid universal CapabilitySet extends GenericallyDependentContinuant := "set of capabilities"

relation PossessesAt : Object "possesses" CapabilitySet "at" TemporalRegion
relation ConsciousAt : Object "is conscious at" TemporalRegion

def AICanNeverBeConscious : Prop :=
  ∀ s : Type, AISystem.Is s → ∀ t : Type, ¬ ConsciousAt s t

def SufficesForConsciousness (c : Type) : Prop :=
  ∀ s t : Type, PossessesAt s c t → ConsciousAt s t

def SomeCapabilitiesSufficeForConsciousness : Prop :=
  ∃ c : Type, CapabilitySet.Is c ∧ SufficesForConsciousness c

def ConsciousnessLinkedToCapabilitiesAIWillNeverPossess : Prop :=
  ∃ c : Type, CapabilitySet.Is c ∧ SufficesForConsciousness c ∧
    ∀ s t : Type, AISystem.Is s → ¬ PossessesAt s c t

theorem denying_ai_consciousness_requires_one_of_two_beliefs
    (logic_is_actual : LogicIsActual)
    (skeptic : A AICanNeverBeConscious) :
    A ConsciousnessLinkedToCapabilitiesAIWillNeverPossess ∨
      A (¬ SomeCapabilitiesSufficeForConsciousness) :=
  (Classical.em SomeCapabilitiesSufficeForConsciousness).elim
    (fun suff =>
      Or.inl (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _
          (fun never_conscious =>
            suff.elim fun c hc =>
              ⟨c, hc.1, hc.2, fun s t s_ai s_has =>
                never_conscious s s_ai t (hc.2 s t s_has)⟩))
        skeptic))
    (fun not_suff => Or.inr (logic_is_actual.actual_intro _ not_suff))

end npec8rkc
