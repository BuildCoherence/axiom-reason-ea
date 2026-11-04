import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO

namespace v289fr59

namespace Sandwich

rigid universal Food extends Object := "food"
rigid universal Bread extends Object := "bread"
rigid universal Hotdog extends Food := "hotdog"

relation BreadOf : Bread "is the bread of" Food
relation FillingOf : MaterialEntity "is the filling of" Food
relation BoundsOnOpposingSurfaces : Bread "bounds on at least two opposing surfaces" MaterialEntity
relation PortionOfSubstance : MaterialEntity := "is a portion of a substance"
relation DiscretePreformedUnit : MaterialEntity := "is a discrete pre-formed unit"

infix:50 " is-the-bread-of " => BreadOf
infix:50 " is-the-filling-of " => FillingOf
infix:50 " bounds-on-opposing-surfaces " => BoundsOnOpposingSurfaces
postfix:50 " is-a-portion-of-a-substance" => PortionOfSubstance
postfix:50 " is-a-discrete-preformed-unit" => DiscretePreformedUnit

def Sandwich (food : Type) : Prop :=
  ∃ bread filling : Type,
    (bread is-the-bread-of food) ∧
    (filling is-the-filling-of food) ∧
    (bread bounds-on-opposing-surfaces filling) ∧
    (filling is-a-portion-of-a-substance)

def UnitsAreNotPortions : Prop :=
  ∀ x : Type, (x is-a-discrete-preformed-unit) → ¬ (x is-a-portion-of-a-substance)

def HotdogsHaveUnitFillings : Prop :=
  ∀ hotdog filling : Type,
    Hotdog.Is hotdog → (filling is-the-filling-of hotdog) →
      (filling is-a-discrete-preformed-unit)

def NoHotdogIsASandwich : Prop :=
  ∀ hotdog : Type, Hotdog.Is hotdog → ¬ Sandwich hotdog

theorem no_hotdog_is_a_sandwich
    (logic_is_actual : LogicIsActual)
    (units_are_not_portions : A UnitsAreNotPortions)
    (hotdogs_have_unit_fillings : A HotdogsHaveUnitFillings) :
    A NoHotdogIsASandwich :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun unp hhuf hotdog hotdog_is h => by
          obtain ⟨_bread, filling, _bread_of, filling_of, _bounds, portion⟩ := h
          exact unp filling (hhuf hotdog filling hotdog_is filling_of) portion))
      units_are_not_portions)
    hotdogs_have_unit_fillings

end Sandwich

end v289fr59
