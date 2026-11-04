import A.vpg72gwr

open vpg72gwr.BFO

namespace jz5twd51

/-- `x` is an instance of universal `u` at time `t`. -/
class UniversalAt (u x t : Type) : Prop where
  mem : InstanceOf x u t

/-- Instance of `u` at `t`, and of its parent (via `parentAt`) at `t`. -/
class UniversalAtUnder (u : Type) (parentAt : Type → Type → Prop) (x t : Type) : Prop where
  mem : InstanceOf x u t
  parent : parentAt x t

/-- `x` is rigidly an instance of the universal with At-predicate `atPred`. -/
class RigidlyIs (atPred : Type → Type → Prop) (x : Type) : Prop where
  mem : ∀ t : Type, InstanceOf t TemporalRegion t → ExistsAt x t → atPred x t

/-- Rigid membership, plus rigid membership in the parent (via `parentIs`). -/
class RigidlyIsUnder (atPred : Type → Type → Prop) (parentIs : Type → Prop) (x : Type) : Prop where
  mem : ∀ t : Type, InstanceOf t TemporalRegion t → ExistsAt x t → atPred x t
  parent : parentIs x

end jz5twd51
