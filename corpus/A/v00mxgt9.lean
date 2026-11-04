import Axiom
import A.rwj5ranz

open t0d1zdc3 gwcwyrvb azt4989z rwj5ranz

namespace v00mxgt9

def Sam : Type := "sam"

theorem i_make_mistakes
    (logic_is_actual : LogicIsActual)
    (i_am_a_person : A (Person.Is Sam))
    (everyone_makes_mistakes : A EveryoneMakesMistakes) :
    A (Sam makes-mistakes) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun everyone_including h => everyone_including ⟨Sam, h⟩))
      everyone_makes_mistakes)
    i_am_a_person

end v00mxgt9
