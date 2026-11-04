import Axiom
import A.azt4989z

open t0d1zdc3 gwcwyrvb azt4989z

namespace rwj5ranz

def MetaBias : Type := "MetaBias"

relation MakesMistakes : Person := "makes mistakes"
relation ShouldWorkTowardCorrectingTheirMistakes : Person :=
  "should work toward correcting their mistakes"
relation LacksKnowledgeAndUnderstanding : Person := "lacks knowledge and understanding"

postfix:max " makes-mistakes" => MakesMistakes
postfix:max " should-work-toward-correcting-their-mistakes" =>
  ShouldWorkTowardCorrectingTheirMistakes
postfix:max " lacks-knowledge-and-understanding" => LacksKnowledgeAndUnderstanding

def EveryoneMakesMistakes : Prop := ∀ p : Person, p makes-mistakes

def IShouldWorkTowardCorrectingMyMistakes : Prop :=
  MetaBias should-work-toward-correcting-their-mistakes

def ILackKnowledgeAndUnderstanding : Prop :=
  MetaBias lacks-knowledge-and-understanding

theorem i_make_mistakes
    (logic_is_actual : LogicIsActual)
    (i_am_a_person : A (Person.Is MetaBias))
    (everyone_makes_mistakes : A EveryoneMakesMistakes) :
    A (MetaBias makes-mistakes) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun everyone_including h => everyone_including ⟨MetaBias, h⟩))
      everyone_makes_mistakes)
    i_am_a_person

end rwj5ranz
