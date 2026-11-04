import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.mwh5b5da
import A.xhnxzf59
import A.d4qbfhxh
import A.vpg72gwr
import A.g0c1njxx

open g0c1njxx

open t0d1zdc3
open gwcwyrvb
open mwh5b5da
open xhnxzf59
open d4qbfhxh
open Dictionary

namespace f8gz4evn

namespace Actions

def PersonsAreAgents : Prop :=
  ∀ x : Type, Person.Is x → Agent.Is x

def personAsAgent (bridge : PersonsAreAgents) (person : Person) : Agent :=
  ⟨person.val, bridge person.val person.property⟩

inductive OutcomeAchievableForAgent (agent : Agent) (o : Outcome) : State → Time → Prop where
  | already (s : State) (t : Time)
      (holds : o in-state s at-time t) :
      OutcomeAchievableForAgent agent o s t
  | achieved (s : State) (t : Time) (a : Action) (p : Predisposition)
      (predisposed : agent predisposed-toward p)
      (manifests : p is-manifested-by a)
      (feasible: a action-is-feasible-for-agent agent in-state s)
      (produces : a results-in o) :
      OutcomeAchievableForAgent agent o s t
  | intermediate_action (s s' : State) (t t' : Time) (a : Action) (p : Predisposition)
      (predisposed : agent predisposed-toward p)
      (manifests : p is-manifested-by a)
      (feasible: a action-is-feasible-for-agent agent in-state s)
      (transition : Elapses t s a t' s')
      (next_actions : OutcomeAchievableForAgent agent o s' t') :
      OutcomeAchievableForAgent agent o s t

inductive OutcomeAchievedByAgent (agent : Agent) (o : Outcome) : State → Time → Prop where
  | already (s : State) (t : Time)
      (holds : o in-state s at-time t) :
      OutcomeAchievedByAgent agent o s t
  | achieved (s : State) (t : Time) (a : Action) (p : Predisposition)
      (predisposed : agent predisposed-toward p)
      (manifests : p is-manifested-by a)
      (done : agent does a)
      (produces : a results-in o) :
      OutcomeAchievedByAgent agent o s t
  | intermediate_action (s s' : State) (t t' : Time) (a : Action) (p : Predisposition)
      (predisposed : agent predisposed-toward p)
      (manifests : p is-manifested-by a)
      (transition : AgentDoesAction agent a s t s' t')
      (next_actions : OutcomeAchievedByAgent agent o s' t') :
      OutcomeAchievedByAgent agent o s t

def DoingImpliesFeasible : Prop :=
  ∀ (agent : Agent) (s : State) (a : Action), agent does a → (a action-is-feasible-for-agent agent in-state s)

def IsSkillIssueFor (agent : Agent) (o : Outcome) (s : State) (t : Time) : Prop :=
  OutcomeAchievableForAgent agent o s t ∧ ¬ OutcomeAchievedByAgent agent o s t

theorem not_all_outcomes_feasible
    (agent : Agent) (o : Outcome) (s : State) (t : Time)
    (infeasible : ∀ a : Action, ¬ (a results-in o))
    (never_holds : ∀ (s : State) (t : Time), ¬ (o in-state s at-time t)) :
    ¬ OutcomeAchievableForAgent agent o s t := by
  intro h
  induction h with
  | already s t holds => exact never_holds s t holds
  | achieved s t a p predisposed manifests feasible produces => exact infeasible a produces
  | intermediate_action s s' t t' a p predisposed manifests feasible transition next_actions ih =>
      exact ih

theorem achieved_implies_achievable (feasibility : DoingImpliesFeasible)
    {agent : Agent} {o : Outcome} {s : State} {t : Time}
    (h : OutcomeAchievedByAgent agent o s t) : OutcomeAchievableForAgent agent o s t := by
  induction h with
  | already s t holds => exact OutcomeAchievableForAgent.already s t holds
  | achieved s t a p predisposed manifests done produces =>
      exact OutcomeAchievableForAgent.achieved s t a p predisposed manifests
        (feasibility agent s a done) produces
  | intermediate_action s s' t t' a p predisposed manifests transition next_actions ih =>
      obtain ⟨hdoes, helapse⟩ := transition
      exact OutcomeAchievableForAgent.intermediate_action s s' t t' a p predisposed manifests
        (feasibility agent s a hdoes) helapse ih

