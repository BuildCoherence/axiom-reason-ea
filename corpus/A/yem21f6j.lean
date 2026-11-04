import Axiom
import A.warhrjns
import A.t0d1zdc3
import A.ta3nj1a4

open Axiom

open t0d1zdc3
open ta3nj1a4

namespace yem21f6j

def god_is_good_th63w6tq : Prop := warhrjns.god_is_good
def logic_is_actual : Prop := LogicIsActual
def bfo : Prop := Axiom.Actual BFO

def userAxiomsList : Axiom.Axioms :=
  [("god_is_good_th63w6tq", god_is_good_th63w6tq), ("logic_is_actual", logic_is_actual), ("bfo", bfo)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("omar-shehata", userAxiomsList, 1787675438)

def userAxioms : Axiom.UserAxioms "omar-shehata" 1787675438 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end yem21f6j
