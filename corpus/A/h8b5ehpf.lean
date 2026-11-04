import Axiom
import A.warhrjns
import A.wwqc19pp
import A.ydh9veyw

namespace h8b5ehpf

def logic_is_actual : Prop := warhrjns.logic_is_actual

def bfo : Prop := warhrjns.bfo

def clearer_thought_improves_decision_making : Prop := wwqc19pp.clearer_thought_improves_decision_making

def better_decision_making_enables_effective_choice : Prop := wwqc19pp.better_decision_making_enables_effective_choice

def effective_choice_is_greater_potential : Prop := wwqc19pp.effective_choice_is_greater_potential

def god_is_good : Prop := warhrjns.god_is_good

def i_am_a_person : Prop := wwqc19pp.i_am_a_person

def metabias_is_a_person : Prop := wwqc19pp.metabias_is_a_person

def everyone_makes_mistakes : Prop := wwqc19pp.everyone_makes_mistakes

def all_people_are_immoral : Prop := wwqc19pp.all_people_are_immoral

def i_should_work_toward_correcting__rrcgk48g : Prop := ydh9veyw.i_should_work_toward_correcting_my_mistakes

def userAxiomsList : Axiom.Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("clearer_thought_improves_decision_making", clearer_thought_improves_decision_making), ("better_decision_making_enables_effective_choice", better_decision_making_enables_effective_choice), ("effective_choice_is_greater_potential", effective_choice_is_greater_potential), ("god_is_good", god_is_good), ("i_am_a_person", i_am_a_person), ("metabias_is_a_person", metabias_is_a_person), ("everyone_makes_mistakes", everyone_makes_mistakes), ("all_people_are_immoral", all_people_are_immoral), ("i_should_work_toward_correcting__rrcgk48g", i_should_work_toward_correcting__rrcgk48g)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("sam", userAxiomsList, 1787150858)

def userAxioms : Axiom.UserAxioms "sam" 1787150858 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end h8b5ehpf
