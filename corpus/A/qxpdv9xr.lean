import Axiom

import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.m8h32gq9
import A.r59jf3ak
import A.zpg9xh52

open ta3nj1a4
open r59jf3ak
open zpg9xh52

open t0d1zdc3
open gwcwyrvb
open m8h32gq9
open Set

namespace qxpdv9xr

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

end qxpdv9xr
