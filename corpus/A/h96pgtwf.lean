
namespace h96pgtwf
structure ModalWorld where
  holds : Prop → Prop
  intro : ∀ p, p → holds p
  mp : ∀ p q, holds (p → q) → holds p → holds q
  consistency : ¬ holds False
  elim : ∀ p, holds (holds p) = holds p


end h96pgtwf
