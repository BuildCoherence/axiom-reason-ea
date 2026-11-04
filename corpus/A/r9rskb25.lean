import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.r59jf3ak

open ta3nj1a4
open r59jf3ak

-- Dennis Hackethal: https://veritula.com/ideas/2281-rational-decision-making-expanding-on-2112

open t0d1zdc3

namespace r9rskb25

rigid universal RationalAgent extends Object := "rational agent"
rigid universal Idea extends GenericallyDependentContinuant := "idea"

relation Criticizes : Idea "criticizes" Idea
relation AwareOf : RationalAgent "is aware of" Idea "at" TemporalRegion
relation PendingFor : Idea "is a criticism of" Idea "pending for" RationalAgent "at" TemporalRegion
relation Prescribes : Idea "prescribes" Prop
relation Adopts : RationalAgent "adopts" Idea "at" TemporalRegion
relation ActsTowards : RationalAgent "acts towards" Prop "at" TemporalRegion

def NoActionableContent : Type → Type :=
  "the criticism that {0} prescribes no proposition to act towards"

def PendingCharacterization : Prop :=
  ∀ a c i t : Type, PendingFor c i a t ↔
    (Criticizes c i ∧ AwareOf a c t ∧ ¬ ∃ cc : Type, PendingFor cc c a t)

def AdoptIffUncriticized : Prop :=
  ∀ a i t : Type, Adopts a i t ↔
    (AwareOf a i t ∧ ¬ ∃ c : Type, PendingFor c i a t)

def AdoptionGuidesAction : Prop :=
  ∀ a i t : Type, ∀ p : Prop, Adopts a i t → Prescribes i p → ActsTowards a p t

def PrescribingNothingIsCriticized : Prop :=
  ∀ i : Type, Idea.Is i → (¬ ∃ p : Prop, Prescribes i p) →
    Idea.Is (NoActionableContent i) ∧ Criticizes (NoActionableContent i) i

def PendingCriticismBlocksAdoption : Prop :=
  ∀ a i t : Type, (∃ c : Type, PendingFor c i a t) → ¬ Adopts a i t

def UncriticizedIdeasGuideAction : Prop :=
  ∀ a i t : Type, ∀ p : Prop, AwareOf a i t → (¬ ∃ c : Type, PendingFor c i a t) →
    Prescribes i p → ActsTowards a p t

def NoPendingIffEveryKnownCriticismCountered : Prop :=
  ∀ a i t : Type, (¬ ∃ c : Type, PendingFor c i a t) ↔
    (∀ c : Type, Criticizes c i → AwareOf a c t → ∃ cc : Type, PendingFor cc c a t)

theorem no_pending_iff_every_known_criticism_countered
    (logic_is_actual : LogicIsActual)
    (pending_characterization : A PendingCharacterization) :
    A NoPendingIffEveryKnownCriticismCountered :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _
      (fun pc a i t =>
        Iff.intro
          (fun no_pending c crit aware =>
            Classical.byContradiction fun uncountered =>
              no_pending ⟨c, (pc a c i t).mpr ⟨crit, aware, uncountered⟩⟩)
          (fun countered has_pending =>
            has_pending.elim fun c hp =>
              let h := (pc a c i t).mp hp
              h.2.2 (countered c h.1 h.2.1))))
    pending_characterization

theorem pending_criticism_blocks_adoption
    (logic_is_actual : LogicIsActual)
    (adoption : A AdoptIffUncriticized) :
    A PendingCriticismBlocksAdoption :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _
      (fun ad a i t has_pending adopted =>
        ((ad a i t).mp adopted).2 has_pending))
    adoption

theorem uncriticized_ideas_guide_action
    (logic_is_actual : LogicIsActual)
    (adoption : A AdoptIffUncriticized)
    (action : A AdoptionGuidesAction) :
    A UncriticizedIdeasGuideAction :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun ad ac a i t p aware no_pending prescribes =>
          ac a i t p ((ad a i t).mpr ⟨aware, no_pending⟩) prescribes))
      adoption)
    action

def NoWitnessedSolitarySelfCriticism : Prop :=
  ∀ a c t : Type, Criticizes c c → AwareOf a c t →
    (∀ x : Type, Criticizes x c → x = c) → False

theorem no_witnessed_solitary_self_criticism
    (logic_is_actual : LogicIsActual)
    (pending_characterization : A PendingCharacterization) :
    A NoWitnessedSolitarySelfCriticism :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro
      (PendingCharacterization → NoWitnessedSolitarySelfCriticism)
      (fun pc a c t self_crit aware only_self =>
        have not_pending : ¬ PendingFor c c a t := fun hp =>
          ((pc a c c t).mp hp).2.2 ⟨c, hp⟩
        have some_pending : ∃ cc : Type, PendingFor cc c a t :=
          Classical.byContradiction fun none_pending =>
            not_pending ((pc a c c t).mpr ⟨self_crit, aware, none_pending⟩)
        some_pending.elim fun cc hpcc =>
          not_pending (only_self cc ((pc a cc c t).mp hpcc).1 ▸ hpcc)))
    pending_characterization

def NoSymmetricStandoff : Prop :=
  ∀ a i j t : Type,
    Criticizes i j → Criticizes j i →
    AwareOf a i t → AwareOf a j t →
    (∀ x : Type, Criticizes x i → x = j) →
    (∀ x : Type, Criticizes x j → x = i) →
    (PendingFor i j a t ↔ PendingFor j i a t) →
    False

theorem no_symmetric_standoff
    (logic_is_actual : LogicIsActual)
    (pending_characterization : A PendingCharacterization) :
    A NoSymmetricStandoff :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro
      (PendingCharacterization → NoSymmetricStandoff)
      (fun pc a i j t _ cji _ awj _ solj symm =>
        have flip : PendingFor j i a t ↔ ¬ PendingFor i j a t :=
          Iff.intro
            (fun hP hQ => ((pc a j i t).mp hP).2.2 ⟨i, hQ⟩)
            (fun hnQ => (pc a j i t).mpr ⟨cji, awj,
              fun hex => hex.elim fun cc hcc =>
                hnQ (solj cc ((pc a cc j t).mp hcc).1 ▸ hcc)⟩)
        have self_deny : PendingFor i j a t ↔ ¬ PendingFor i j a t :=
          symm.trans flip
        have not_pending : ¬ PendingFor i j a t :=
          fun hQ => self_deny.mp hQ hQ
        not_pending (self_deny.mpr not_pending)))
    pending_characterization

def NoForgoingUncriticizedIdeas : Prop :=
  ∀ a j t : Type, AwareOf a j t → (¬ ∃ c : Type, PendingFor c j a t) →
    ¬ Adopts a j t → False

theorem no_forgoing_uncriticized_ideas
    (logic_is_actual : LogicIsActual)
    (adoption : A AdoptIffUncriticized) :
    A NoForgoingUncriticizedIdeas :=
  logic_is_actual.mp _ _
    (logic_is_actual.actual_intro
      (AdoptIffUncriticized → NoForgoingUncriticizedIdeas)
      (fun ad a j t aware no_pending forgone =>
        forgone ((ad a j t).mpr ⟨aware, no_pending⟩)))
    adoption

end r9rskb25
