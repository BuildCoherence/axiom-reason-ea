import Axiom.Types.Actual
open Axiom

namespace t0d1zdc3

-- Bridge axioms that enable logically reasoning about what's Actual.
-- A bare (hp : p) means that p is logically true; that is, true
-- in all logically possibile worlds. We therefore use Actual p to
-- denote truths that are contigently true in the "actual world".
-- Note: Rejecting these axioms does not imply that one rejects
-- logic as a means to understand Actuality. By accepting these
-- axioms, you accept Lean 4's logic. Users who would prefer, for
-- example, a purely intuitionist logic would need to accept
-- alternative bridge axioms and not accept these ones.
structure LogicIsActual : Prop where
  -- That which is True logically is True Actually.
  actual_intro : ∀ p : Prop, p → Actual p
  -- Modus ponens at the actual world (the "K" axiom): if (p → q) is
  -- Actual and p is Actual, then q is Actual. The Actual-wrapped
  -- conditional is what makes this strong enough to chain multi-premise
  -- inferences whose rules are themselves Actual claims.
  mp : ∀ p q : Prop, Actual (p → q) → Actual p → Actual q
  -- Nothing that is inconsistent is Actually true.
  consistency : ¬ Actual False
  -- That which is actually True is actually actually True
  -- (and vise versa).
  idempotency : ∀ p : Prop, Actual p = Actual (Actual p)


end t0d1zdc3
