import Axiom
import A.gwcwyrvb

open gwcwyrvb

namespace m63bd0fm

-- Anselm's ontological argument (Proslogion II), as reconstructed in
-- https://plato.stanford.edu/entries/ontological-arguments/ (section 6)

def FoolUnderstandsTheWords : Prop :=
  A ("when the fool hears the words 'that than which no greater can be conceived' he understands those words" : Prop)
def WhateverIsUnderstoodExistsInTheUnderstanding : Prop :=
  A ("whatever is understood exists in the understanding" : Prop)
def ExistsInTheUnderstanding : Prop :=
  A ("that than which no greater can be conceived exists in the understanding" : Prop)
def CanBeConceivedToExistInReality : Prop :=
  A ("if that than which no greater can be conceived exists in the understanding, it can be conceived to exist in reality" : Prop)
def GreaterIfInReality : Prop :=
  A ("that than which no greater can be conceived is greater if it exists in reality than if it exists only in the understanding" : Prop)
def NothingGreaterConceivable : Prop :=
  A ("it is impossible to conceive of something greater than that than which no greater can be conceived" : Prop)
def ExistsInReality : Prop :=
  A ("that than which no greater can be conceived exists in reality" : Prop)
def GodIsThatThanWhichNoGreaterCanBeConceived : Prop :=
  A ("God is that than which no greater can be conceived" : Prop)
def GodExistsInReality : Prop :=
  A ("God exists in reality" : Prop)

def ExistsInUnderstandingBridge : Prop :=
  FoolUnderstandsTheWords ∧ WhateverIsUnderstoodExistsInTheUnderstanding →
    ExistsInTheUnderstanding

def ExistsInRealityBridge : Prop :=
  ExistsInTheUnderstanding ∧ CanBeConceivedToExistInReality ∧
    GreaterIfInReality ∧ NothingGreaterConceivable →
      ExistsInReality

def GodExistsBridge : Prop :=
  GodIsThatThanWhichNoGreaterCanBeConceived ∧ ExistsInReality →
    GodExistsInReality

theorem exists_in_the_understanding
    (i : FoolUnderstandsTheWords)
    (ii : WhateverIsUnderstoodExistsInTheUnderstanding)
    (iii_bridge : ExistsInUnderstandingBridge)
  : ExistsInTheUnderstanding :=
  iii_bridge ⟨i, ii⟩

theorem exists_in_reality
    (i : FoolUnderstandsTheWords)
    (ii : WhateverIsUnderstoodExistsInTheUnderstanding)
    (iii_bridge : ExistsInUnderstandingBridge)
    (iv : CanBeConceivedToExistInReality)
    (v : GreaterIfInReality)
    (vi : NothingGreaterConceivable)
    (vii_bridge : ExistsInRealityBridge)
  : ExistsInReality :=
  vii_bridge ⟨exists_in_the_understanding i ii iii_bridge, iv, v, vi⟩

-- Anselm's identification: "and this you are, O Lord our God" (Proslogion II)
theorem god_exists_in_reality
    (i : FoolUnderstandsTheWords)
    (ii : WhateverIsUnderstoodExistsInTheUnderstanding)
    (iii_bridge : ExistsInUnderstandingBridge)
    (iv : CanBeConceivedToExistInReality)
    (v : GreaterIfInReality)
    (vi : NothingGreaterConceivable)
    (vii_bridge : ExistsInRealityBridge)
    (viii : GodIsThatThanWhichNoGreaterCanBeConceived)
    (god_bridge : GodExistsBridge)
  : GodExistsInReality :=
  god_bridge ⟨viii, exists_in_reality i ii iii_bridge iv v vi vii_bridge⟩

end m63bd0fm
