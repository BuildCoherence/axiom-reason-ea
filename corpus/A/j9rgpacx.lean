import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.v289fr59

open Axiom

open v289fr59

namespace j9rgpacx

def logic_is_actual : Prop := t0d1zdc3.LogicIsActual
def bfo : Prop := A j12bzjgj.BFO.BFO
def units_are_not_portions : Prop := A Sandwich.UnitsAreNotPortions
def hotdogs_have_unit_fillings : Prop := A Sandwich.HotdogsHaveUnitFillings

def userAxiomsList : Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("units_are_not_portions", units_are_not_portions), ("hotdogs_have_unit_fillings", hotdogs_have_unit_fillings)]

axiom user_axioms_auth : AuthenticatedTerm ("uksspy", userAxiomsList, 1783901275)

def userAxioms : UserAxioms "uksspy" 1783901275 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end j9rgpacx
