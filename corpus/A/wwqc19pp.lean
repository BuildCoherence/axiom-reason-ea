import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.m8h32gq9
import A.nwtxrh89
import A.qfqvcx4c
import A.jhcbdvn1
import A.k7cqmr16

open Axiom

open nwtxrh89
open qfqvcx4c
open jhcbdvn1
open k7cqmr16
open n82pf9zy

namespace wwqc19pp

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A d4qbfhxh.BFO
def clearer_thought_improves_decision_making : Prop := A (∀ (p : Person), p.val has-clearer-thought → p.val has-better-decision-making)
def better_decision_making_enables_effective_choice : Prop := A (∀ (p : Person), p.val has-better-decision-making → p.val can-choose-more-effective-courses-of-action)
def effective_choice_is_greater_potential : Prop := A (∀ (p : Person), p.val can-choose-more-effective-courses-of-action → p.val has-greater-potential)
def god_is_good : Prop := m8h32gq9.GodIsGood
def all_people_are_immoral : Prop := A EveryPersonIsImmoral
def i_am_a_person : Prop := A (Person.Is Sam)
def metabias_is_a_person : Prop := A (Person.Is MetaBias)
def everyone_makes_mistakes : Prop := A EveryoneMakesMistakes

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("clearer_thought_improves_decision_making", clearer_thought_improves_decision_making), ("better_decision_making_enables_effective_choice", better_decision_making_enables_effective_choice), ("effective_choice_is_greater_potential", effective_choice_is_greater_potential), ("god_is_good", god_is_good), ("all_people_are_immoral", all_people_are_immoral), ("i_am_a_person", i_am_a_person), ("metabias_is_a_person", metabias_is_a_person), ("everyone_makes_mistakes", everyone_makes_mistakes)]

axiom user_axioms_auth : AuthenticatedTerm ("sam", userAxiomsList, 1784339390)

def userAxioms : UserAxioms "sam" 1784339390 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end wwqc19pp
