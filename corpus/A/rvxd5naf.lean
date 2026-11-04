import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.snz0bnpj
import A.azw0332y
import A.g0c1njxx

open snz0bnpj
open azw0332y
open g0c1njxx

open t0d1zdc3
open gwcwyrvb
open ActualLogic
open Information
open Dictionary

namespace rvxd5naf

namespace AxiomaticThinking

theorem actuality_not_contradictory (logic_is_actual : LogicIsActual) :
    ∀ q : Prop, ¬ (A q ∧ A (¬ q)) := by
  intro q hq
  exact logic_is_actual.consistency (logic_is_actual.mp q False hq.2 hq.1)

def RealWorldBeliefsModelActuality : Prop :=
  ∀ b : Belief, ∀ q : Prop,
    (b is-conception-of PhysicalReality) → (b belief-corresponds-to q) → b models (A q)

theorem empty_belief_system_resolves_contradictions
    (k : BeliefSystem) (hk : k is-contradictory-belief-system)
    (k' : BeliefSystem) (h' : k' is-empty-belief-system) :
    ∃ b : Belief, k' resolves b in-belief-system k := by
  obtain ⟨b, hib, p, hcp, hcnp⟩ := hk
  refine ⟨b, ⟨p, hib, hcp, hcnp⟩, ?_⟩
  rintro ⟨p', hib', _, _⟩
  exact h' ⟨b, hib'⟩

def ObservationCanInformBelief : Prop :=
  ∃ b : Belief, (b is-conception-of PhysicalReality) ∧ ∃ o : Observation, o informs b

def ObservationsCorrespondToAProposition : Prop :=
  ∀ (o : Observation) (b : Belief) (p : Prop), (o informs b) → (o contains p) → (b belief-corresponds-to p)

theorem observation_can_surface_contradiction
    (observations_correspond_to_prop : ObservationsCorrespondToAProposition)
    (b : Belief) (p : Prop) (hbnp : b belief-corresponds-to ¬p)
    (o : Observation) (hinf : o informs b) (hcont : o contains p) :
    (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p) :=
  ⟨observations_correspond_to_prop o b p hinf hcont, hbnp⟩

theorem observation_resolves_contradiction_in_empty_system
    (k k' : BeliefSystem) (b : Belief) (p : Prop) (o : Observation)
    (observations_correspond_to_prop : ObservationsCorrespondToAProposition)
    (hib : k includes b) (hbnp : b belief-corresponds-to ¬p)
    (hinf : o informs b) (hcont : o contains p)
    (hempty : k' is-empty-belief-system) :
    ∃ b' : Belief, k' resolves b' in-belief-system k := by
  obtain ⟨hcp, _⟩ :=
    observation_can_surface_contradiction observations_correspond_to_prop b p hbnp o hinf hcont
  exact empty_belief_system_resolves_contradictions k ⟨b, hib, p, hcp, hbnp⟩ k' hempty

theorem observations_can_update_beliefs_if_person_chooses
    (logic_is_actual : LogicIsActual)
    (observations_correspond_to_prop : A ObservationsCorrespondToAProposition)
    (per : Person)
    (k : BeliefSystem) (b : Belief) (hib : A (k includes b))
    (p : Prop) (hbnp : A (b belief-corresponds-to ¬p))
    (o : Observation) (hinf : A (o informs b)) (hcont : A (o contains p))
    (k' : BeliefSystem) (hempty : A (k' is-empty-belief-system))
    (hchoose : per updates-belief-system-to k') :
    A ((∃ b' : Belief, k' resolves b' in-belief-system k) ∧ per adopts k') :=
  let hresolve : A (∃ b' : Belief, k' resolves b' in-belief-system k) :=
    lift_actual logic_is_actual (observation_resolves_contradiction_in_empty_system k k' b p o)
      observations_correspond_to_prop hib hbnp hinf hcont hempty
  actual_and logic_is_actual hresolve hchoose

theorem observations_dont_update_beliefs_if_person_doesnt_choose
    (logic_is_actual : LogicIsActual)
    (observations_correspond_to_prop : A ObservationsCorrespondToAProposition)
    (per : Person)
    (k : BeliefSystem) (b : Belief) (hib : A (k includes b))
    (p : Prop) (hbnp : A (b belief-corresponds-to ¬p))
    (o : Observation) (hinf : A (o informs b)) (hcont : A (o contains p))
    (k' : BeliefSystem) (hempty : A (k' is-empty-belief-system))
    (hnochoose : ¬ (per updates-belief-system-to k')) :
    A (∃ b' : Belief, k' resolves b' in-belief-system k) ∧ ¬ A (per adopts k') :=
  ⟨lift_actual logic_is_actual (observation_resolves_contradiction_in_empty_system k k' b p o)
      observations_correspond_to_prop hib hbnp hinf hcont hempty,
    hnochoose⟩

end AxiomaticThinking

end rvxd5naf
