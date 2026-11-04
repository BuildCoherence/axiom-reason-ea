import Axiom
import A.t0d1zdc3
import A.gwcwyrvb

open t0d1zdc3
open gwcwyrvb

namespace snz0bnpj

namespace ActualLogic

class Applier (F : Prop) (T : outParam (Sort _)) where
  applyChain : LogicIsActual → A F → T

scoped instance (priority := 100) applierStep {p r : Prop} {T : Sort _} [Applier r T] :
    Applier (p → r) (A p → T) where
  applyChain h hpr := fun hp => Applier.applyChain h (h.mp _ _ hpr hp)

scoped instance (priority := 50) applierBase {q : Prop} : Applier q (A q) where
  applyChain _ hf := hf

def lift_actual (logic_is_actual : LogicIsActual) {F : Prop} {T : Sort _} [Applier F T] (f : F) : T :=
  Applier.applyChain logic_is_actual (logic_is_actual.actual_intro _ f)

def actual_and (logic_is_actual : LogicIsActual) {p q : Prop} (hp : A p) (hq : A q) : A (p ∧ q) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _ (fun (x : p) (y : q) => And.intro x y)) hp) hq

end ActualLogic

end snz0bnpj
