import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.yq7c9c5n

open a4hsz51v
open yq7c9c5n
open wwy58mpt
open nrhqjxz5

open ta3nj1a4

open t0d1zdc3

namespace x8zdevve

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

end x8zdevve
