import Axiom
import A.j12bzjgj
import A.azt4989z

open j12bzjgj
open azt4989z
open t0d1zdc3
open gwcwyrvb
open c424c6bg

open BFO

namespace pv802k7b

rigid universal MoralCharacter extends Quality := "moral character"

relation Immoral : Person := "is immoral"
relation HasMoralCharacter : Person → MoralCharacter := "has moral character"
relation MoreMoralThan : MoralCharacter → MoralCharacter := "is more moral than"

postfix:max " is-immoral" => Immoral
infix:50 " has-moral-character " => HasMoralCharacter
infix:50 " more-moral-than " => MoreMoralThan

abbrev LessMoralThan (a b : Type) : Prop := MoreMoralThan b a

infix:50 " less-moral-than " => LessMoralThan

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

end pv802k7b
