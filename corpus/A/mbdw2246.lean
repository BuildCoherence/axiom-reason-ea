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

namespace mbdw2246

namespace Dictionary

rigid universal Person extends Object := "person"
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

abbrev Conceptions : Type → Prop := Conception.Is
abbrev InformationBits : Type → Prop := Information.Is

def PhysicalReality : Type := "physical reality"
def MetaBias : Type := "the Axiom user MetaBias"

relation CorrespondTo : Belief → Prop := "corresponds to"
relation Does : Person → Action := "does"
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

def IsACombinationOf (whole : Type) (partIs : Type → Prop) : Prop :=
  ∃ p : Type, partIs p ∧ ConstituentOf p whole

scoped infixl:50 " corresponds-to " => CorrespondTo
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

namespace Observation

def RequiresObserver : Prop :=
  ∀ o : Observation, ∃ obs : Observer, obs observes o

end Observation

namespace Belief

def IsContradictory (b : Belief) : Prop :=
  ∃ p : Prop, (b corresponds-to p) ∧ (b corresponds-to ¬p)

def ContradictoryBeliefCharacterization : Prop :=
  ∀ b : Belief, ContradictoryBelief.Is b ↔ IsContradictory b

def BeliefsCanBeContradictory : Prop :=
  ∃ b : Belief, ∃ p : Prop, (b corresponds-to p) ∧ (b corresponds-to ¬p)

end Belief

scoped notation:50 a:51 " is-contradictory-belief " => Belief.IsContradictory a

namespace BeliefSystem

def ModelsPhysicalReality (k : BeliefSystem) : Prop :=
  ∃ b : Belief, (k includes b) ∧ (b is-conception-of PhysicalReality)

def IsContradictory (k : BeliefSystem) : Prop :=
  ∃ b : Belief, (k includes b) ∧ Belief.IsContradictory b

def IsEmpty (k : BeliefSystem) : Prop := ¬ ∃ b : Belief, k includes b

def Resolves (k' : BeliefSystem) (b : Belief) (k : BeliefSystem) : Prop :=
  (∃ p : Prop, (k includes b) ∧ (b corresponds-to p) ∧ (b corresponds-to ¬p)) ∧
  ¬ (∃ p : Prop, (k' includes b) ∧ (b corresponds-to p) ∧ (b corresponds-to ¬p))

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
  ∃ p : Prop, (per holds-belief b) ∧ (b corresponds-to p) ∧ (b corresponds-to ¬p)

end Person

scoped infixl:50 " adopts " => Person.Adopts
scoped infixl:50 " updates-belief-system-to " => Person.UpdatesBeliefSystemTo

end Dictionary

end mbdw2246
