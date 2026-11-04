import Axiom
import A.d4qbfhxh
import A.xhnxzf59
import A.nwtxrh89

open nwtxrh89

open d4qbfhxh
open xhnxzf59

namespace n82pf9zy

rigid universal MoralCharacter extends Quality := "moral character"

relation Immoral : Person := "is immoral"
relation HasMoralCharacter : Person → MoralCharacter := "has moral character"
relation MoreMoralThan : MoralCharacter → MoralCharacter := "is more moral than"

scoped postfix:max " is-immoral" => Immoral
scoped infix:50 " has-moral-character " => HasMoralCharacter
scoped infix:50 " more-moral-than " => MoreMoralThan

abbrev LessMoralThan (a b : Type) : Prop := MoreMoralThan b a

scoped infix:50 " less-moral-than " => LessMoralThan

structure MoralComparisonIsCoherent : Prop where
  more_moral_irreflexive : ∀ m : MoralCharacter, ¬ (m more-moral-than m)
  more_moral_transitive :
    ∀ a b c : MoralCharacter,
      a more-moral-than b → b more-moral-than c → a more-moral-than c

def ImmoralBelowNonImmoral : Prop :=
  ∀ (p q : Person) (mp mq : MoralCharacter),
    p has-moral-character mp →
    q has-moral-character mq →
    p is-immoral →
    ¬ (q is-immoral) →
    mq more-moral-than mp

structure PersonsHaveExactlyOneMoralCharacter : Prop where
  has_one : ∀ p : Person, ∃ m : MoralCharacter, p has-moral-character m
  at_most_one :
    ∀ (p : Person) (m m' : MoralCharacter),
      p has-moral-character m → p has-moral-character m' → m = m'

theorem more_moral_asymmetric
    (coherent : MoralComparisonIsCoherent)
    (a b : MoralCharacter) (h : a more-moral-than b) :
    ¬ (b more-moral-than a) :=
  fun h' =>
    coherent.more_moral_irreflexive a
      (coherent.more_moral_transitive a b a h h')

end n82pf9zy
