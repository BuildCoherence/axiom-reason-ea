import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.m8h32gq9
import A.wwy58mpt
import A.eb4dp07s
import A.yq7c9c5n
import A.x8zdevve

open Axiom

open a4hsz51v
open wwy58mpt
open eb4dp07s
open yq7c9c5n
open x8zdevve
open nrhqjxz5

namespace njh09fka

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

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("clearer_thought_improves_decision_making", clearer_thought_improves_decision_making), ("better_decision_making_enables_effective_choice", better_decision_making_enables_effective_choice), ("effective_choice_is_greater_potential", effective_choice_is_greater_potential), ("god_is_good", god_is_good), ("i_am_a_person", i_am_a_person), ("metabias_is_a_person", metabias_is_a_person), ("everyone_makes_mistakes", everyone_makes_mistakes), ("all_people_are_immoral", all_people_are_immoral)]

axiom user_axioms_auth : AuthenticatedTerm ("sam", userAxiomsList, 1784910956)

def userAxioms : UserAxioms "sam" 1784910956 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end njh09fka
