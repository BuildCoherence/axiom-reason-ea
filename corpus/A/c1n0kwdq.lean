import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.mwh5b5da
import A.xhnxzf59
import A.d4qbfhxh
import A.vpg72gwr

open t0d1zdc3
open gwcwyrvb
open mwh5b5da
open xhnxzf59
open d4qbfhxh

namespace c1n0kwdq

namespace Dictionary

rigid universal Agent      extends IndependentContinuant := "agent"
rigid universal Person extends Agent := "person"
scoped instance : Coe Person Agent := ⟨fun p => ⟨p.val, p.property.parent⟩⟩
rigid universal Observer extends Object := "observer"
rigid universal Conception extends GenericallyDependentContinuant := "conception"
rigid universal Tool extends GenericallyDependentContinuant := "tool"
rigid universal Information extends GenericallyDependentContinuant := "information"
rigid universal Belief extends Conception := "belief"
rigid universal ContradictoryBelief extends Belief := "contradictory belief"
rigid universal Action extends Process := "action"
rigid universal Communication extends Process := "act of communication"
rigid universal Inference extends Process := "inference"
rigid universal BeliefSystem extends GenericallyDependentContinuant := "belief system"
rigid universal Observation extends Process := "observation"
rigid universal Capability extends Disposition := "capability"
rigid universal Skill      extends Object  := "skill"
rigid universal Outcome    extends Occurrent   := "outcome"
rigid universal Predisposition extends Disposition := "predisposition"
rigid universal State extends GenericallyDependentContinuant := "state"


abbrev Conceptions : Type → Prop := Conception.Is
abbrev InformationBits : Type → Prop := Information.Is

def PhysicalReality : Type := "physical reality"
def MetaBias : Type := "the Axiom user MetaBias"

relation BeliefCorrespondTo : Belief → Prop := "belief corresponds to"
relation IsEquivalentTo : Type → Type := "is equivalent to"
relation IsEqualTo : Type → Type := "is equal to"
relation Does : Agent → Action := "does"
relation Models : Type → Prop := "models"
relation IsConceptionOf : Belief → Type := "is conception of"
relation OwnerOf : Person → Communication := "is owner of"
relation RecipientOf : Person → Communication := "is recipient of"
relation Communicates : Communication → Belief := "communicates"
relation MoreExplicitThan : Communication → Communication := "is more explicit than"
relation DerivedFrom : Belief → Belief := "is derived from"
relation HoldsBelief : Person → Belief := "holds belief"
relation Concludes : Inference → Belief := "concludes"
relation Assumes : Inference → Belief := "assumes"
relation MoreCoherentThan : Inference → Inference := "is more coherent than"
relation Includes : BeliefSystem → Belief := "includes"
relation Informs : Observation → Belief := "informs"
relation Contains : Observation → Prop := "contains"
relation ObservationOf : Observation → Type := "is observation of"
relation ConstituentOf : Type → Type := "is a constituent of"
relation Observes : Observer → Type := "observes"
relation Conceptualizes : Observer → Type → Conception := "conceptualizes into"
relation HasFunction : Tool → Function := "has function"
relation MakesMistakes : Person := "makes mistakes"
relation ShouldWorkTowardCorrectingTheirMistakes : Person := "should work toward correcting their mistakes"
relation LacksKnowledgeAndUnderstanding : Person := "lacks knowledge and understanding"
relation IsManifestedBy        : Type → Process     := "is manifested by"
relation ResultsIn         : Process     → Outcome    := "results in"
relation PredisposedToward : Type → Type := "is predisposed toward"
relation InStateAt : Type → State → TemporalRegion := "is in state at time"
relation ActionIsFeasibleForAgentInState : Action → Agent → State          := "action is feasible for agent"
relation Yields    : State → Action → State  := "yields"
relation OccursAt : State → TemporalRegion := "occurs at"
def Elapses (t : Time) (s : State) (a : Action) (t' : Time) (s' : State) : Prop :=
  Yields s a s' ∧ Precedes t t' ∧ OccursAt s t ∧ OccursAt s' t'
def AgentDoesAction (agent : Agent) (a : Action) (s : State) (t : Time) (s' : State) (t' : Time) : Prop :=
  Does agent a ∧ Elapses t s a t' s'
relation OccursBefore : Type → Type := "occurs before"

def IsACombinationOf (whole : Type) (partIs : Type → Prop) : Prop :=
  ∃ p : Type, partIs p ∧ ConstituentOf p whole
def IsASetOf (whole : Type) (partIs : Type → Prop) : Prop :=
  ∀ p : Type, ConstituentOf p whole → partIs p
abbrev Predispositions : Type → Prop := Predisposition.Is
def Maladapted (α : Type 1) (x : α) : Prop := ("maladapted" : α → Prop) x
def issue_regarding (α : Type 1) (x : α) : Prop := ("issue regarding" : α → Prop) x

