import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.vvb6bmef

open ta3nj1a4
open vvb6bmef
open wqn2f9t0
open fs83ayjj
open r59jf3ak

open t0d1zdc3

namespace s928era4

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

end s928era4
