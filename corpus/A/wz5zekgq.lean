import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO

namespace wz5zekgq

namespace HumanLifeMoralWorth

rigid universal HumanOrganism extends Object := "living human organism"
rigid universal Fertilization extends Process := "fertilization"
rigid universal Death extends Process := "death"

relation HasInherentMoralWorth : HumanOrganism :=
  "has inherent moral worth regardless of developmental stage, size, ability, health, or dependence"
relation HasSeriousMoralClaimNotToBeIntentionallyKilledAt : HumanOrganism → TemporalRegion :=
  "has a serious moral claim not to be intentionally killed at"

def CompletesAt (p : Process) (i : TemporalInstant) : Prop :=
  ∃ tr : TemporalRegion, ProcessOccupiesTemporalRegion p tr ∧ HasLastInstant tr i

def IsBetweenInclusive (t start finish : TemporalInstant) : Prop :=
  ¬ Precedes t start ∧ ¬ Precedes finish t

def ExistsFromFertilizationToDeath (h : HumanOrganism) (f : Fertilization) (d : Death) : Prop :=
  ∃ conception termination : TemporalInstant,
    CompletesAt f conception ∧ CompletesAt d termination ∧
      ∀ t : TemporalInstant, ExistsAt h t ↔ IsBetweenInclusive t conception termination

def HumanOrganismsExistFromFertilizationToDeath : Prop :=
  ∀ h : HumanOrganism, ∃ f : Fertilization, ∃ d : Death,
    ExistsFromFertilizationToDeath h f d

def EveryHumanOrganismHasInherentMoralWorth : Prop :=
  ∀ h : HumanOrganism, HasInherentMoralWorth h

def InherentMoralWorthGivesClaimWheneverItExists : Prop :=
  ∀ h : HumanOrganism, ∀ t : Time,
    HasInherentMoralWorth h → ExistsAt h t →
      HasSeriousMoralClaimNotToBeIntentionallyKilledAt h t

def EveryHumanOrganismIsProtectedWheneverItExists : Prop :=
  ∀ h : HumanOrganism, ∀ t : Time,
    ExistsAt h t → HasSeriousMoralClaimNotToBeIntentionallyKilledAt h t

def EveryHumanOrganismIsProtectedFromFertilizationToDeath : Prop :=
  ∀ h : HumanOrganism, ∃ f : Fertilization, ∃ d : Death,
    ∃ conception termination : TemporalInstant,
      CompletesAt f conception ∧ CompletesAt d termination ∧
        ∀ t : TemporalInstant, IsBetweenInclusive t conception termination →
          HasSeriousMoralClaimNotToBeIntentionallyKilledAt h t

theorem human_organism_protected_from_fertilization_to_death
    (logic_is_actual : LogicIsActual)
    (human_organisms_exist_from_fertilization_to_death :
      A HumanOrganismsExistFromFertilizationToDeath)
    (every_human_organism_has_inherent_moral_worth :
      A EveryHumanOrganismHasInherentMoralWorth)
    (inherent_moral_worth_gives_claim_whenever_it_exists :
      A InherentMoralWorthGivesClaimWheneverItExists) :
    A EveryHumanOrganismIsProtectedFromFertilizationToDeath := by
  exact
    logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.mp _ _
          (logic_is_actual.actual_intro _
            (by
              intro exist hasWorth worthGivesClaim h
              obtain ⟨f, d, conception, termination, hFert, hDeath, hExistsIff⟩ := exist h
              refine ⟨f, d, conception, termination, hFert, hDeath, ?_⟩
              intro t hBetween
              exact worthGivesClaim h t (hasWorth h) ((hExistsIff t).mpr hBetween)))
          human_organisms_exist_from_fertilization_to_death)
        every_human_organism_has_inherent_moral_worth)
      inherent_moral_worth_gives_claim_whenever_it_exists

end HumanLifeMoralWorth

end wz5zekgq
