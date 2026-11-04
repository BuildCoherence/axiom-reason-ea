import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.r59jf3ak

open a4hsz51v
open ta3nj1a4
open r59jf3ak
open t0d1zdc3

namespace stb24v62

rigid universal Person extends Object := "person"
rigid universal Action extends Process := "action"

def Determinism : Prop :=
  "every event is fully fixed by prior states of the world together with the laws of nature"

relation CouldHaveDoneOtherwise : Person "could have done otherwise than performing" Action
relation SelfSources : Person "performs from their own uncoerced reasons-responsive deliberation" Action
relation MorallyResponsibleFor : Person "is morally responsible for" Action

scoped notation:50 a " could-have-done-otherwise-than " x => CouldHaveDoneOtherwise a x
scoped notation:50 a " self-sources " x => SelfSources a x
scoped notation:50 a " morally-responsible-for " x => MorallyResponsibleFor a x

-- Shared metaphysics: both camps accept these.
def DeterminismExcludesAlternatives : Prop :=
  Determinism → ∀ a x : Type, ¬ (a could-have-done-otherwise-than x)

def SomeoneSelfSourcesAnAction : Prop :=
  ∃ a x : Type, a self-sources x

-- The hard determinist's moral axiom (the Principle of Alternative Possibilities).
def AlternativePossibilitiesRequired : Prop :=
  ∀ a x : Type, (a morally-responsible-for x) → (a could-have-done-otherwise-than x)

-- The compatibilist's moral axiom.
def SelfSourcingSuffices : Prop :=
  ∀ a x : Type, (a self-sources x) → (a morally-responsible-for x)

def NoOneIsMorallyResponsible : Prop :=
  ∀ a x : Type, ¬ (a morally-responsible-for x)

def SomeoneIsMorallyResponsible : Prop :=
  ∃ a x : Type, a morally-responsible-for x

theorem hard_determinism_denies_responsibility
    (logic_is_actual : LogicIsActual)
    (pap : A AlternativePossibilitiesRequired)
    (excl : A DeterminismExcludesAlternatives)
    (det : A Determinism) :
    A NoOneIsMorallyResponsible :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _
          (fun (pap : AlternativePossibilitiesRequired)
               (excl : DeterminismExcludesAlternatives)
               (det : Determinism) a x hr =>
            excl det a x (pap a x hr)))
        pap)
      excl)
    det

theorem compatibilism_preserves_responsibility
    (logic_is_actual : LogicIsActual)
    (det : A Determinism)
    (suff : A SelfSourcingSuffices)
    (someone : A SomeoneSelfSourcesAnAction) :
    A SomeoneIsMorallyResponsible :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _
          (fun (_ : Determinism)
               (suff : SelfSourcingSuffices)
               (someone : SomeoneSelfSourcesAnAction) =>
            someone.elim fun a hx => hx.elim fun x h => ⟨a, x, suff a x h⟩))
        det)
      suff)
    someone

theorem the_disagreement_is_moral
    (logic_is_actual : LogicIsActual)
    (pap : A AlternativePossibilitiesRequired)
    (suff : A SelfSourcingSuffices)
    (excl : A DeterminismExcludesAlternatives)
    (det : A Determinism)
    (someone : A SomeoneSelfSourcesAnAction) :
    False :=
  logic_is_actual.consistency
    (logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.mp _ _
          (logic_is_actual.mp _ _
            (logic_is_actual.mp _ _
              (logic_is_actual.actual_intro _
                (fun (pap : AlternativePossibilitiesRequired)
                     (suff : SelfSourcingSuffices)
                     (excl : DeterminismExcludesAlternatives)
                     (det : Determinism)
                     (someone : SomeoneSelfSourcesAnAction) =>
                  someone.elim fun a hx => hx.elim fun x h =>
                    excl det a x (pap a x (suff a x h))))
              pap)
            suff)
          excl)
        det)
      someone)

end stb24v62
