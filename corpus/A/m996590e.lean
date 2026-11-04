import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.azt4989z
import A.e4xks8h4

open e4xks8h4

open t0d1zdc3
open gwcwyrvb
open azt4989z
open Dictionary

namespace m996590e

def EveryoneMakesMistakes : Prop := ∀ p : Person, p makes-mistakes

def IShouldWorkTowardCorrectingMyMistakes : Prop :=
  MetaBias should-work-toward-correcting-their-mistakes

def ILackKnowledgeAndUnderstanding : Prop :=
  MetaBias lacks-knowledge-and-understanding

theorem i_make_mistakes
    (logic_is_actual : LogicIsActual)
    (i_am_a_person : A (MetaBias is-person))
    (everyone_makes_mistakes : A EveryoneMakesMistakes) :
    A (MetaBias makes-mistakes) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun everyone_including h => everyone_including ⟨MetaBias, h⟩))
      everyone_makes_mistakes)
    i_am_a_person

end m996590e
