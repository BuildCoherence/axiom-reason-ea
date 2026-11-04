import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.r59jf3ak
import A.ta3nj1a4

open r59jf3ak
open ta3nj1a4

open t0d1zdc3
open gwcwyrvb

namespace t8grzs37

rigid universal Person extends Object := "person"
universal Child extends Person := "child"
rigid universal Murder extends Process := "murder"
rigid universal PunishmentSpecification extends GenericallyDependentContinuant := "punishment specification"

relation MurdersIn : Person → Person → Murder := "murders in"
relation DeservesPunishmentFor : Person → Process → PunishmentSpecification :=
  "deserves punishment specification for"
relation GreaterPunishmentThan : PunishmentSpecification → PunishmentSpecification := "is greater than"
relation NonAgePunishmentRelevantCircumstances : Murder := "punishment relevant circumstances other than victim's age"

structure MurderCase where
  murder : Murder
  murderer : Person
  victim : Person
  punishment : PunishmentSpecification
  murders_in :
    MurdersIn murderer victim murder
  deserved_punishment :
    DeservesPunishmentFor murderer murder punishment

def VictimIsChild (mc : MurderCase) :=
  ∃ t, Child.At mc.victim t ∧ OccupiesTemporalRegion mc.murder t

def SameNonVictimAgeCircumstances (mc1 mc2 : MurderCase) :=
  (NonAgePunishmentRelevantCircumstances mc1.murder) ↔ (NonAgePunishmentRelevantCircumstances mc2.murder)

def ChildMurderDeservesGreaterPunishmentThanNonChildMurder : Prop :=
  ∀ mc1 mc2 : MurderCase, SameNonVictimAgeCircumstances mc1 mc2 →
    VictimIsChild mc1 → ¬ VictimIsChild mc2 →
      GreaterPunishmentThan mc1.punishment mc2.punishment

def Murderer : Type := "The Marjory Stoneman Douglas High School shooter"
def ChildVictim : Type := "Alyssa Alhadeff"
def ChildMurder : Type := "the murder of Alyssa Alhadeff"
def ChildCasePunishmentSpec : Type :=
  "the punishment specification deserved for the murder of Alyssa Alhadeff"

def AdultVictim : Type := "Chris Hixon"
def AdultMurder : Type := "the murder of Chris Hixon"
def AdultCasePunishmentSpec : Type :=
  "the punishment specification deserved for the murder of Chris Hixon"

structure TwoConcreteMurderCases : Prop where
  child_case_involvement :
    MurdersIn Murderer ChildVictim ChildMurder
  child_case_deserved_punishment :
    DeservesPunishmentFor Murderer ChildMurder ChildCasePunishmentSpec
  child_case_victim_is_child :
    ∃ t, Child.At ChildVictim t ∧ OccupiesTemporalRegion ChildMurder t
  non_child_case_involvement :
    MurdersIn Murderer AdultVictim AdultMurder
  non_child_case_deserved_punishment :
    DeservesPunishmentFor Murderer AdultMurder AdultCasePunishmentSpec
  non_child_case_victim_is_not_child :
    ¬ ∃ t, Child.At AdultVictim t ∧ OccupiesTemporalRegion AdultMurder t
  same_non_victim_age_circumstances :
    NonAgePunishmentRelevantCircumstances ChildMurder ↔
      NonAgePunishmentRelevantCircumstances AdultMurder

theorem child_case_deserves_greater_punishment
    (logic_is_actual : LogicIsActual)
    (principle : A ChildMurderDeservesGreaterPunishmentThanNonChildMurder)
    (cases : A TwoConcreteMurderCases) :
    A (GreaterPunishmentThan
      ChildCasePunishmentSpec
      AdultCasePunishmentSpec) := by
  exact
    logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _
          (fun (principle : ChildMurderDeservesGreaterPunishmentThanNonChildMurder)
               (cases : TwoConcreteMurderCases) => by
            letI : Person.Is Murderer := cases.child_case_involvement.inst0
            letI : Person.Is ChildVictim := cases.child_case_involvement.inst1
            letI : Murder.Is ChildMurder := cases.child_case_involvement.inst2
            letI : PunishmentSpecification.Is ChildCasePunishmentSpec :=
              cases.child_case_deserved_punishment.inst2
            letI : Person.Is AdultVictim := cases.non_child_case_involvement.inst1
            letI : Murder.Is AdultMurder := cases.non_child_case_involvement.inst2
            letI : PunishmentSpecification.Is AdultCasePunishmentSpec :=
              cases.non_child_case_deserved_punishment.inst2
            let childCase : MurderCase :=
              { murder := ChildMurder
                murderer := Murderer
                victim := ChildVictim
                punishment := ChildCasePunishmentSpec
                murders_in := cases.child_case_involvement
                deserved_punishment := cases.child_case_deserved_punishment }
            let nonChildCase : MurderCase :=
              { murder := AdultMurder
                murderer := Murderer
                victim := AdultVictim
                punishment := AdultCasePunishmentSpec
                murders_in := cases.non_child_case_involvement
                deserved_punishment := cases.non_child_case_deserved_punishment }
            have sameCircumstances : SameNonVictimAgeCircumstances childCase nonChildCase :=
              cases.same_non_victim_age_circumstances
            have childVictimIsChild : VictimIsChild childCase :=
              cases.child_case_victim_is_child
            have nonChildVictimIsNotChild : ¬ VictimIsChild nonChildCase :=
              cases.non_child_case_victim_is_not_child
            exact principle childCase nonChildCase
              sameCircumstances
              childVictimIsChild
              nonChildVictimIsNotChild))
        principle)
      cases

end t8grzs37
