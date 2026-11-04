import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.vpg72gwr

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO
open vpg72gwr.BFO (Entity)

namespace xmafsdvf

namespace Information

rigid universal Observer extends Object := "observer"
rigid universal Conception extends GenericallyDependentContinuant := "conception"
rigid universal Tool extends GenericallyDependentContinuant := "tool"

rigid universal Information extends GenericallyDependentContinuant := "information"

relation ConstituentOf : Type → Type := "is a constituent of"

def IsACombinationOf (whole : Type) (partIs : Type → Prop) : Prop :=
  ∃ p : Type, partIs p ∧ ConstituentOf p whole

abbrev Conceptions : Type → Prop := Conception.Is
abbrev InformationBits : Type → Prop := Information.Is

relation Observes : Observer → Type := "observes"
relation Conceptualizes : Observer → Type → Conception := "conceptualizes into"
relation HasFunction : Tool → Function := "has function"

infixl:50 " observes " => Observes
infixl:50 " is-a-combination-of " => IsACombinationOf
infixl:50 " has-function " => HasFunction

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

def DidNotExistBefore (x : Type) : Prop :=
  ∃ t : Time, ExistsAt x t ∧ ∃ t₀ : Time, Precedes t₀ t ∧ ¬ ExistsAt x t₀

def Invention (x : Type) : Prop :=
  ToolHasGeneralProperties x ∧ DidNotExistBefore x

end Information

end xmafsdvf
