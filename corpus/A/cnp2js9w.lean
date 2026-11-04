import A.c424c6bg
import A.jz5twd51

open jz5twd51

namespace cnp2js9w

/-- The V2 classifier classes coincide with `c424c6bg`'s: both are transparent
    wrappers over bfo-raw's shared `InstanceOf`, so V1↔V2 universals and
    relations are provably equivalent, not merely bridged by an axiom. -/

theorem universalAt_bridge (u x t : Type) :
    UniversalAt u x t ↔ c424c6bg.UniversalAt u x t :=
  ⟨fun h => ⟨h.mem⟩, fun h => ⟨h.mem⟩⟩

theorem universalAtUnder_bridge (u : Type) (parentAt : Type → Type → Prop) (x t : Type) :
    UniversalAtUnder u parentAt x t ↔ c424c6bg.UniversalAtUnder u parentAt x t :=
  ⟨fun h => ⟨h.mem, h.parent⟩, fun h => ⟨h.mem, h.parent⟩⟩

theorem rigidlyIs_bridge (atPred : Type → Type → Prop) (x : Type) :
    RigidlyIs atPred x ↔ c424c6bg.RigidlyIs atPred x :=
  ⟨fun h => ⟨h.mem⟩, fun h => ⟨h.mem⟩⟩

theorem rigidlyIsUnder_bridge (atPred : Type → Type → Prop) (parentIs : Type → Prop) (x : Type) :
    RigidlyIsUnder atPred parentIs x ↔ c424c6bg.RigidlyIsUnder atPred parentIs x :=
  ⟨fun h => ⟨h.mem, h.parent⟩, fun h => ⟨h.mem, h.parent⟩⟩

end cnp2js9w
