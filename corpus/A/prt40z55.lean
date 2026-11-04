import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.rwj5ranz

open Axiom

open rwj5ranz

namespace prt40z55

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A j12bzjgj.BFO.BFO
def everyone_makes_mistakes : Prop := A EveryoneMakesMistakes
def i_am_a_person : Prop := A (azt4989z.Person.Is MetaBias)
def i_should_work_toward_correcting_my_mistakes : Prop := A IShouldWorkTowardCorrectingMyMistakes
def i_lack_knowledge_and_understanding : Prop := A ILackKnowledgeAndUnderstanding

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("everyone_makes_mistakes", everyone_makes_mistakes), ("i_am_a_person", i_am_a_person), ("i_should_work_toward_correcting_my_mistakes", i_should_work_toward_correcting_my_mistakes), ("i_lack_knowledge_and_understanding", i_lack_knowledge_and_understanding)]

axiom user_axioms_auth : AuthenticatedTerm ("MetaBias", userAxiomsList, 1783365602)

def userAxioms : UserAxioms "MetaBias" 1783365602 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end prt40z55
