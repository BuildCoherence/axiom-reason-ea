import Axiom
import A.ta3nj1a4
import A.r59jf3ak

open scoped r59jf3ak
open ta3nj1a4

namespace zvf2jw0p

rigid universal Person extends Object := "person"
rigid universal CoffeeChain extends ObjectAggregate := "coffee chain"
rigid universal BigCoffeeChain extends CoffeeChain := "big coffee chain"

relation Loves : Person → CoffeeChain := "loves"
relation BuysFrom : Person → CoffeeChain := "buys from"

scoped infix:50 " loves " => Loves
scoped infix:50 " buys-from " => BuysFrom
scoped notation:50 entity:51 " is-a-big-coffee-chain" => BigCoffeeChain.Is entity

syntax:50 term:51 " never-buys-from " term:51 : term
scoped macro_rules
  | `($person:term never-buys-from $kind:term) =>
      `(∀ chain : $kind, ¬ ($person buys-from chain))

def Sam : Type := "@sam"
def Starbucks : Type := "Starbucks"

theorem starbucks_enthymeme_is_contradictory
    (p1 : Sam loves Starbucks)
    (p2 : Sam never-buys-from BigCoffeeChain)
    (p3 : Starbucks is-a-big-coffee-chain)
    (p4 : ∀ person coffeeChain,
      person loves coffeeChain → person buys-from coffeeChain) :
    False := by
  let sam : Person := ⟨Sam, p1.inst0⟩
  let starbucks : CoffeeChain := ⟨Starbucks, p1.inst1⟩
  let bigStarbucks : BigCoffeeChain := ⟨Starbucks, p3⟩
  exact p2 bigStarbucks (p4 sam starbucks p1)

end zvf2jw0p