theorem an_agents_infeasible_actions_are_not_related_to_skill_issues
    (agent : Agent) (o : Outcome) (s : State) (t : Time)
    (infeasible : ∀ a : Action, ¬ (a results-in o))
    (never_holds : ∀ (s : State) (t : Time), ¬ (o in-state s at-time t)) :
    ¬ IsSkillIssueFor agent o s t := by
  intro hissue
  obtain ⟨hach, _⟩ := hissue
  exact not_all_outcomes_feasible agent o s t infeasible never_holds hach

theorem an_agents_feasible_but_not_acted_on_is_a_skill_issue
    (agent : Agent) (o : Outcome) (s : State) (t : Time) (a : Action) (p : Predisposition)
    (predisposed : agent predisposed-toward p)
    (manifests : p is-manifested-by a)
    (feasible : a action-is-feasible-for-agent agent in-state s)
    (produces : a results-in o)
    (not_achieved : ¬ OutcomeAchievedByAgent agent o s t) :
    IsSkillIssueFor agent o s t :=
  ⟨OutcomeAchievableForAgent.achieved s t a p predisposed manifests feasible produces, not_achieved⟩

theorem an_agents_outcome_may_require_two_steps
    (agent : Agent) (o : Outcome) (s0 s1 : State) (t0 t1 : Time)
    (a0 a1 : Action) (p0 p1 : Predisposition)
    (a0_backed : agent predisposed-toward p0) (a0_manifests : p0 is-manifested-by a0)
    (a0_feasible : a0 action-is-feasible-for-agent agent in-state s0)
    (transition : Elapses t0 s0 a0 t1 s1)
    (a1_backed : agent predisposed-toward p1) (a1_manifests : p1 is-manifested-by a1)
    (a1_feasible : a1 action-is-feasible-for-agent agent in-state s1)
    (a1_produces : a1 results-in o)
    (no_one_step : ∀ a : Action, a action-is-feasible-for-agent agent in-state s0 → ¬ (a results-in o)) :
    OutcomeAchievableForAgent agent o s0 t0 ∧
      ¬ (∃ a : Action, a action-is-feasible-for-agent agent in-state s0 ∧ a results-in o) := by
  refine ⟨?_, ?_⟩
  · exact OutcomeAchievableForAgent.intermediate_action s0 s1 t0 t1 a0 p0
      a0_backed a0_manifests a0_feasible transition
      (OutcomeAchievableForAgent.achieved s1 t1 a1 p1 a1_backed a1_manifests a1_feasible a1_produces)
  · rintro ⟨a, ha_poss, ha_res⟩
    exact no_one_step a ha_poss ha_res

theorem infeasible_actions_for_people_are_not_related_to_skill_issues
    (bridge : PersonsAreAgents)
    (person : Person) (o : Outcome) (s : State) (t : Time)
    (infeasible : ∀ a : Action, ¬ (a results-in o))
    (never_holds : ∀ (s : State) (t : Time), ¬ (o in-state s at-time t)) :
    ¬ IsSkillIssueFor (personAsAgent bridge person) o s t :=
  an_agents_infeasible_actions_are_not_related_to_skill_issues (personAsAgent bridge person) o s t infeasible never_holds

theorem feasible_outcomes_that_are_not_acted_on_is_skill_issue_for_people
    (bridge : PersonsAreAgents)
    (person : Person) (o : Outcome) (s : State) (t : Time) (a : Action) (p : Predisposition)
    (predisposed : (personAsAgent bridge person) predisposed-toward p)
    (manifests : p is-manifested-by a)
    (feasible : a action-is-feasible-for-agent (personAsAgent bridge person) in-state s)
    (produces : a results-in o)
    (not_achieved : ¬ OutcomeAchievedByAgent (personAsAgent bridge person) o s t) :
    IsSkillIssueFor (personAsAgent bridge person) o s t :=
  an_agents_feasible_but_not_acted_on_is_a_skill_issue (personAsAgent bridge person) o s t a p
    predisposed manifests feasible produces not_achieved

end Actions

end f8gz4evn
