import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO

namespace mnpz4yrv

namespace HumanLifeMoralWorth

rigid universal HumanOrganism extends Object := "living human organism"
rigid universal Fertilization extends Process := "fertilization"

relation BeginsToExistWhenFertilizationIsComplete :
  HumanOrganism → Fertilization := "begins to exist when fertilization is complete"
relation HasInherentMoralWorth : HumanOrganism :=
  "has inherent moral worth regardless of developmental stage, size, ability, health, or dependence"
relation HasSeriousMoralClaimNotToBeIntentionallyKilled : HumanOrganism :=
  "has a serious moral claim not to be intentionally killed"

def FertilizationBeginsHumanOrganismExistence : Prop :=
  ∀ h : HumanOrganism, ∃ f : Fertilization,
    BeginsToExistWhenFertilizationIsComplete h f

def EveryHumanOrganismHasInherentMoralWorth : Prop :=
  ∀ h : HumanOrganism, HasInherentMoralWorth h

def InherentMoralWorthGivesSeriousClaimNotToBeIntentionallyKilled : Prop :=
  ∀ h : HumanOrganism,
    HasInherentMoralWorth h →
      HasSeriousMoralClaimNotToBeIntentionallyKilled h

def EveryHumanOrganismHasSeriousMoralClaimFromFertilization : Prop :=
  ∀ h : HumanOrganism,
    (∃ f : Fertilization, BeginsToExistWhenFertilizationIsComplete h f) ∧
      HasSeriousMoralClaimNotToBeIntentionallyKilled h

theorem human_organism_has_serious_moral_claim_from_fertilization
    (logic_is_actual : LogicIsActual)
    (fertilization_begins_human_organism_existence :
      A FertilizationBeginsHumanOrganismExistence)
    (every_human_organism_has_inherent_moral_worth :
      A EveryHumanOrganismHasInherentMoralWorth)
    (inherent_moral_worth_gives_serious_claim_not_to_be_intentionally_killed :
      A InherentMoralWorthGivesSeriousClaimNotToBeIntentionallyKilled) :
    A EveryHumanOrganismHasSeriousMoralClaimFromFertilization := by
  exact
    logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.mp _ _
          (logic_is_actual.actual_intro _
            (by
              intro begins hasWorth worthGivesClaim h
              exact ⟨begins h, worthGivesClaim h (hasWorth h)⟩))
          fertilization_begins_human_organism_existence)
        every_human_organism_has_inherent_moral_worth)
      inherent_moral_worth_gives_serious_claim_not_to_be_intentionally_killed

end HumanLifeMoralWorth

end mnpz4yrv
