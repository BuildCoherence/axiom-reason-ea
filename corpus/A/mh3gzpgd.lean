import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.azt4989z
import A.sn3n4ta6
import A.e4xks8h4

open sn3n4ta6
open e4xks8h4

open t0d1zdc3
open gwcwyrvb
open azt4989z
open Information
open Dictionary

namespace mh3gzpgd

namespace AxiomaticThinking

theorem actuality_not_contradictory (logic_is_actual : LogicIsActual) :
    ∀ q : Prop, ¬ (A q ∧ A (¬ q)) := by
  intro q hq
  exact logic_is_actual.consistency (logic_is_actual.mp q False hq.2 hq.1)

def RealWorldBeliefsModelActuality : Prop :=
  ∀ b : Belief, ∀ q : Prop,
    (b is-conception-of PhysicalReality) → (b corresponds-to q) → b models (A q)

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
  ∀ (o : Observation) (b : Belief) (p : Prop), (o informs b) → (o contains p) → (b corresponds-to p)

theorem observation_can_surface_contradiction
    (observations_correspond_to_prop : ObservationsCorrespondToAProposition)
    (b : Belief) (p : Prop) (hbnp : b corresponds-to ¬p)
    (o : Observation) (hinf : o informs b) (hcont : o contains p) :
    (b corresponds-to p) ∧ (b corresponds-to ¬p) :=
  ⟨observations_correspond_to_prop o b p hinf hcont, hbnp⟩

theorem observations_can_update_beliefs_if_person_chooses
    (observations_correspond_to_prop : ObservationsCorrespondToAProposition)
    (per : Person)
    (k : BeliefSystem) (b : Belief) (hib : k includes b)
    (p : Prop) (hbnp : b corresponds-to ¬p)
    (o : Observation) (hinf : o informs b) (hcont : o contains p)
    (k' : BeliefSystem) (h' : k' is-empty-belief-system)
    (hchoose : per updates-belief-system-to k') :
    (∃ b' : Belief, k' resolves b' in-belief-system k) ∧ A (per adopts k') := by
  obtain ⟨hcp, _⟩ :=
    observation_can_surface_contradiction observations_correspond_to_prop b p hbnp o hinf hcont
  exact ⟨empty_belief_system_resolves_contradictions k ⟨b, hib, p, hcp, hbnp⟩ k' h', hchoose⟩

theorem observations_dont_update_beliefs_if_person_doesnt_choose
    (observations_correspond_to_prop : ObservationsCorrespondToAProposition)
    (per : Person)
    (k : BeliefSystem) (b : Belief) (hib : k includes b)
    (p : Prop) (hbnp : b corresponds-to ¬p)
    (o : Observation) (hinf : o informs b) (hcont : o contains p)
    (k' : BeliefSystem) (h' : k' is-empty-belief-system)
    (hnochoose : ¬ (per updates-belief-system-to k')) :
    (∃ b' : Belief, k' resolves b' in-belief-system k) ∧ ¬ A (per adopts k') := by
  obtain ⟨hcp, _⟩ :=
    observation_can_surface_contradiction observations_correspond_to_prop b p hbnp o hinf hcont
  exact ⟨empty_belief_system_resolves_contradictions k ⟨b, hib, p, hcp, hbnp⟩ k' h', hnochoose⟩

end AxiomaticThinking

end mh3gzpgd
