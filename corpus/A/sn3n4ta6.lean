import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.vpg72gwr
import A.e4xks8h4

open e4xks8h4

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO
open vpg72gwr.BFO (Entity)
open Dictionary

namespace sn3n4ta6

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
  x is-tool ∧ x is-a-combination-of Conceptions ∧ ResultsInAProcess x

def Invention (x : Type) : Prop :=
  ToolHasGeneralProperties x ∧ DidNotExistBefore x

end Information

end sn3n4ta6
