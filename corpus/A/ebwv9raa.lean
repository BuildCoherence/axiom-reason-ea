import Axiom
import A.j81b1gmr

open Axiom

open j81b1gmr

open CommunicativeArithmeticGuard

namespace ebwv9raa

def irreversible_authorization_commitment : Prop := ∀ (boundary : CommunicativeArithmeticGuard.Boundary) (backend : CommunicativeArithmeticGuard.Backend),
  CommunicativeArithmeticGuard.irreversible boundary →
    CommunicativeArithmeticGuard.authorized boundary backend → backend = CommunicativeArithmeticGuard.Backend.exact

def userAxiomsList : Axiom.Axioms :=
  [("irreversible_authorization_commitment", irreversible_authorization_commitment)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", userAxiomsList, 1786206384)

def userAxioms : Axiom.UserAxioms "hitchhiker2thefuture" 1786206384 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end ebwv9raa
