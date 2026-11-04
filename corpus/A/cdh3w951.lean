import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.g5rfy225

open t0d1zdc3
open gwcwyrvb
open g5rfy225

namespace cdh3w951

-- Hunter Ash: https://x.com/ArtemisConsort/status/2030019327928492320

def AIWillPossessCapabilitiesLinkedToConsciousness : Prop :=
  ∀ c : Type, IsCapabilitySet c → SufficesForConsciousness c →
    ∃ s : Type, IsAISystem s ∧ Possesses s c

def SomeAIWillBeConscious : Prop :=
  ∃ s : Type, IsAISystem s ∧ IsConscious s

theorem some_ai_will_be_conscious
    (logic_is_actual : LogicIsActual)
    (linked : A SomeCapabilitiesSufficeForConsciousness)
    (ai_will_possess : A AIWillPossessCapabilitiesLinkedToConsciousness) :
    A SomeAIWillBeConscious :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun suff possess =>
          suff.elim fun c hc =>
            (possess c hc.1 hc.2).elim fun s hs =>
              ⟨s, hs.1, hc.2 s hs.2⟩))
      linked)
    ai_will_possess

end cdh3w951
