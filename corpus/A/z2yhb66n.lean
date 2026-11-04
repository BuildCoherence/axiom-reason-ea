import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.mw1nngvh
import A.j12bzjgj

open t0d1zdc3
open gwcwyrvb
open mw1nngvh
open j12bzjgj
open c424c6bg

namespace z2yhb66n

#check Person

open BFO

rigid universal Murder extends Process := "murder"
rigid universal PunishmentSpec extends GenericallyDependentContinuant := "punishment specification"

relation MurderInvolves : Murder "involves the victim" Person "and murderer" Person
relation DeservesPunishmentFor : Person "derserves" PunishmentSpec "for" Process
relation IsGreaterPunishmentThan : PunishmentSpec "is greater than" PunishmentSpec
relation MurderCircumstancesRelevantToTheDeservedPunishmentOtherThanVictimAge : Murder := "circumstances relevant to the deserved punishment other than the victim's age"

structure MurderCase where
  murder : Murder
  murderer : Person
  victim : Person
  punishment : PunishmentSpec
  murders_involvement : MurderInvolves murder victim murderer
  deserved_punishment : DeservesPunishmentFor murderer punishment murder

def VictimIsChild (mc : MurderCase) :=
  ∃ t, Child.At mc.victim t ∧ ProcessOccupiesTemporalRegion mc.murder t
  
def SameNonVictimAgeCircumstances (mc1 mc2 : MurderCase) :=
  (MurderCircumstancesRelevantToTheDeservedPunishmentOtherThanVictimAge mc1.murder) ↔ (MurderCircumstancesRelevantToTheDeservedPunishmentOtherThanVictimAge mc2.murder)

def ChildMurderDeservesGreaterPunishmentThanNonChildMurder : Prop :=
  ∀ mc1 mc2 : MurderCase, SameNonVictimAgeCircumstances mc1 mc2 →
    VictimIsChild mc1 → ¬ VictimIsChild mc2 →
      IsGreaterPunishmentThan mc1.punishment mc2.punishment

namespace Example

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
    MurderInvolves ChildMurder ChildVictim Murderer
  child_case_deserved_punishment :
    DeservesPunishmentFor Murderer ChildCasePunishmentSpec ChildMurder
  child_case_victim_is_child :
    ∃ t, Child.At ChildVictim t ∧ ProcessOccupiesTemporalRegion ChildMurder t
  non_child_case_involvement :
    MurderInvolves AdultMurder AdultVictim Murderer
  non_child_case_deserved_punishment :
    DeservesPunishmentFor Murderer AdultCasePunishmentSpec AdultMurder
  non_child_case_victim_is_not_child :
    ¬ ∃ t, Child.At AdultVictim t ∧ ProcessOccupiesTemporalRegion AdultMurder t
  same_non_victim_age_circumstances :
    MurderCircumstancesRelevantToTheDeservedPunishmentOtherThanVictimAge ChildMurder ↔
      MurderCircumstancesRelevantToTheDeservedPunishmentOtherThanVictimAge AdultMurder

theorem child_case_deserves_greater_punishment
    (logic_is_actual : LogicIsActual)
    (principle : A ChildMurderDeservesGreaterPunishmentThanNonChildMurder)
    (cases : A TwoConcreteMurderCases) :
    A (IsGreaterPunishmentThan
      ChildCasePunishmentSpec
      AdultCasePunishmentSpec) := by
  exact
    logic_is_actual.mp _ _
      (logic_is_actual.mp _ _
        (logic_is_actual.actual_intro _
          (fun principle cases => by
            letI : Murder.Is ChildMurder := cases.child_case_involvement.inst0
            letI : Person.Is ChildVictim := cases.child_case_involvement.inst1
            letI : Person.Is Murderer := cases.child_case_involvement.inst2
            letI : PunishmentSpec.Is ChildCasePunishmentSpec :=
              cases.child_case_deserved_punishment.inst1
            letI : Murder.Is AdultMurder := cases.non_child_case_involvement.inst0
            letI : Person.Is AdultVictim := cases.non_child_case_involvement.inst1
            letI : PunishmentSpec.Is AdultCasePunishmentSpec :=
              cases.non_child_case_deserved_punishment.inst1
            let childCase : MurderCase :=
              { murder := ChildMurder
                murderer := Murderer
                victim := ChildVictim
                punishment := ChildCasePunishmentSpec
                murders_involvement := cases.child_case_involvement
                deserved_punishment := cases.child_case_deserved_punishment }
            let nonChildCase : MurderCase :=
              { murder := AdultMurder
                murderer := Murderer
                victim := AdultVictim
                punishment := AdultCasePunishmentSpec
                murders_involvement := cases.non_child_case_involvement
                deserved_punishment := cases.non_child_case_deserved_punishment }
            have sameCircumstances : SameNonVictimAgeCircumstances childCase nonChildCase := by
              simpa [SameNonVictimAgeCircumstances, childCase, nonChildCase]
                using cases.same_non_victim_age_circumstances
            have childVictimIsChild : VictimIsChild childCase := by
              simpa [VictimIsChild, childCase] using cases.child_case_victim_is_child
            have nonChildVictimIsNotChild : ¬ VictimIsChild nonChildCase := by
              simpa [VictimIsChild, nonChildCase]
                using cases.non_child_case_victim_is_not_child
            exact principle childCase nonChildCase
              sameCircumstances
              childVictimIsChild
              nonChildVictimIsNotChild))
        principle)
      cases

end Example


end z2yhb66n
