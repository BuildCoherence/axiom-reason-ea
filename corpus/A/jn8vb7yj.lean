import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.m8h32gq9
import A.m0ebdd86
import A.y5gfszhz
import A.kzc1ea04
import A.vefmr4nk

open Axiom

open m0ebdd86
open y5gfszhz
open kzc1ea04
open vefmr4nk
open nrhqjxz5

open a4hsz51v
open ta3nj1a4
open t0d1zdc3
open m8h32gq9

namespace jn8vb7yj

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A ta3nj1a4.BFO
def clearer_thought_improves_decision_making : Prop := A (∀ (p : Person), p.val has-clearer-thought → p.val has-better-decision-making)
def better_decision_making_enables_effective_choice : Prop := A (∀ (p : Person), p.val has-better-decision-making → p.val can-choose-more-effective-courses-of-action)
def effective_choice_is_greater_potential : Prop := A (∀ (p : Person), p.val can-choose-more-effective-courses-of-action → p.val has-greater-potential)
def god_is_good : Prop := m8h32gq9.GodIsGood
def i_am_a_person : Prop := A (Person.Is Sam)
def metabias_is_a_person : Prop := A (Person.Is MetaBias)
def everyone_makes_mistakes : Prop := A EveryoneMakesMistakes
def all_people_are_immoral : Prop := A EveryPersonIsImmoral

def userAxiomsList : Axiom.Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("clearer_thought_improves_decision_making", clearer_thought_improves_decision_making), ("better_decision_making_enables_effective_choice", better_decision_making_enables_effective_choice), ("effective_choice_is_greater_potential", effective_choice_is_greater_potential), ("god_is_good", god_is_good), ("i_am_a_person", i_am_a_person), ("metabias_is_a_person", metabias_is_a_person), ("everyone_makes_mistakes", everyone_makes_mistakes), ("all_people_are_immoral", all_people_are_immoral)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("sam", userAxiomsList, 1785015567)

def userAxioms : Axiom.UserAxioms "sam" 1785015567 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end jn8vb7yj
