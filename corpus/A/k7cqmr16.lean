import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.jhcbdvn1

open jhcbdvn1
open nwtxrh89

open d4qbfhxh
open t0d1zdc3

namespace k7cqmr16

def Sam : Type := "sam"

theorem sam_makes_mistakes
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

end k7cqmr16
