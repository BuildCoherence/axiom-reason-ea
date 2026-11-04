import Axiom
import A.t0d1zdc3
import A.a4hsz51v
import A.ta3nj1a4
import A.zpe87h9g

open Axiom

open a4hsz51v
open ta3nj1a4
open t0d1zdc3
open zpe87h9g

namespace nhknrxwy

def logic_is_actual : Prop := LogicIsActual
def bfo : Prop := A BFO
def fairness_principle : Prop := A FairnessPrinciple
def custodial_waivers_favor_the_informed : Prop := A CustodialWaiversFavorTheInformed
def lawyer_first_protects : Prop := A LawyerFirstProtects
def search_consent_favors_the_informed : Prop := A SearchConsentFavorsTheInformed
def counsel_before_consent_protects : Prop := A CounselBeforeConsentProtects
def on_the_spot_answers_favor_the_informed : Prop := A OnTheSpotAnswersFavorTheInformed
def answer_exclusion_protects : Prop := A AnswerExclusionProtects
def crisis_choices_favor_the_informed : Prop := A CrisisChoicesFavorTheInformed
def provisional_crisis_decision_protects : Prop := A ProvisionalCrisisDecisionProtects

def userAxiomsList : Axiom.Axioms :=
  [("logic_is_actual", logic_is_actual), ("bfo", bfo), ("fairness_principle", fairness_principle), ("custodial_waivers_favor_the_informed", custodial_waivers_favor_the_informed), ("lawyer_first_protects", lawyer_first_protects), ("search_consent_favors_the_informed", search_consent_favors_the_informed), ("counsel_before_consent_protects", counsel_before_consent_protects), ("on_the_spot_answers_favor_the_informed", on_the_spot_answers_favor_the_informed), ("answer_exclusion_protects", answer_exclusion_protects), ("crisis_choices_favor_the_informed", crisis_choices_favor_the_informed), ("provisional_crisis_decision_protects", provisional_crisis_decision_protects)]

axiom user_axioms_auth : Axiom.AuthenticatedTerm ("err313", userAxiomsList, 1792162102)

def userAxioms : Axiom.UserAxioms "err313" 1792162102 :=
  ⟨userAxiomsList, user_axioms_auth⟩

end nhknrxwy
