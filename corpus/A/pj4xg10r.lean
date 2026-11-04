import Axiom

namespace pj4xg10r

def evidence_custodial_uninformedPayload :=
  "As evidence that many people waive Miranda rights without understanding them, I cite Rogers et al. (2011), finding 31% of 149 pretrial defendants wrongly believed their silence could be used as evidence of guilt, and Leo (1996), 86 J. Crim. L. & Criminology 266, finding 78% of observed suspects waived"
axiom evidence_custodial_uninformed_auth : Axiom.AuthenticatedTerm ("err313", evidence_custodial_uninformedPayload, 1792161516)
def evidence_custodial_uninformed : Axiom.Statement "err313" evidence_custodial_uninformedPayload 1792161516 := ⟨evidence_custodial_uninformed_auth⟩

def evidence_custodial_outcomesPayload :=
  "As evidence that uninformed suspects end up with weaker cases, I cite Leo (1996), finding suspects who made incriminating statements were 26% more likely to be convicted, Kassin & Norwick (2004), finding 81% of innocent versus 36% of guilty participants waived, and the Innocence Project, reporting false confessions in 29% of 375 DNA exonerations; no study yet directly measures whether informed suspects talk less"
axiom evidence_custodial_outcomes_auth : Axiom.AuthenticatedTerm ("err313", evidence_custodial_outcomesPayload, 1792161516)
def evidence_custodial_outcomes : Axiom.Statement "err313" evidence_custodial_outcomesPayload 1792161516 := ⟨evidence_custodial_outcomes_auth⟩

def evidence_law_does_not_requirePayload :=
  "As evidence that United States law does not require informing people of consequences, I cite Oregon v. Elstad (1985), Moran v. Burbine (1986), and Schneckloth v. Bustamonte (1973)"
axiom evidence_law_does_not_require_auth : Axiom.AuthenticatedTerm ("err313", evidence_law_does_not_requirePayload, 1792161516)
def evidence_law_does_not_require : Axiom.Statement "err313" evidence_law_does_not_requirePayload 1792161516 := ⟨evidence_law_does_not_require_auth⟩

def evidence_on_the_spotPayload :=
  "As evidence about on-the-spot choices, I cite Sommers & Bohns (2019), 128 Yale L.J. 1962, finding 100 of 103 people unlocked their phones for a search and that telling them they could refuse did not significantly reduce compliance, and Newlon, Ayres & Barnett (2021), finding 15.9% of 485 psychiatrists told patients voluntary admission would preserve gun rights, which under 27 CFR 478.11 depends on the state and the procedure"
axiom evidence_on_the_spot_auth : Axiom.AuthenticatedTerm ("err313", evidence_on_the_spotPayload, 1792161516)
def evidence_on_the_spot : Axiom.Statement "err313" evidence_on_the_spotPayload 1792161516 := ⟨evidence_on_the_spot_auth⟩

def evidence_counsel_modelsPayload :=
  "As models for lawyer-before-waiver rules, I cite California Welfare and Institutions Code 625.6 and Washington RCW 13.40.740, which covers consent to search, and as a caution, Pleasence, Kemp & Balmer (2011), finding only about 45% of detainees in England and Wales requested free legal advice when merely offered"
axiom evidence_counsel_models_auth : Axiom.AuthenticatedTerm ("err313", evidence_counsel_modelsPayload, 1792161516)
def evidence_counsel_models : Axiom.Statement "err313" evidence_counsel_modelsPayload 1792161516 := ⟨evidence_counsel_models_auth⟩

def evidence_derived_evidencePayload :=
  "As evidence that excluding answers alone is not enough, I cite United States v. Patane (2004), holding that physical evidence found through an unwarned but voluntary statement can still be used, and as a model for also excluding derived evidence, Kastigar v. United States (1972), upholding immunity that bars both compelled testimony and evidence derived from it"
axiom evidence_derived_evidence_auth : Axiom.AuthenticatedTerm ("err313", evidence_derived_evidencePayload, 1792161516)
def evidence_derived_evidence : Axiom.Statement "err313" evidence_derived_evidencePayload 1792161516 := ⟨evidence_derived_evidence_auth⟩

def evidence_traffic_stopsPayload :=
  "As evidence that answering questions at a traffic stop is an on-the-spot choice without Miranda protection, I cite Berkemer v. McCarty (1984), holding that ordinary traffic stops are not custodial interrogation requiring Miranda warnings"
axiom evidence_traffic_stops_auth : Axiom.AuthenticatedTerm ("err313", evidence_traffic_stopsPayload, 1792161516)
def evidence_traffic_stops : Axiom.Statement "err313" evidence_traffic_stopsPayload 1792161516 := ⟨evidence_traffic_stops_auth⟩

def scope_costs_not_weighedPayload :=
  "I have not weighed the costs of these reforms, such as fewer solved crimes or delays in police work, so this argument claims only that there is strong reason to adopt them, not that they are worth adopting all things considered"
axiom scope_costs_not_weighed_auth : Axiom.AuthenticatedTerm ("err313", scope_costs_not_weighedPayload, 1792161516)
def scope_costs_not_weighed : Axiom.Statement "err313" scope_costs_not_weighedPayload 1792161516 := ⟨scope_costs_not_weighed_auth⟩

def evidence_crisis_capacityPayload :=
  "As evidence that decisions made in a mental health crisis should stay provisional, I cite Owen et al. (2008), BMJ 337:a448, finding 60% of 338 consecutive psychiatric admissions and 39% of voluntary patients lacked capacity for treatment decisions, Owen et al. (2011), Psychological Medicine 41:119, finding many regained capacity within about a month though less often with schizophrenia than with mania or depression, and Zinermon v. Burch (1990), allowing a due process claim by a patient admitted as voluntary while lacking capacity"
axiom evidence_crisis_capacity_auth : Axiom.AuthenticatedTerm ("err313", evidence_crisis_capacityPayload, 1792161516)
def evidence_crisis_capacity : Axiom.Statement "err313" evidence_crisis_capacityPayload 1792161516 := ⟨evidence_crisis_capacity_auth⟩

end pj4xg10r
