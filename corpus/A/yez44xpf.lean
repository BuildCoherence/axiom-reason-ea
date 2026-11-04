import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.j12bzjgj

open t0d1zdc3
open gwcwyrvb
open j12bzjgj
open c424c6bg

open BFO

namespace yez44xpf

namespace SpeechAndLegitimacy

rigid universal GroupOfAgents extends ObjectAggregate := "group of agents"
rigid universal Organization extends GroupOfAgents := "organization"
rigid universal Government extends Organization := "government"
rigid universal FormOfSpeech extends GenericallyDependentContinuant := "form of speech"

relation Legitimate : Government := "is legitimate"
relation GovernedConsent : Government := "the governed meaningfully consent to"
relation CanSpeakOfConduct : Government := "citizens can freely speak about the conduct of"
relation Bans : Government → FormOfSpeech := "bans"
relation CanFreelyExpress : Government → FormOfSpeech := "citizens can freely express"

def ConsentRequiredForLegitimacy : Prop := ∀ g, Legitimate g → GovernedConsent g
def SpeechRequiredForConsent : Prop := ∀ g, GovernedConsent g → CanSpeakOfConduct g
def LegitimacyRequiresSpeech : Prop := ∀ g, Legitimate g → CanSpeakOfConduct g

def ScrutinizingBansRequiresAccess : Prop :=
  ∀ g x, Bans g x → CanSpeakOfConduct g → CanFreelyExpress g x
def BanningPrecludesExpression : Prop :=
  ∀ g x, Bans g x → ¬ CanFreelyExpress g x
def LegitimacyForbidsSpeechBans : Prop :=
  ∀ g, Legitimate g → ∀ x, ¬ Bans g x

theorem legitimacy_requires_speech
    (logic_is_actual : LogicIsActual)
    (consent_req : A ConsentRequiredForLegitimacy)
    (speech_req : A SpeechRequiredForConsent) :
    A LegitimacyRequiresSpeech := by
  have taut :
      ConsentRequiredForLegitimacy → SpeechRequiredForConsent → LegitimacyRequiresSpeech := by
    intro h1 h2 g hleg
    exact h2 g (h1 g hleg)
  have s1 := logic_is_actual.mp _ _ (logic_is_actual.actual_intro _ taut) consent_req
  exact logic_is_actual.mp _ _ s1 speech_req

theorem legitimacy_forbids_speech_bans
    (logic_is_actual : LogicIsActual)
    (consent_req : A ConsentRequiredForLegitimacy)
    (speech_req : A SpeechRequiredForConsent)
    (scrutiny_req : A ScrutinizingBansRequiresAccess)
    (ban_precludes : A BanningPrecludesExpression) :
    A LegitimacyForbidsSpeechBans := by
  have taut :
      ConsentRequiredForLegitimacy → SpeechRequiredForConsent →
        ScrutinizingBansRequiresAccess → BanningPrecludesExpression →
          LegitimacyForbidsSpeechBans := by
    intro h1 h2 h3 h4 g hleg x hban
    exact h4 g x hban (h3 g x hban (h2 g (h1 g hleg)))
  have s1 := logic_is_actual.mp _ _ (logic_is_actual.actual_intro _ taut) consent_req
  have s2 := logic_is_actual.mp _ _ s1 speech_req
  have s3 := logic_is_actual.mp _ _ s2 scrutiny_req
  exact logic_is_actual.mp _ _ s3 ban_precludes

end SpeechAndLegitimacy

end yez44xpf
