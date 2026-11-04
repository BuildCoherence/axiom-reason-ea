import Axiom
import A.gwcwyrvb

open gwcwyrvb

namespace mbsxqzvd

-- https://reddit.com/r/askphilosophy/comments/g2002v/

def P1 := A ("we have a duty to perfect our moral character" : Prop)
def P2 := A ("when we mistreat animals, we corrupt our moral character" : Prop)
def P3 := A ("exploiting animals for commercial gain is mistreating them" : Prop)
def P4 := A ("eating meat exploits animals for commercial gain" : Prop)
def C1 := A ("we mustn't mistreat animals" : Prop)
def C2 := A ("we mustn't eat meat" : Prop)

def no_mistreat : Prop := P1 ∧ P2 → C1

def no_eat_meat : Prop := C1 ∧ P3 ∧ P4 → C2

theorem c1_by_modus_ponens
    (p1 : P1) (p2 : P2) (no_mistreat_bridge : no_mistreat)
  : C1 :=
  no_mistreat_bridge ⟨p1, p2⟩

theorem must_not_eat_meat
    (p1 : P1) (p2 : P2) (no_mistreat_bridge : no_mistreat)
    (p3 : P3) (p4 : P4) (no_eat_meat_bridge : no_eat_meat)
  : C2 :=
  no_eat_meat_bridge ⟨c1_by_modus_ponens p1 p2 no_mistreat_bridge, p3, p4⟩

end mbsxqzvd
