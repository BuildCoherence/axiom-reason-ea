import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj

open Axiom

namespace rg8f5x0f

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A j12bzjgj.BFO.BFO

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo)]

axiom user_axioms_auth : AuthenticatedTerm ("MetaBias", userAxiomsList, 1783352483)

def userAxioms : UserAxioms "MetaBias" 1783352483 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end rg8f5x0f
