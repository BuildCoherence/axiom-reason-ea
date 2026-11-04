import Axiom
import A.warhrjns

namespace dxrqnxwt

def god_is_good_th63w6tq : Prop := warhrjns.god_is_good

def userAxiomsList : Axiom.Axioms :=
  [("god_is_good_th63w6tq", god_is_good_th63w6tq)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("TruthSeeker", userAxiomsList, 1790884393)

def userAxioms : Axiom.UserAxioms "TruthSeeker" 1790884393 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end dxrqnxwt
