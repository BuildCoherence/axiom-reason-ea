import Axiom

namespace j81b1gmr

namespace CommunicativeArithmeticGuard

inductive Boundary
  | internal
  | persisted
  | externalAction
  | humanReview

def irreversible : Boundary → Prop
  | .internal => False
  | .persisted => True
  | .externalAction => True
  | .humanReview => True

inductive Backend
  | fp32
  | exact

def selectedBackend : Boundary → Backend
  | .internal => .fp32
  | .persisted => .exact
  | .externalAction => .exact
  | .humanReview => .exact

def authorized (boundary : Boundary) (backend : Backend) : Prop :=
  backend = selectedBackend boundary

theorem irreversible_boundary_requires_exact
    (boundary : Boundary) (h : irreversible boundary) :
    selectedBackend boundary = Backend.exact := by
  cases boundary <;> simp [irreversible, selectedBackend] at h ⊢

theorem authorized_irreversible_output_is_exact
    (boundary : Boundary) (backend : Backend)
    (hIrreversible : irreversible boundary)
    (hAuthorized : authorized boundary backend) :
    backend = Backend.exact := by
  rw [hAuthorized]
  exact irreversible_boundary_requires_exact boundary hIrreversible

end CommunicativeArithmeticGuard

end j81b1gmr
