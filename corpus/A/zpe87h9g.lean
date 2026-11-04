import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.r59jf3ak
import A.ta3nj1a4

open a4hsz51v
open ta3nj1a4
open scoped r59jf3ak
open t0d1zdc3

namespace zpe87h9g

rigid universal RightsAffectingChoice extends Process :=
  "choice in a United States police encounter that gives up a legal protection or triggers a legal consequence"
rigid universal CustodialWaiverChoice extends RightsAffectingChoice :=
  "choice whether to waive Miranda rights during custodial interrogation"
rigid universal SearchConsentChoice extends RightsAffectingChoice :=
  "choice whether to consent to a police search"
rigid universal OnTheSpotAnswerChoice extends RightsAffectingChoice :=
  "choice whether to answer police questions outside custodial interrogation, such as at a traffic stop"
rigid universal CrisisChoice extends RightsAffectingChoice :=
  "choice made during a mental health crisis in a police encounter, such as whether to accept voluntary hospital admission"

relation OftenMadeUninformed : Type :=
  "is a kind of choice that many people make without understanding that they have a choice and the major consequences of each option"
relation InformingNotRequired : Type :=
  "is a kind of choice before which United States law as of 2026 does not require that the person be informed of its major consequences"
relation InformedGetStrongerCases : Type :=
  "is a kind of choice after which informed people tend to end up in a stronger legal position than uninformed people"

def SystemFavorsTheInformed (kind : Type) : Prop :=
  OftenMadeUninformed kind ∧ InformingNotRequired kind ∧ InformedGetStrongerCases kind

rigid universal LegalRule extends GenericallyDependentContinuant := "legal rule"

def LawyerFirstRule : Type :=
  "the rule that a waiver of Miranda rights during custodial interrogation is valid only after the person has consulted a lawyer"
def CounselBeforeConsentRule : Type :=
  "the rule that consent to a police search counts only after the person consults a lawyer or equivalently trained advocate"
def AnswerExclusionRule : Type :=
  "the rule that answers to police questions outside custodial interrogation, and evidence derived from them, cannot be used against the person in court unless the person first consulted a lawyer, except for legally required identification and genuine emergencies"
def ProvisionalCrisisDecisionRule : Type :=
  "the rule that decisions made during a mental health crisis in a police encounter stay provisional, with no lasting legal consequences, until the person reviews them with an advocate once stable or, if the person is not stable within 30 days, until a hearing with a lawyer decides, and that this rule cannot be satisfied by placing the person on involuntary status instead"

relation EffectiveWorkableProtectionFor : LegalRule → Type :=
  "is an effective workable way to keep the legal position of people from being weakened by not knowing their options in choices of the kind"
scoped infix:50 " protects-in " => EffectiveWorkableProtectionFor

relation StrongReasonToAdopt : LegalRule :=
  "is a legal rule there is strong reason for the United States to adopt"

def FairnessPrinciple : Prop :=
  ∀ policy kind : Type, SystemFavorsTheInformed kind →
    policy protects-in kind → StrongReasonToAdopt policy

theorem reform_warranted (logic_is_actual : LogicIsActual) {policy kind : Type}
    (fairness : A FairnessPrinciple) (favors : A (SystemFavorsTheInformed kind))
    (protects : A (policy protects-in kind)) : A (StrongReasonToAdopt policy) :=
  logic_is_actual.mp _ _ (logic_is_actual.mp _ _ (logic_is_actual.mp _ _
    (logic_is_actual.actual_intro _ (fun f c e => f policy kind c e)) fairness) favors) protects

def CustodialWaiversFavorTheInformed : Prop := SystemFavorsTheInformed CustodialWaiverChoice.U
def SearchConsentFavorsTheInformed : Prop := SystemFavorsTheInformed SearchConsentChoice.U
def OnTheSpotAnswersFavorTheInformed : Prop := SystemFavorsTheInformed OnTheSpotAnswerChoice.U
def CrisisChoicesFavorTheInformed : Prop := SystemFavorsTheInformed CrisisChoice.U

def LawyerFirstProtects : Prop := LawyerFirstRule protects-in CustodialWaiverChoice.U
def CounselBeforeConsentProtects : Prop := CounselBeforeConsentRule protects-in SearchConsentChoice.U
def AnswerExclusionProtects : Prop := AnswerExclusionRule protects-in OnTheSpotAnswerChoice.U
def ProvisionalCrisisDecisionProtects : Prop := ProvisionalCrisisDecisionRule protects-in CrisisChoice.U

theorem lawyer_first_warranted (logic_is_actual : LogicIsActual) (fairness : A FairnessPrinciple)
    (favors : A CustodialWaiversFavorTheInformed) (protects : A LawyerFirstProtects) :
    A (StrongReasonToAdopt LawyerFirstRule) :=
  reform_warranted logic_is_actual fairness favors protects

theorem counsel_before_consent_warranted (logic_is_actual : LogicIsActual) (fairness : A FairnessPrinciple)
    (favors : A SearchConsentFavorsTheInformed) (protects : A CounselBeforeConsentProtects) :
    A (StrongReasonToAdopt CounselBeforeConsentRule) :=
  reform_warranted logic_is_actual fairness favors protects

theorem answer_exclusion_warranted (logic_is_actual : LogicIsActual) (fairness : A FairnessPrinciple)
    (favors : A OnTheSpotAnswersFavorTheInformed) (protects : A AnswerExclusionProtects) :
    A (StrongReasonToAdopt AnswerExclusionRule) :=
  reform_warranted logic_is_actual fairness favors protects

theorem provisional_crisis_decision_warranted (logic_is_actual : LogicIsActual) (fairness : A FairnessPrinciple)
    (favors : A CrisisChoicesFavorTheInformed) (protects : A ProvisionalCrisisDecisionProtects) :
    A (StrongReasonToAdopt ProvisionalCrisisDecisionRule) :=
  reform_warranted logic_is_actual fairness favors protects

end zpe87h9g
