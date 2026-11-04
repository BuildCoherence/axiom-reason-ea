import Axiom
import A.t0d1zdc3
import A.gwcwyrvb

open Axiom

namespace v42tdm96

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual)]

axiom user_axioms_auth : AuthenticatedTerm ("zach", userAxiomsList, 1783289034)

def userAxioms : UserAxioms "zach" 1783289034 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end v42tdm96
