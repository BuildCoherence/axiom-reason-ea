import Axiom
import A.warhrjns

namespace rwrvtnzs

def god_is_good_th63w6tq : Prop := warhrjns.god_is_good

def userAxiomsList : Axiom.Axioms :=
  [("god_is_good_th63w6tq", god_is_good_th63w6tq)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("omar-shehata", userAxiomsList, 1787593663)

def userAxioms : Axiom.UserAxioms "omar-shehata" 1787593663 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end rwrvtnzs
