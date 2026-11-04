import Axiom
import A.t0d1zdc3
import A.gwcwyrvb
import A.ta3nj1a4
import A.r59jf3ak

open ta3nj1a4
open r59jf3ak

namespace ffjw87je


scoped instance : Axiom.IsReferent Rat := ⟨0⟩
scoped instance : Axiom.IsReferent (List Type) := ⟨[]⟩

rigid universal Economy extends ObjectAggregate := "economy"
rigid universal EconomicAgent extends MaterialEntity := "economic agent"

def allocationShare : Type → Type → Type → Rat :=
  "share of the authority to direct the real resources of economy {0} that is held by {1} at {2}"

def agentsOf : Type → Type → List Type :=
  "the exhaustive list of economic agents in economy {0} at {1}"

relation AllocatesBetterThan : EconomicAgent → EconomicAgent := "allocates real resources better than"
scoped infix:50 " allocates-better-than " => AllocatesBetterThan

relation RaisesLongRunOutputOf : Process → Economy := "raises the long-run real output of"
scoped infix:50 " raises-long-run-output-of " => RaisesLongRunOutputOf

end ffjw87je
