import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.r59jf3ak
import A.nrhqjxz5

open nrhqjxz5

namespace qg6hprvj

namespace Parenting

open a4hsz51v

open ta3nj1a4
open r59jf3ak

open t0d1zdc3

universal YoungParent extends Person := "parent of a young child"

relation ObligatedTo : Person "is obligated to bring it about that" Prop
relation CanBringAbout : Person "is able to bring it about that" Prop
relation HypervigilantAt : Person "is in a state of hypervigilance at" TemporalRegion
relation CalmAt : Person "is in a state of physiological calm at" TemporalRegion

scoped notation:50 x:51 " obligated-to " q:51 => ObligatedTo x q
scoped notation:50 x:51 " can-bring-about " q:51 => CanBringAbout x q
scoped notation:50 x:51 " hypervigilant-at " t:51 => HypervigilantAt x t
scoped notation:50 x:51 " calm-at " t:51 => CalmAt x t

def CalmHypervigilanceParentingStandard : Prop :=
  ∀ p t, YoungParent.At p t → p obligated-to (p calm-at t ∧ p hypervigilant-at t)

theorem calm_hypervigilance_standard_refuted
    (ought_implies_can : ∀ p q, p obligated-to q → p can-bring-about q)
    (incompatible_psych_states : ∀ p t, ¬ (p can-bring-about (p calm-at t ∧ p hypervigilant-at t)))
    (some_young_parent : ∃ p t, YoungParent.At p t)
  : ¬ CalmHypervigilanceParentingStandard := by
  intro std
  obtain ⟨p, t, h⟩ := some_young_parent
  exact incompatible_psych_states p t (ought_implies_can p _ (std p t h))

theorem calm_hypervigilance_standard_asserted_is_false
    (logic_is_actual : LogicIsActual)
    (ought_implies_can : ∀ p q, p obligated-to q → p can-bring-about q)
    (incompatible_psych_states : A (∀ p t, ¬ (p can-bring-about (p calm-at t ∧ p hypervigilant-at t))))
    (some_young_parent : A (∃ p t, YoungParent.At p t))
    (parents_must_be_calm_and_hyperviligant : A CalmHypervigilanceParentingStandard)
  : False :=
  logic_is_actual.consistency
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.mp _ _
          (logic_is_actual.actual_intro _
            (fun incompat some_yp std =>
              calm_hypervigilance_standard_refuted ought_implies_can incompat some_yp std))
          incompatible_psych_states)
        some_young_parent)
      parents_must_be_calm_and_hyperviligant)

end Parenting

end qg6hprvj
