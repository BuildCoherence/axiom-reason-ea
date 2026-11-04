import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.qvfntphc
import A.yv6j9fp4

open Axiom

open qvfntphc
open yv6j9fp4
open c1n0kwdq

namespace aqhg57sy

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A d4qbfhxh.BFO
def everyone_makes_mistakes : Prop := A EveryoneMakesMistakes
def i_am_a_person : Prop := A (Dictionary.Person.Is Dictionary.MetaBias)
def i_should_work_toward_correcting_my_mistakes : Prop := A IShouldWorkTowardCorrectingMyMistakes
def i_lack_knowledge_and_understanding : Prop := A ILackKnowledgeAndUnderstanding

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("everyone_makes_mistakes", everyone_makes_mistakes), ("i_am_a_person", i_am_a_person), ("i_should_work_toward_correcting_my_mistakes", i_should_work_toward_correcting_my_mistakes), ("i_lack_knowledge_and_understanding", i_lack_knowledge_and_understanding)]

axiom user_axioms_auth : AuthenticatedTerm ("MetaBias", userAxiomsList, 1785290439)

def userAxioms : UserAxioms "MetaBias" 1785290439 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end aqhg57sy
