import Axiom

namespace v2pywa4r

structure HumanpowerInteractionEdge where
  sourceKind : String
  targetKind : String
  interactionKind : String
  touchpoints : Nat
  evidenceBoundary : String

def HumanpowerInteractionGraph : List HumanpowerInteractionEdge := [
  {
    sourceKind := "human",
    targetKind := "local_ai",
    interactionKind := "human_to_local_ai_message",
    touchpoints := 3217,
    evidenceBoundary := "48 CLI sessions in the 2026-07-24 through 2026-08-07 retrospective window"
  },
  {
    sourceKind := "local_ai",
    targetKind := "human",
    interactionKind := "local_ai_to_human_message",
    touchpoints := 33220,
    evidenceBoundary := "assistant messages in the same CLI session window"
  },
  {
    sourceKind := "local_ai",
    targetKind := "local_ai",
    interactionKind := "delegation_to_subagent",
    touchpoints := 118,
    evidenceBoundary := "118 delegate calls producing 108 subagent sessions; task quality and outcome are measured separately"
  },
  {
    sourceKind := "human",
    targetKind := "non_local_ai",
    interactionKind := "Boardy_reply_or_coordination",
    touchpoints := 35,
    evidenceBoundary := "35 deduplicated Boardy replies involving Leo; captured 2026-07-31 through 2026-08-07"
  },
  {
    sourceKind := "human",
    targetKind := "human",
    interactionKind := "archived_call",
    touchpoints := 17,
    evidenceBoundary := "17 unique calls by transcript content hash in the private archive"
  },
  {
    sourceKind := "non_local_ai",
    targetKind := "human",
    interactionKind := "mediated_introduction_join",
    touchpoints := 3,
    evidenceBoundary := "3 high-confidence or explicit Boardy-to-call joins; 4 additional joins remain supporting evidence"
  }
]

def humanpower_interaction_graph_boundaryPayload :=
  "This graph counts observed interaction edges, not equivalent units of work. A message, a delegation, a Boardy reply, a call, and an introduction join have different costs and meanings. The graph therefore preserves edge type, source, target, count, and evidence boundary instead of summing touchpoints into a humanpower score."
axiom humanpower_interaction_graph_boundary_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", humanpower_interaction_graph_boundaryPayload, 1786133236)
def humanpower_interaction_graph_boundary : Axiom.Statement "hitchhiker2thefuture" humanpower_interaction_graph_boundaryPayload 1786133236 := ⟨humanpower_interaction_graph_boundary_auth⟩

def non_local_ai_touchpoint_observationPayload :=
  "The retrospective contains direct evidence that a human interacted with a non-local AI: Boardy replies and Boardy-mediated or Boardy-strategy calls are recorded separately from the local Hermes AI sessions. The current evidence shows search, triage, calendar compression, and introductions; it does not by itself show that every non-local AI touchpoint produced downstream advancement."
axiom non_local_ai_touchpoint_observation_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", non_local_ai_touchpoint_observationPayload, 1786133236)
def non_local_ai_touchpoint_observation : Axiom.Statement "hitchhiker2thefuture" non_local_ai_touchpoint_observationPayload 1786133236 := ⟨non_local_ai_touchpoint_observation_auth⟩

def graph_to_humanpower_transitionPayload :=
  "An interaction edge becomes a humanpower contribution only when it is linked to a validated artifact, a distribution event, a downstream adoption or decision, or a reward event. The next graph revision should attach those transition receipts to edges without exposing private transcript content."
axiom graph_to_humanpower_transition_auth : Axiom.AuthenticatedTerm ("hitchhiker2thefuture", graph_to_humanpower_transitionPayload, 1786133236)
def graph_to_humanpower_transition : Axiom.Statement "hitchhiker2thefuture" graph_to_humanpower_transitionPayload 1786133236 := ⟨graph_to_humanpower_transition_auth⟩

end v2pywa4r
