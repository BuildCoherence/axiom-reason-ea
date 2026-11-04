import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.a52pkb71
import A.qszr71sj

open a52pkb71
open qszr71sj
open jz5twd51

open t0d1zdc3
open gwcwyrvb

namespace ay9krd84

universe u

relation Permissible : Prop := "permissible"
def Unnecessary : Sort u → Prop := "unnecessary"
relation Produces : Prop → Type := "produces"

relation CausesHarm : Prop := "causes harm"
relation CanExperience : Type := "can experience"
relation HasCNS : Type := "has CNS"
rigid universal Mammal extends Object := "mammal"
relation CausesEnslavementOf : Prop → Type := "causes enslavement of"

def EnslavementHarms := ∀ p : Prop, ∀ e : Type,
  CanExperience e → CausesEnslavementOf p e → CausesHarm p

def UnnecessaryHarmImpermissible := ∀ p : Prop,
  CausesHarm p → Unnecessary p → ¬ Permissible p

def UnnecessaryProduction := ∀ p : Prop, (∀ product : Type,
  Produces p product → Unnecessary product) → Unnecessary p

def AnimalAg21Cent : Prop := "doing animal agriculture in the 21st century"

def UnnecessaryAg := A (∀ product : Type,
  (Produces AnimalAg21Cent product → Unnecessary product))

def AgEnslavesMammals := A (∃ e : Type, Mammal.Is e ∧ CausesEnslavementOf AnimalAg21Cent e)

def CNSCanExperience := ∀ e : Type, HasCNS e → CanExperience e

def MammalsHaveCNS := ∀ e : Type, Mammal.Is e → HasCNS e

def MammalsCanExperience := ∀ e : Type, Mammal.Is e → CanExperience e

theorem mammals_can_experience
    (h₁ : CNSCanExperience) (h₂ : MammalsHaveCNS)
  : MammalsCanExperience := by
 intro e
 intro is_mammal
 exact h₁ e (h₂ e is_mammal)

theorem animal_ag_impermissible
    (logic_is_actual : LogicIsActual) (ag_unness : UnnecessaryAg) (ag_enslaves : AgEnslavesMammals)
    (cns_can_ex : CNSCanExperience) (mammal_cns : MammalsHaveCNS)
    (unness_harm_imperm : UnnecessaryHarmImpermissible) (unness_prod : UnnecessaryProduction)
    (slavery_harms : EnslavementHarms)
  : ¬ A (Permissible AnimalAg21Cent) := by
  have mammal_ex := mammals_can_experience cns_can_ex mammal_cns
  -- Harm: ag enslaves a mammal, mammals can experience, and enslaving an
  -- experiencer harms. Lift that whole inference and fire it at the actual
  -- enslavement fact (the witness stays inside the box — no Barcan needed).
  have harm_rule :
      (∃ e : Type, Mammal.Is e ∧ CausesEnslavementOf AnimalAg21Cent e) → CausesHarm AnimalAg21Cent :=
    fun ⟨e, hmam, hens⟩ => slavery_harms AnimalAg21Cent e (mammal_ex e hmam) hens
  have ag_harms : A (CausesHarm AnimalAg21Cent) :=
    logic_is_actual.mp _ _ (logic_is_actual.actual_intro _ harm_rule) ag_enslaves
  -- Unnecessary: everything ag produces is unnecessary, so ag is unnecessary.
  have ag_unnecessary : A (Unnecessary AnimalAg21Cent) :=
    logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _ (unness_prod AnimalAg21Cent)) ag_unness
  -- Unnecessary harm is impermissible.
  have ag_not_perm : A (¬ Permissible AnimalAg21Cent) :=
    logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _ (unness_harm_imperm AnimalAg21Cent)) ag_harms)
      ag_unnecessary
  -- Were it actually permissible, that would make False actual — impossible.
  intro ag_perm
  exact logic_is_actual.consistency (logic_is_actual.mp _ _ ag_not_perm ag_perm)

end ay9krd84
