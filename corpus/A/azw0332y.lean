import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.d4qbfhxh
import A.vpg72gwr
import A.mbdw2246

open mbdw2246

open t0d1zdc3
open gwcwyrvb
open d4qbfhxh
open vpg72gwr.BFO (Entity)
open Dictionary

namespace azw0332y

namespace Information

def ConceptionsOriginateFromObservations : Prop :=
  A (∀ o : Observer, ∀ x : Type, ∀ c : Conception,
    Entity x →
    o observes x →
    Conceptualizes o x c →
    c is-a-combination-of InformationBits)

def ResultsInAProcess (x : Type) : Prop :=
  ∃ f : Function, x has-function f ∧ ∃ p : Process, HasRealization f p

def ToolHasGeneralProperties (x : Type) : Prop :=
  Tool.Is x ∧ x is-a-combination-of Conceptions ∧ ResultsInAProcess x

def Invention (x : Type) : Prop :=
  ToolHasGeneralProperties x ∧ DidNotExistBefore x

end Information

end azw0332y
