import Axiom
import A.ta3nj1a4
import A.r59jf3ak
import A.wqn2f9t0

open ta3nj1a4
open r59jf3ak
open wqn2f9t0
open fs83ayjj

namespace cpymj1kb


namespace ComplexSentence

rigid universal Soldier extends Person := "soldier"

relation Single : Person := "is single"
relation Married : Person := "is married"
relation Houses : MaterialEntity "houses" Object

scoped postfix:max " is-single" => Single
scoped postfix:max " is-married" => Married
scoped infix:50 " houses " => Houses

def TheComplex : Type := "the complex"

def TheComplexHousesSingleAndMarriedSoldiers : Prop :=
  (∃ s : Soldier, (s is-single) ∧ (TheComplex houses s)) ∧
  (∃ s : Soldier, (s is-married) ∧ (TheComplex houses s))

end ComplexSentence

end cpymj1kb
