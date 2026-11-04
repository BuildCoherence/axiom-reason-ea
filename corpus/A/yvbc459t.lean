import Axiom

import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.m8h32gq9
import A.xhnxzf59
import A.zpg9xh52

open zpg9xh52

open t0d1zdc3
open gwcwyrvb
open d4qbfhxh
open m8h32gq9
open xhnxzf59
open Set

namespace yvbc459t

rigid universal Male extends Object := "male"
rigid universal Female extends Object := "female"
rigid universal Person extends Object := "person"
rigid universal Daughter extends Person := "daughter"
universal Women extends Daughter := "women"
universal Father extends Person := "father"

relation DaughterOf : Daughter "is the daughter of" Person

scoped notation:50 x:51 " is-the-daughter-of " y:51 => DaughterOf x y

def Alice : Type := "Alice"
def Bob : Type := "Bob"
def Carol : Type := "Carol"

def FemalePerson : Set Type := Female.Is ∩ Person.Is
def DaughterDef := Daughter.Is = FemalePerson

theorem relation_implies_class (dd : DaughterDef)
  : Alice is-the-daughter-of Bob → FemalePerson Alice := by
  intro h
  have alice_is_daughter : Daughter.Is Alice := DaughterOf.inst0 h
  exact dd ▸ alice_is_daughter

end yvbc459t
