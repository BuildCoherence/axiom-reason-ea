import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj
import A.azt4989z
import A.xmafsdvf
import A.rwj5ranz

open xmafsdvf
open rwj5ranz

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg
open BFO
open azt4989z
open Information

namespace z85jhy92

namespace AxiomaticThinking

rigid universal Belief extends Conception := "belief"
rigid universal Action extends Process := "action"

relation Affirms : Belief → Prop := "affirms"
relation Does : Person → Action := "does"
relation Models : Belief → Prop := "models"
relation IsConceptionOf : Belief → Type := "is conception of"

scoped infixl:50 " affirms " => Affirms
scoped infixl:50 " does " => Does
scoped infixl:50 " models " => Models
scoped infixl:50 " is-conception-of " => IsConceptionOf

def PhysicalReality : Type := "physical reality"

def BeliefCanBeContradictory : Prop :=
  ∃ b : Belief, ∃ p : Prop, (b affirms p) ∧ (b affirms ¬p)

theorem actuality_not_contradictory (logic_is_actual : LogicIsActual) :
    ∀ q : Prop, ¬ (A q ∧ A (¬ q)) := by
  intro q hq
  exact logic_is_actual.consistency (logic_is_actual.mp q False hq.2 hq.1)

def PhysicalConceptionModelsActuality : Prop :=
  ∀ b : Belief, ∀ q : Prop,
    (b is-conception-of PhysicalReality) → (b affirms q) → b models (A q)

rigid universal Communication extends Process := "act of communication"

relation OwnerOf : Person → Communication := "is owner of"
relation RecipientOf : Person → Communication := "is recipient of"
relation Communicates : Communication → Belief := "communicates"
relation MoreExplicitThan : Communication → Communication := "is more explicit than"

scoped infixl:50 " owner-of " => OwnerOf
scoped infixl:50 " recipient-of " => RecipientOf
scoped infixl:50 " communicates " => Communicates
scoped infixl:50 " more-explicit-than " => MoreExplicitThan

relation DerivedFrom : Belief → Belief := "is derived from"
scoped infixl:50 " derived-from " => DerivedFrom

def Premise (b : Belief) : Prop :=
  ¬ ∃ b' : Belief, b derived-from b'

relation HoldsBelief : Person → Belief := "holds belief"
scoped infixl:50 " holds-belief " => HoldsBelief

rigid universal Inference extends Process := "inference"

relation Concludes : Inference → Belief := "concludes"
relation Assumes : Inference → Belief := "assumes"
relation MoreCoherentThan : Inference → Inference := "is more coherent than"

scoped infixl:50 " concludes " => Concludes
scoped infixl:50 " assumes " => Assumes
scoped infixl:50 " more-coherent-than " => MoreCoherentThan

def HoldsContradiction (per : Type) (b : Belief) : Prop :=
  ∃ p : Prop, (per holds-belief b) ∧ (b affirms p) ∧ (b affirms ¬p)

rigid universal Model extends GenericallyDependentContinuant := "model"
relation Includes : Model → Belief := "includes"
scoped infixl:50 " includes " => Includes

def ModelHoldsContradiction (m : Model) (b : Belief) : Prop :=
  ∃ p : Prop, (m includes b) ∧ (b affirms p) ∧ (b affirms ¬p)

def Resolves (m' : Model) (m : Model) (b : Belief) : Prop :=
  ModelHoldsContradiction m b ∧ ¬ ModelHoldsContradiction m' b

def ModelsPhysicalReality (m : Model) : Prop :=
  ∃ b : Belief, (m includes b) ∧ (b is-conception-of PhysicalReality)

def ModelIsEmpty (m : Model) : Prop := ¬ ∃ b : Belief, m includes b

theorem empty_model_resolves
    (m : Model) (b : Belief) (hm : ModelHoldsContradiction m b)
    (m' : Model) (h' : ModelIsEmpty m') :
    Resolves m' m b := by
  refine ⟨hm, ?_⟩
  intro hc
  obtain ⟨p, hib, _, _⟩ := hc
  exact h' ⟨b, hib⟩

def AContradictionAlwaysHasAProductiveResolution : Prop :=
  ∀ m : Model, ∀ b : Belief, ModelHoldsContradiction m b →
    ∃ m' : Model, Resolves m' m b ∧ ModelsPhysicalReality m'

end AxiomaticThinking

end z85jhy92
