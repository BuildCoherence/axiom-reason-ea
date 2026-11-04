import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.r59jf3ak
import A.nrhqjxz5

open a4hsz51v
open nrhqjxz5

open ta3nj1a4
open r59jf3ak
open t0d1zdc3

namespace wwy58mpt

relation HasClearerThought : Person := "has clearer thought"
relation HasBetterDecisionMaking : Person := "has better decision-making"
relation CanChooseMoreEffectiveCoursesOfAction : Person :=
  "can choose more effective courses of action"
relation HasGreaterPotential : Person := "has greater potential"

scoped postfix:max " has-clearer-thought" => HasClearerThought
scoped postfix:max " has-better-decision-making" => HasBetterDecisionMaking
scoped postfix:max " can-choose-more-effective-courses-of-action" =>
  CanChooseMoreEffectiveCoursesOfAction
scoped postfix:max " has-greater-potential" => HasGreaterPotential

theorem clearer_thought_means_greater_potential
    (clearer_thought_improves_decision_making :
      ∀ p : Person, p has-clearer-thought → p has-better-decision-making)
    (better_decision_making_enables_effective_choice :
      ∀ p : Person,
        p has-better-decision-making →
          p can-choose-more-effective-courses-of-action)
    (effective_choice_is_greater_potential :
      ∀ p : Person,
        p can-choose-more-effective-courses-of-action →
          p has-greater-potential) :
    ∀ p : Person, p has-clearer-thought → p has-greater-potential := by
  intro p clearer
  exact effective_choice_is_greater_potential p
    (better_decision_making_enables_effective_choice p
      (clearer_thought_improves_decision_making p clearer))

theorem actually_clearer_thought_means_greater_potential
    (logic_is_actual : LogicIsActual)
    (clearer_thought_improves_decision_making : A (∀ p : Person, p has-clearer-thought → p has-better-decision-making))
    (better_decision_making_enables_effective_choice : A (∀ p : Person, p has-better-decision-making → p can-choose-more-effective-courses-of-action))
    (effective_choice_is_greater_potential : A (∀ p : Person, p can-choose-more-effective-courses-of-action → p has-greater-potential)) :
    A (∀ p : Person, p has-clearer-thought → p has-greater-potential) := by
  have theorem_is_actual :
      A ((∀ p : Person, p has-clearer-thought → p has-better-decision-making) →
        (∀ p : Person,
          p has-better-decision-making →
            p can-choose-more-effective-courses-of-action) →
          (∀ p : Person,
            p can-choose-more-effective-courses-of-action →
              p has-greater-potential) →
            ∀ p : Person, p has-clearer-thought → p has-greater-potential) :=
    logic_is_actual.actual_intro _ clearer_thought_means_greater_potential
  have after_clearer_thought :
      A ((∀ p : Person,
        p has-better-decision-making →
          p can-choose-more-effective-courses-of-action) →
        (∀ p : Person,
          p can-choose-more-effective-courses-of-action →
            p has-greater-potential) →
          ∀ p : Person, p has-clearer-thought → p has-greater-potential) :=
    logic_is_actual.mp _ _ theorem_is_actual
      clearer_thought_improves_decision_making
  have after_decision_making :
      A ((∀ p : Person,
        p can-choose-more-effective-courses-of-action →
          p has-greater-potential) →
        ∀ p : Person, p has-clearer-thought → p has-greater-potential) :=
    logic_is_actual.mp _ _ after_clearer_thought
      better_decision_making_enables_effective_choice
  exact logic_is_actual.mp _ _ after_decision_making
    effective_choice_is_greater_potential

end wwy58mpt
