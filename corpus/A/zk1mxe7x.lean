import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.azt4989z
import A.pv802k7b

open t0d1zdc3
open gwcwyrvb
open azt4989z
open pv802k7b
open j12bzjgj
open c424c6bg

namespace zk1mxe7x

relation Rich : Person := "is rich"

postfix:max " is-rich" => Rich

def EveryRichPersonIsImmoral : Prop :=
  ∀ p : Person, p is-rich → p is-immoral

def NotEveryRichPersonIsImmoral : Prop :=
  ¬ EveryRichPersonIsImmoral

def SomeRichPersonIsNotImmoral : Prop :=
  ∃ p : Person, p is-rich ∧ ¬ (p is-immoral)

def DollyParton : Type := "Dolly Parton"

def DollyPartonIsRichAndNotImmoral : Prop :=
  DollyParton is-rich ∧ ¬ (DollyParton is-immoral)

def EveryPersonIsImmoral : Prop :=
  ∀ p : Person, p is-immoral

def OnlyRichPeopleAreImmoral : Prop :=
  ∀ p : Person, p is-immoral → p is-rich

relation SameCircumstancesExceptWealth : Person → Person :=
  "has the same morally relevant circumstances except wealth as"

infix:50 " same-circumstances-except-wealth " => SameCircumstancesExceptWealth

structure TwoPeopleDifferingInWealth where
  p1 : Person
  p2 : Person
  p1Character : MoralCharacter
  p2Character : MoralCharacter
  p1_is_rich : p1 is-rich
  p2_is_not : ¬ (p2 is-rich)
  p1_has_character : p1 has-moral-character p1Character
  p2_has_character : p2 has-moral-character p2Character
  all_else_equal : p1 same-circumstances-except-wealth p2

def AllElseEqualTheRichPersonIsLessMoral : Prop :=
  ∀ s : TwoPeopleDifferingInWealth, s.p1Character less-moral-than s.p2Character

theorem named_counterexample_refutes
    (h : DollyPartonIsRichAndNotImmoral) : SomeRichPersonIsNotImmoral :=
  ⟨⟨DollyParton, Rich.inst0 h.1⟩, h.1, h.2⟩

theorem some_refutes_every
    (h : SomeRichPersonIsNotImmoral) : NotEveryRichPersonIsImmoral :=
  fun every => h.elim fun p hp => hp.2 (every p hp.1)

theorem not_every_means_some
    (h : NotEveryRichPersonIsImmoral) : SomeRichPersonIsNotImmoral :=
  Classical.byContradiction fun no_counterexample =>
    h fun p rich =>
      Classical.byContradiction fun not_immoral =>
        no_counterexample ⟨p, rich, not_immoral⟩

theorem everyone_immoral_confirms_the_claim
    (everyone : EveryPersonIsImmoral) : EveryRichPersonIsImmoral :=
  fun p _ => everyone p

theorem everyone_immoral_rejects_only_rich
    (everyone : EveryPersonIsImmoral)
    (someone_not_rich : ∃ p : Person, ¬ (p is-rich)) :
    ¬ OnlyRichPeopleAreImmoral :=
  fun only_rich => someone_not_rich.elim fun p not_rich =>
    not_rich (only_rich p (everyone p))

theorem disagreement_is_contradiction
    (logic_is_actual : LogicIsActual)
    (every : A EveryRichPersonIsImmoral)
    (some_not : A SomeRichPersonIsNotImmoral) : False :=
  logic_is_actual.consistency
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _ some_refutes_every)
        some_not)
      every)

theorem immoral_non_rich_twin_makes_rich_twin_immoral
    (coherent : MoralComparisonIsCoherent)
    (immoral_below : ImmoralBelowNonImmoral)
    (rich_less_moral : AllElseEqualTheRichPersonIsLessMoral)
    (s : TwoPeopleDifferingInWealth)
    (immoral : s.p2 is-immoral) :
    s.p1 is-immoral :=
  Classical.byContradiction fun not_immoral =>
    more_moral_asymmetric coherent s.p2Character s.p1Character
      (rich_less_moral s)
      (immoral_below s.p2 s.p1 s.p2Character s.p1Character
        s.p2_has_character s.p1_has_character
        immoral not_immoral)

end zk1mxe7x
