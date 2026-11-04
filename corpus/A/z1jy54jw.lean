import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.m8h32gq9
import A.sjrxnvsj
import A.wj5tvbgg
import A.pktczw9n
import A.xp4npv94

open Axiom

open sjrxnvsj
open wj5tvbgg
open pktczw9n
open xp4npv94
open nrhqjxz5

namespace z1jy54jw

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

axiom user_axioms_auth : AuthenticatedTerm ("sam", userAxiomsList, 1784865159)

def userAxioms : UserAxioms "sam" 1784865159 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end z1jy54jw
