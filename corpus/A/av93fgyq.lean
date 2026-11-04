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

namespace av93fgyq

namespace AxiomaticThinking

rigid universal Belief extends Conception := "belief"
rigid universal Action extends Process := "action"

relation Affirms : Belief → Prop := "affirms"
relation Does : Person → Action := "does"
relation ExistsInThePerceivedPhysicalSpaceOf : Prop → Person :=
  "exists in the perceived physical space of"

scoped infixl:50 " affirms " => Affirms
scoped infixl:50 " does " => Does
scoped infixl:50 " exists-in-perceived-physical-space-of " => ExistsInThePerceivedPhysicalSpaceOf

def BeliefCanBeContradictory : Prop :=
  ∃ b : Belief, ∃ p : Prop, (b affirms p) ∧ (b affirms ¬p)

def MyPerceivedSpaceIsActuality : Prop :=
  ∀ p : Prop, (p exists-in-perceived-physical-space-of MetaBias) ↔ A p

theorem my_physical_space_not_contradictory
    (logic_is_actual : LogicIsActual)
    (my_perceived_space_is_actuality : MyPerceivedSpaceIsActuality) :
    ∀ p : Prop, ¬ ((p exists-in-perceived-physical-space-of MetaBias)
      ∧ ((¬ p) exists-in-perceived-physical-space-of MetaBias)) := by
  intro p hp
  have h1 : A p := (my_perceived_space_is_actuality p).mp hp.1
  have h2 : A (¬ p) := (my_perceived_space_is_actuality (¬ p)).mp hp.2
  exact logic_is_actual.consistency (logic_is_actual.mp p False h2 h1)

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

def HoldsContradiction (per : Person) (b : Belief) : Prop :=
  ∃ b' : Belief, ∃ p : Prop,
    (per holds-belief b) ∧ (per holds-belief b') ∧ (b affirms p) ∧ (b' affirms ¬p)

end AxiomaticThinking

end av93fgyq
