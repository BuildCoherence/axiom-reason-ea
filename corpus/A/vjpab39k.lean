import Axiom
import A.ta3nj1a4
import A.r59jf3ak

open scoped r59jf3ak
open ta3nj1a4

namespace vjpab39k

namespace model1

  def P : Prop := "it's raining today"

  def SamStatement    := P
  def FriendStatement := ¬ P

  theorem statements_are_contradictory
      (sam_statement : SamStatement)
      (friend_statement : FriendStatement)
    : False := by contradiction

end model1

namespace model2

  inductive Location where
  | samsHouse
  | friendsHouse

  def P : Location → Prop := "it's raining today"
  
  def SamStatement    := P Location.samsHouse
  def FriendStatement := P Location.friendsHouse

  theorem statements_are_compatible :
      ∃ raining : Location → Prop,
        raining Location.samsHouse ∧
        raining Location.friendsHouse := by
    exact ⟨fun _ => True, True.intro, True.intro⟩

end model2

end vjpab39k
