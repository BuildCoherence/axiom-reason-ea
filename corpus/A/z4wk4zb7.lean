import Axiom.Types.Actual
import Axiom.Types.SemanticStrings
import A.h96pgtwf
import A.gwcwyrvb
import A.a52pkb71

open a52pkb71
open jz5twd51

open h96pgtwf
open gwcwyrvb

open Axiom

namespace z4wk4zb7

-- The example claim we are formalizing.
def NazisWonUSASpeakGerman : Prop :=
  "if the Nazi's won WWII, German would be the official language of the USA in 2026"

namespace HypotheticalWorldExample

def NazisWon : Prop := "Nazis won WWII"

relation OccurredBefore1939 : Prop := "occurred before 1939"

def GermanOfficialLanguageUSA2026 : Prop :=
  "German is the official language of the USA in 2026"

structure NazisWonWWIIWorld extends ModalWorld where
  holds_eq : holds = ("world where Nazis won WWII" : Prop → Prop)
  nazis_won : holds NazisWon
  -- This world is a "fork" of the actual world.
  -- This Prop asserts it's the exact same as the actual world up until 1939.
  pre1939 : ∀ p, A p → A (OccurredBefore1939 p) → holds p

-- The more formal version of the example claim.
def NazisWonUSASpeakGerman :=
  ∀ w : NazisWonWWIIWorld, w.holds GermanOfficialLanguageUSA2026

end HypotheticalWorldExample

-- Optionally, one could assert that the semantic string is definitionally equal to the more formal version.
def NazisWonUSASpeakGermanDef : Prop :=
  NazisWonUSASpeakGerman = HypotheticalWorldExample.NazisWonUSASpeakGerman

end z4wk4zb7
