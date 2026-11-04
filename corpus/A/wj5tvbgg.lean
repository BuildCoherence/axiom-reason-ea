import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.r59jf3ak
import A.nrhqjxz5

open nrhqjxz5

open t0d1zdc3
open ta3nj1a4
open r59jf3ak

namespace wj5tvbgg

rigid universal MoralCharacter extends Quality := "moral character"

relation Immoral : Person := "is immoral"
relation HasMoralCharacter : Person → MoralCharacter := "has moral character"
relation MoreMoralThan : MoralCharacter → MoralCharacter := "is more moral than"
relation Rich : Person "is rich"

scoped postfix:max " is-immoral" => Immoral
scoped infix:50 " has-moral-character " => HasMoralCharacter
scoped infix:50 " more-moral-than " => MoreMoralThan
scoped postfix:max " is-rich" => Rich

def EveryRichPersonIsImmoral : Prop :=
  ∀ p : Person, p is-rich → p is-immoral

def NotEveryRichPersonIsImmoral : Prop :=
  ¬ EveryRichPersonIsImmoral

def SomeRichPersonIsNotImmoral : Prop :=
  ∃ p : Person, p is-rich ∧ ¬ (p is-immoral)

def SomeRichPersonIsImmoral : Prop :=
  ∃ p : Person, p is-rich ∧ p is-immoral

theorem some_not_immoral_is_saying_not_every
  : SomeRichPersonIsNotImmoral ↔ NotEveryRichPersonIsImmoral :=
  ⟨fun ⟨p, p_rich, p_not_immoral⟩ every => p_not_immoral (every p p_rich),
   fun not_every =>
    Classical.byContradiction fun not_some =>
      not_every fun p p_rich =>
        Classical.byContradiction fun p_not_immoral =>
          not_some ⟨p, p_rich, p_not_immoral⟩⟩

def DollyParton : Type := "Dolly Parton"

def DollyPartonIsRichAndNotImmoral : Prop :=
  DollyParton is-rich ∧ ¬ (DollyParton is-immoral)

theorem dolly_parton_shows_all_rich_are_not_immoral
    (h : DollyPartonIsRichAndNotImmoral)
  : SomeRichPersonIsNotImmoral :=
  ⟨⟨DollyParton, Rich.inst0 h.1⟩, h.1, h.2⟩

def JeffreyEpstein : Type := "Jeffrey Epstein"

def JeffreyEpsteinIsRichAndImmoral : Prop :=
  JeffreyEpstein is-rich ∧ JeffreyEpstein is-immoral

theorem jeffrey_epstein_shows_some_rich_are_immoral
    (h : JeffreyEpsteinIsRichAndImmoral)
  : SomeRichPersonIsImmoral :=
  ⟨⟨JeffreyEpstein, Rich.inst0 h.1⟩, h.1, h.2⟩

def EveryPersonIsImmoral : Prop :=
  ∀ p : Person, p is-immoral

def OnlyRichPeopleAreImmoral : Prop :=
  ∀ p : Person, p is-immoral → p is-rich

theorem everyone_immoral_confirms_all_rich_are_immoral
    (everyone : EveryPersonIsImmoral) : EveryRichPersonIsImmoral :=
  fun p _ => everyone p

theorem everyone_immoral_rejects_only_rich
    (everyone : EveryPersonIsImmoral)
    (someone_not_rich : ∃ p : Person, ¬ (p is-rich)) :
    ¬ OnlyRichPeopleAreImmoral :=
  fun only_rich => someone_not_rich.elim fun p not_rich =>
    not_rich (only_rich p (everyone p))

theorem disagreement_is_contradiction
    (every : EveryRichPersonIsImmoral)
    (some_not : SomeRichPersonIsNotImmoral) : False :=
  some_not_immoral_is_saying_not_every.mp some_not every

relation SameCircumstancesExceptWealth : Person → Person :=
  "has the same morally relevant circumstances except wealth as"

scoped infix:50 " same-circumstances-except-wealth " => SameCircumstancesExceptWealth
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
  at_least_one : ∀ p : Person, ∃ m : MoralCharacter, p has-moral-character m
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

section Actual

theorem actual_some_not_immoral_is_saying_not_every
    (logic_is_actual : LogicIsActual) :
    A (SomeRichPersonIsNotImmoral ↔ NotEveryRichPersonIsImmoral) :=
  logic_is_actual.actual_intro _ some_not_immoral_is_saying_not_every

theorem actual_dolly_parton_shows_all_rich_are_not_immoral
    (logic_is_actual : LogicIsActual)
    (h : A DollyPartonIsRichAndNotImmoral) :
    A SomeRichPersonIsNotImmoral :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _ dolly_parton_shows_all_rich_are_not_immoral) h

theorem actual_jeffrey_epstein_shows_some_rich_are_immoral
    (logic_is_actual : LogicIsActual)
    (h : A JeffreyEpsteinIsRichAndImmoral) :
    A SomeRichPersonIsImmoral :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _ jeffrey_epstein_shows_some_rich_are_immoral) h

theorem actual_everyone_immoral_confirms_all_rich_are_immoral
    (logic_is_actual : LogicIsActual)
    (everyone : A EveryPersonIsImmoral) :
    A EveryRichPersonIsImmoral :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _ everyone_immoral_confirms_all_rich_are_immoral)
    everyone

theorem actual_everyone_immoral_rejects_only_rich
    (logic_is_actual : LogicIsActual)
    (everyone : A EveryPersonIsImmoral)
    (someone_not_rich : A (∃ p : Person, ¬ (p is-rich))) :
    A (¬ OnlyRichPeopleAreImmoral) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _ everyone_immoral_rejects_only_rich) everyone)
    someone_not_rich

theorem actual_disagreement_is_contradiction
    (logic_is_actual : LogicIsActual)
    (every : A EveryRichPersonIsImmoral)
    (some_not : A SomeRichPersonIsNotImmoral) :
    A False :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _ disagreement_is_contradiction)
      every)
    some_not

theorem actual_more_moral_asymmetric
    (logic_is_actual : LogicIsActual)
    (coherent : A MoralComparisonIsCoherent)
    (a b : MoralCharacter)
    (h : A (a more-moral-than b)) :
    A (¬ (b more-moral-than a)) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun c hab => more_moral_asymmetric c a b hab))
      coherent)
    h

theorem actual_immoral_non_rich_twin_makes_rich_twin_immoral
    (logic_is_actual : LogicIsActual)
    (coherent : A MoralComparisonIsCoherent)
    (immoral_below : A ImmoralBelowNonImmoral)
    (rich_less_moral : A AllElseEqualTheRichPersonIsLessMoral)
    (s : TwoPeopleDifferingInWealth)
    (immoral : A (s.p2 is-immoral)) :
    A (s.p1 is-immoral) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.mp _ _
          (logic_is_actual.actual_intro _
            (fun c ib rlm im =>
              immoral_non_rich_twin_makes_rich_twin_immoral c ib rlm s im))
          coherent)
        immoral_below)
      rich_less_moral)
    immoral

end Actual

end wj5tvbgg
