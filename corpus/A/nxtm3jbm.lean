import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.r59jf3ak

open a4hsz51v
open ta3nj1a4
open r59jf3ak
open t0d1zdc3

namespace nxtm3jbm

rigid universal Person extends Object := "person"
rigid universal Store extends Object := "store"

relation ClosesAt : Store "closes at" TemporalInstant
relation CannotArriveBefore : Person "cannot arrive at" Store "before" TemporalInstant
relation CanMakeItTo : Person "can make it to" Store "before" TemporalInstant

def LateArrivalMeansNotMakingIt : Prop :=
  ∀ p s closing earliest : Type,
    ClosesAt s closing →
    CannotArriveBefore p s earliest →
    Precedes closing earliest →
    ¬ CanMakeItTo p s closing

def Sam : Type := "the Axiom user sam"
def TheStore : Type := "the store sam intended to visit on the evening of 2026-08-06"
def ClosingTime : Type := "2026-08-06 21:00, the closing time of the store sam intended to visit"
def EarliestArrival : Type :=
  "2026-08-06 21:10, the earliest sam could arrive at the store, leaving at 20:40 with a normal 30 minute travel time"

structure TonightsStoreRun : Prop where
  closes :
    ClosesAt TheStore ClosingTime
  cannot_arrive_before :
    CannotArriveBefore Sam TheStore EarliestArrival
  too_late :
    Precedes ClosingTime EarliestArrival

theorem sam_cannot_make_it
    (logic_is_actual : LogicIsActual)
    (principle : A LateArrivalMeansNotMakingIt)
    (tonight : A TonightsStoreRun) :
    A (¬ CanMakeItTo Sam TheStore ClosingTime) :=
  logic_is_actual.mp _ _
    (logic_is_actual.mp _ _
      (logic_is_actual.actual_intro _
        (fun (pr : LateArrivalMeansNotMakingIt) (run : TonightsStoreRun) =>
          pr Sam TheStore ClosingTime EarliestArrival
            run.closes run.cannot_arrive_before run.too_late))
      principle)
    tonight

/-
The same scenario in traditional first-order + modal notation:

  Vocabulary:
    Constants:   s (sam),  b (the store),  c (closing time, 21:00),  e (earliest arrival, 21:10)
    Predicates:  Closes(x, t)      — store x closes at instant t
                 ArrBef(x, y, t)   — x can arrive at y before t
                 t ≺ t′            — instant t precedes instant t′
    Modality:    ◇ₐ φ              — "agent a is able to bring about φ"

  General principle (LateArrivalMeansNotMakingIt):
    ∀x ∀y ∀t ∀t′ [ Closes(y, t) ∧ ¬ArrBef(x, y, t′) ∧ t ≺ t′ → ¬◇ₓ Shop(x, y, t) ]

  Particular facts (TonightsStoreRun):
    P1:  Closes(b, c)
    P2:  ¬ArrBef(s, b, e)
    P3:  c ≺ e

  Derivation (sam_cannot_make_it):
    1. Closes(b,c) ∧ ¬ArrBef(s,b,e) ∧ c ≺ e → ¬◇ₛ Shop(s,b,c)   (UI ×4 on the principle)
    2. Closes(b,c) ∧ ¬ArrBef(s,b,e) ∧ c ≺ e                     (∧-intro on P1, P2, P3)
    3. ¬◇ₛ Shop(s,b,c)                                          (MP on 1, 2)

  Differences from the Lean version: the FOL signature leaves the sort of t/t′, the
  theory of ≺, and the semantics of ◇ₐ unspecified — here ≺ is BFO's Precedes, the
  ability modality is carried by the CanMakeItTo semantic string, the "normally 30
  minutes" hedge lives inside the EarliestArrival particular (keeping the logic
  classical rather than defaulting to a nonmonotonic system), and A (Actual) marks
  the conclusion as action-guiding rather than merely entailed.
-/

end nxtm3jbm
