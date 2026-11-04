import Axiom

namespace cyx9q0r6

def OperatingMargin : Prop :=
  "operating income as a percentage of revenue"

def FrontierRAndDIntensity : Prop :=
  "research and development expense as a percentage of revenue"

def CorporateOverheadRatio : Prop :=
  "general and administrative plus research and development expense as a percentage of revenue"

def CohortMarginExpansion : Prop :=
  "the number of companies in a defined cohort whose operating margin expanded year over year"

def EnterpriseAIMarginQuestion : Prop :=
  "whether enterprise AI deployment is actively driving operating margin expansion, or strong core fundamentals are simply absorbing the inference bill"

def enterprise_ai_claim_001_meta_marginPayload :=
  "CLAIM-001 (source: AcadeResearch 9-company AI margin cross-section, 2026-08-16): Meta's operating margin will recover from 30.9% toward at least 36% by end of 2026 as frontier R&D intensity stabilizes. Falsifier: Meta operating margin at 4Q26 remains at or below 31%, or R&D remains above 34% of revenue"
axiom enterprise_ai_claim_001_meta_margin_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", enterprise_ai_claim_001_meta_marginPayload, 1787052985)
def enterprise_ai_claim_001_meta_margin : Axiom.Statement "hitchhiker2thefuture" enterprise_ai_claim_001_meta_marginPayload 1787052985 := ⟨enterprise_ai_claim_001_meta_margin_auth⟩

def enterprise_ai_claim_002_uber_overheadPayload :=
  "CLAIM-002 (source: AcadeResearch 9-company AI margin cross-section, 2026-08-16): Uber's general and administrative plus research and development expense as a percentage of revenue will decline by at least 1 percentage point by end of 2026 if AI coding-tool adoption is actually compressing corporate overhead. Falsifier: Uber G&A plus R&D combined remain at or above 14% of revenue at 4Q26"
axiom enterprise_ai_claim_002_uber_overhead_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", enterprise_ai_claim_002_uber_overheadPayload, 1787052985)
def enterprise_ai_claim_002_uber_overhead : Axiom.Statement "hitchhiker2thefuture" enterprise_ai_claim_002_uber_overheadPayload 1787052985 := ⟨enterprise_ai_claim_002_uber_overhead_auth⟩

def enterprise_ai_claim_003_cohort_marginPayload :=
  "CLAIM-003 (source: AcadeResearch 9-company AI margin cross-section, 2026-08-16): across the 9-company AI cohort, the year-over-year operating margin expansion is primarily explained by pre-2023 cost discipline and core operating leverage, not by AI deployment. Falsifier: companies with the most legible AI spend (e.g. Meta's R&D step-up) also show the largest margin gain, or margin gains concentrate in firms with no AI cost program"
axiom enterprise_ai_claim_003_cohort_margin_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", enterprise_ai_claim_003_cohort_marginPayload, 1787052985)
def enterprise_ai_claim_003_cohort_margin : Axiom.Statement "hitchhiker2thefuture" enterprise_ai_claim_003_cohort_marginPayload 1787052985 := ⟨enterprise_ai_claim_003_cohort_margin_auth⟩

end cyx9q0r6
