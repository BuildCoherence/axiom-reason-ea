import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.qvfntphc
import A.f8gz4evn

open Axiom

open qvfntphc
open f8gz4evn
open g0c1njxx

namespace tb1hkjfn

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A d4qbfhxh.BFO
def everyone_makes_mistakes : Prop := A EveryoneMakesMistakes
def i_am_a_person : Prop := A (Dictionary.Person.Is Dictionary.MetaBias)
def i_should_work_toward_correcting_my_mistakes : Prop := A IShouldWorkTowardCorrectingMyMistakes
def i_lack_knowledge_and_understanding : Prop := A ILackKnowledgeAndUnderstanding
def persons_are_agents : Prop := Actions.PersonsAreAgents

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("everyone_makes_mistakes", everyone_makes_mistakes), ("i_am_a_person", i_am_a_person), ("i_should_work_toward_correcting_my_mistakes", i_should_work_toward_correcting_my_mistakes), ("i_lack_knowledge_and_understanding", i_lack_knowledge_and_understanding), ("persons_are_agents", persons_are_agents)]

axiom user_axioms_auth : AuthenticatedTerm ("MetaBias", userAxiomsList, 1785286639)

def userAxioms : UserAxioms "MetaBias" 1785286639 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end tb1hkjfn
