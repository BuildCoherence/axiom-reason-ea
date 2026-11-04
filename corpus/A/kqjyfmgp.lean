import Axiom
import A.t0d1zdc3
import A.gwcwyrvb

open t0d1zdc3
open gwcwyrvb

namespace kqjyfmgp

-- https://reddit.com/r/askphilosophy/comments/g2002v/

def DutyToPerfectMoralCharacter : Prop :=
  "we have a duty to perfect our moral character"
def MistreatingAnimalsCorruptsMoralCharacter : Prop :=
  "when we mistreat animals, we corrupt our moral character"
def CommercialExploitationIsMistreatment : Prop :=
  "exploiting animals for commercial gain is mistreating them"
def EatingMeatCommerciallyExploitsAnimals : Prop :=
  "eating meat exploits animals for commercial gain"
def MustNotMistreatAnimals : Prop :=
  "we mustn't mistreat animals"
def MustNotEatMeat : Prop :=
  "we mustn't eat meat"

def NoMistreatBridge : Prop :=
  DutyToPerfectMoralCharacter ∧ MistreatingAnimalsCorruptsMoralCharacter →
    MustNotMistreatAnimals

def NoEatMeatBridge : Prop :=
  MustNotMistreatAnimals ∧ CommercialExploitationIsMistreatment ∧
    EatingMeatCommerciallyExploitsAnimals →
      MustNotEatMeat

theorem actual_and (h : LogicIsActual) {p q : Prop} (hp : A p) (hq : A q) :
    A (p ∧ q) :=
  h.mp _ _ (h.mp _ _ (h.actual_intro _ (@And.intro p q)) hp) hq

theorem no_mistreat
    (logic_is_actual : LogicIsActual)
    (duty_to_perfect : A DutyToPerfectMoralCharacter)
    (mistreating_corrupts : A MistreatingAnimalsCorruptsMoralCharacter)
    (no_mistreat_bridge : A NoMistreatBridge)
  : A MustNotMistreatAnimals :=
  logic_is_actual.mp _ _ no_mistreat_bridge
    (actual_and logic_is_actual duty_to_perfect mistreating_corrupts)

theorem no_eat_meat
    (logic_is_actual : LogicIsActual)
    (duty_to_perfect : A DutyToPerfectMoralCharacter)
    (mistreating_corrupts : A MistreatingAnimalsCorruptsMoralCharacter)
    (no_mistreat_bridge : A NoMistreatBridge)
    (exploitation_is_mistreatment : A CommercialExploitationIsMistreatment)
    (eating_meat_exploits : A EatingMeatCommerciallyExploitsAnimals)
    (no_eat_meat_bridge : A NoEatMeatBridge)
  : A MustNotEatMeat :=
  logic_is_actual.mp _ _ no_eat_meat_bridge
    (actual_and logic_is_actual
      (no_mistreat logic_is_actual duty_to_perfect mistreating_corrupts
        no_mistreat_bridge)
      (actual_and logic_is_actual exploitation_is_mistreatment
        eating_meat_exploits))

end kqjyfmgp
