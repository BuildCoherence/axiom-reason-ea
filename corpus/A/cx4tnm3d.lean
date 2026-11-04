import Axiom

namespace cx4tnm3d

def RetentionProxy : Prop :=
  "a measure of whether receiving a frame predicts the target replying to a different future tweet by the replier"

def DownstreamCompression : Prop :=
  "a measure of whether receiving a frame reduces the target's own future output length and increases its information density"

def FramedEntropyEmpiricalStatus : Prop :=
  "the measured empirical status of the framed-entropy claim across proxies: retention proxies null, simulation narrowing, downstream compression supportive"

def claim_006_retention_proxy_null_lexicalPayload :=
  "CLAIM-006 finding (2026-08-18, community archive): the lexical-novelty frame proxy does NOT predict cross-referent retention. Framed replies propagated at 0.646 vs echo replies at 0.706 (lift -0.09x), 2025-01 to 2026-06 window. Falsifier fired: framing as word-overlap novelty is not the retention mechanism"
axiom claim_006_retention_proxy_null_lexical_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", claim_006_retention_proxy_null_lexicalPayload, 1787146290)
def claim_006_retention_proxy_null_lexical : Axiom.Statement "hitchhiker2thefuture" claim_006_retention_proxy_null_lexicalPayload 1787146290 := ⟨claim_006_retention_proxy_null_lexical_auth⟩

def claim_006_retention_proxy_null_semanticPayload :=
  "CLAIM-006 finding (2026-08-18, community archive): the semantic-novelty frame proxy (1 - cos of reply and parent embeddings) also does NOT predict cross-referent retention, robust across thresholds. Echo rate 0.42-0.43 vs framed 0.36-0.38 (lift -0.11 to -0.13x) at thresholds 0.5, 0.6, 0.7. Falsifier fired again"
axiom claim_006_retention_proxy_null_semantic_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", claim_006_retention_proxy_null_semanticPayload, 1787146290)
def claim_006_retention_proxy_null_semantic : Axiom.Statement "hitchhiker2thefuture" claim_006_retention_proxy_null_semanticPayload 1787146290 := ⟨claim_006_retention_proxy_null_semantic_auth⟩

def claim_006_simulation_observability_robustPayload :=
  "CLAIM-006 finding (2026-08-18, simulation): a true framing mechanism would be robust to observability. Under the frame_driven engagement rule, frame-richness correlates with influence at +0.52 to +0.96 across fanout and rank-bias observability models. This rules out the hypothesis that the real-archive miss was caused by the platform algorithm swamping framing at low observability"
axiom claim_006_simulation_observability_robust_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", claim_006_simulation_observability_robustPayload, 1787146290)
def claim_006_simulation_observability_robust : Axiom.Statement "hitchhiker2thefuture" claim_006_simulation_observability_robustPayload 1787146290 := ⟨claim_006_simulation_observability_robust_auth⟩

def claim_006_downstream_compression_supportivePayload :=
  "CLAIM-006 finding (2026-08-18, community archive): the outcome hypothesis is supported. Receiving a frame predicts the target's own next output being shorter and denser: mean length 123.7 vs 140.4 baseline (-11.9%) and 135.7 after echo (-8.8%), monotonic across thresholds 0.5-0.7. One instrument, one window; proxy evidence, not confirmation"
axiom claim_006_downstream_compression_supportive_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", claim_006_downstream_compression_supportivePayload, 1787146290)
def claim_006_downstream_compression_supportive : Axiom.Statement "hitchhiker2thefuture" claim_006_downstream_compression_supportivePayload 1787146290 := ⟨claim_006_downstream_compression_supportive_auth⟩

end cx4tnm3d
