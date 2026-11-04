import Axiom
import A.xnjbb0n8

open Axiom

open xnjbb0n8

namespace t4tcmavf

def humanpower_is_a_network_capability : Prop := Axiom.Actual Humanpower

def userAxiomsList : Axiom.Axioms :=
  [("humanpower_is_a_network_capability", humanpower_is_a_network_capability)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", userAxiomsList, 1786139133)

def userAxioms : Axiom.UserAxioms "hitchhiker2thefuture" 1786139133 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end t4tcmavf
