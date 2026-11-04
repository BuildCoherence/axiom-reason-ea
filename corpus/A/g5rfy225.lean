import Axiom
import A.t0d1zdc3
import A.gwcwyrvb

open t0d1zdc3
open gwcwyrvb

namespace g5rfy225

-- Hunter Ash: https://x.com/ArtemisConsort/status/2030019327928492320

def IsAISystem : Type → Prop := "is an AI system"
def IsConscious : Type → Prop := "is conscious"
def IsCapabilitySet : Type → Prop := "is a set of capabilities"
def Possesses : Type → Type → Prop := "possesses"

def AICanNeverBeConscious : Prop :=
  ∀ s : Type, IsAISystem s → ¬ IsConscious s

def SufficesForConsciousness (c : Type) : Prop :=
  ∀ s : Type, Possesses s c → IsConscious s

def SomeCapabilitiesSufficeForConsciousness : Prop :=
  ∃ c : Type, IsCapabilitySet c ∧ SufficesForConsciousness c

def ConsciousnessLinkedToCapabilitiesAIWillNeverPossess : Prop :=
  ∃ c : Type, IsCapabilitySet c ∧ SufficesForConsciousness c ∧
    ∀ s : Type, IsAISystem s → ¬ Possesses s c

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
              ⟨c, hc.1, hc.2, fun s s_ai s_has =>
                never_conscious s s_ai (hc.2 s s_has)⟩))
        skeptic))
    (fun not_suff => Or.inr (logic_is_actual.actual_intro _ not_suff))

end g5rfy225