scoped infixl:50 " belief-corresponds-to " => BeliefCorrespondTo
scoped infixl:50 " is-equivalent-to " => IsEquivalentTo
scoped infixl:50 " does " => Does
scoped infixl:50 " models " => Models
scoped infixl:50 " is-conception-of " => IsConceptionOf
scoped infixl:50 " owner-of " => OwnerOf
scoped infixl:50 " recipient-of " => RecipientOf
scoped infixl:50 " communicates " => Communicates
scoped infixl:50 " more-explicit-than " => MoreExplicitThan
scoped infixl:50 " derived-from " => DerivedFrom
scoped infixl:50 " holds-belief " => HoldsBelief
scoped infixl:50 " concludes " => Concludes
scoped infixl:50 " assumes " => Assumes
scoped infixl:50 " more-coherent-than " => MoreCoherentThan
scoped infixl:50 " includes " => Includes
scoped infixl:50 " informs " => Informs
scoped infixl:50 " contains " => Contains
scoped infixl:50 " observation-of " => ObservationOf
scoped infixl:50 " observes " => Observes
scoped infixl:50 " has-function " => HasFunction
scoped infixl:50 " is-a-combination-of " => IsACombinationOf
scoped postfix:50 " makes-mistakes" => MakesMistakes
scoped postfix:50 " should-work-toward-correcting-their-mistakes" => ShouldWorkTowardCorrectingTheirMistakes
scoped postfix:50 " lacks-knowledge-and-understanding" => LacksKnowledgeAndUnderstanding
scoped infixl:50 " is-manifested-by " => IsManifestedBy
scoped infixl:50 " results-in " => ResultsIn
scoped infixl:50 " predisposed-toward " => PredisposedToward
scoped notation:50 x:51 " in-state " s:51 " at-time " t:51 => InStateAt x s t
scoped notation:50 a:51 " action-is-feasible-for-agent " agent:51 " in-state " s:51 => ActionIsFeasibleForAgentInState a agent s
scoped infixl:50 " is-a-set-of " => IsASetOf
scoped infixl:50 " occurs-before " => OccursBefore
scoped notation:50 agent:51 " agent-does " a:51 " from-state " s:51 " from-time " t:51 " which-elapses-to-state " s':51 " to-time " t':51 => AgentDoesAction agent a s t s' t'


namespace Observation

def RequiresObserver : Prop :=
  ∀ o : Observation, ∃ obs : Observer, obs observes o

end Observation

namespace Belief

def IsContradictory (b : Belief) : Prop :=
  ∃ p : Prop, (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p)

def ContradictoryBeliefCharacterization : Prop :=
  ∀ b : Belief, ContradictoryBelief.Is b ↔ IsContradictory b

def BeliefsCanBeContradictory : Prop :=
  ∃ b : Belief, ∃ p : Prop, (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p)

end Belief

scoped notation:50 a:51 " is-contradictory-belief " => Belief.IsContradictory a

namespace BeliefSystem

def ModelsPhysicalReality (k : BeliefSystem) : Prop :=
  ∃ b : Belief, (k includes b) ∧ (b is-conception-of PhysicalReality)

def IsContradictory (k : BeliefSystem) : Prop :=
  ∃ b : Belief, (k includes b) ∧ Belief.IsContradictory b

def IsEmpty (k : BeliefSystem) : Prop := ¬ ∃ b : Belief, k includes b

def Resolves (k' : BeliefSystem) (b : Belief) (k : BeliefSystem) : Prop :=
  (∃ p : Prop, (k includes b) ∧ (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p)) ∧
  ¬ (∃ p : Prop, (k' includes b) ∧ (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p))

end BeliefSystem

scoped notation:50 a:51 " resolves " b:51 " in-belief-system " c:51 => BeliefSystem.Resolves a b c
scoped notation:50 a:51 " is-contradictory-belief-system " => BeliefSystem.IsContradictory a
scoped notation:50 a:51 " is-belief-system-that-models-physical-reality " => BeliefSystem.ModelsPhysicalReality a
scoped notation:50 a:51 " is-empty-belief-system " => BeliefSystem.IsEmpty a

section descriptors

def DidNotExistBefore (x : Type) : Prop :=
  ∃ t : Time, ExistsAt x t ∧ ∃ t₀ : Time, Precedes t₀ t ∧ ¬ ExistsAt x t₀

end descriptors

namespace Person

relation Adopts : Person → BeliefSystem := "adopts"

def UpdatesBeliefSystemTo (per : Person) (k' : BeliefSystem) : Prop :=
  A (Adopts per k')

def HoldsContradiction (per : Type) (b : Belief) : Prop :=
  ∃ p : Prop, (per holds-belief b) ∧ (b belief-corresponds-to p) ∧ (b belief-corresponds-to ¬p)

end Person

scoped infixl:50 " adopts " => Person.Adopts
scoped infixl:50 " updates-belief-system-to " => Person.UpdatesBeliefSystemTo

end Dictionary

end c1n0kwdq
