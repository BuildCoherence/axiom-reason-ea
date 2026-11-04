import Axiom
import A.gwcwyrvb

open gwcwyrvb

namespace y6z6051p

-- https://reddit.com/r/askphilosophy/comments/g2002v/

theorem c1_by_modus_ponens
    (p1 : A ("we have a duty to perfect our moral character" : Prop))
    (p2 : A ("when we mistreat animals, we corrupt our moral character" : Prop))
    (no_mistreat_bridge :
      A ("we have a duty to perfect our moral character" : Prop) ∧
        A ("when we mistreat animals, we corrupt our moral character" : Prop) →
          A ("we mustn't mistreat animals" : Prop))
  : A ("we mustn't mistreat animals" : Prop) :=
  no_mistreat_bridge ⟨p1, p2⟩

theorem must_not_eat_meat
    (p1 : A ("we have a duty to perfect our moral character" : Prop))
    (p2 : A ("when we mistreat animals, we corrupt our moral character" : Prop))
    (no_mistreat_bridge :
      A ("we have a duty to perfect our moral character" : Prop) ∧
        A ("when we mistreat animals, we corrupt our moral character" : Prop) →
          A ("we mustn't mistreat animals" : Prop))
    (p3 : A ("exploiting animals for commercial gain is mistreating them" : Prop))
    (p4 : A ("eating meat exploits animals for commercial gain" : Prop))
    (no_eat_meat_bridge :
      A ("we mustn't mistreat animals" : Prop) ∧
        A ("exploiting animals for commercial gain is mistreating them" : Prop) ∧
          A ("eating meat exploits animals for commercial gain" : Prop) →
            A ("we mustn't eat meat" : Prop))
  : A ("we mustn't eat meat" : Prop) :=
  no_eat_meat_bridge ⟨c1_by_modus_ponens p1 p2 no_mistreat_bridge, p3, p4⟩

end y6z6051p
