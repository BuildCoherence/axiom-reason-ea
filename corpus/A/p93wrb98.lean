import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.azt4989z
import A.m8h32gq9
import A.zk1mxe7x

open Axiom

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open azt4989z
open m8h32gq9
open zk1mxe7x
open pv802k7b
open c424c6bg

namespace p93wrb98

def logic_is_actual : Prop := LogicIsActual
def bfo : Prop := A BFO.BFO
def clearer_thought_improves_decision_making : Prop := A (∀ (p : Person), p.val has-clearer-thought → p.val has-better-decision-making)
def better_decision_making_enables_effective_choice : Prop := A (∀ (p : Person), p.val has-better-decision-making → p.val can-choose-more-effective-courses-of-action)
def effective_choice_is_greater_potential : Prop := A (∀ (p : Person), p.val can-choose-more-effective-courses-of-action → p.val has-greater-potential)
def god_is_good : Prop := GodIsGood
def all_people_are_immoral : Prop := A EveryPersonIsImmoral

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("clearer_thought_improves_decision_making", clearer_thought_improves_decision_making), ("better_decision_making_enables_effective_choice", better_decision_making_enables_effective_choice), ("effective_choice_is_greater_potential", effective_choice_is_greater_potential), ("god_is_good", god_is_good), ("all_people_are_immoral", all_people_are_immoral)]

axiom user_axioms_auth : AuthenticatedTerm ("sam", userAxiomsList, 1783355032)

def userAxioms : UserAxioms "sam" 1783355032 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end p93wrb98
