import Axiom
import Lean

namespace zpg9xh52

/-!
Type-theoretic sets, transcribed for Axiom from Mathlib
(https://github.com/leanprover-community/mathlib4), tag v4.31.0.
Released under the Apache 2.0 license as described in Mathlib's LICENSE file.

Source files and their copyright headers:
* `Mathlib/Data/Set/Defs.lean` — (c) 2016 Microsoft Corporation; Leonardo de Moura
* `Mathlib/Data/Set/Operations.lean` — (c) 2016 Jeremy Avigad; Jeremy Avigad, Johannes Hölzl,
  Reid Barton, Kim Morrison, Patrick Massot, Kyle Miller, Minchao Wu, Yury Kudryashov,
  Floris van Doorn
* `Mathlib/Data/Set/Basic.lean` — (c) 2014 Microsoft Corporation; Leonardo de Moura, Jeremy Avigad
* `Mathlib/Data/Set/Insert.lean`, `Mathlib/Data/Set/CoeSort.lean`, `Mathlib/Order/SetNotation.lean`

Adaptations for this workspace (no Mathlib, Batteries, or module system available):
* `module` / `public` / `@[expose]` / `meta` markers removed.
* Set-builder notation covers `{x | p}`, `{x : t | p}`, and `{x pred | p}` for core binder
  predicates (so `{x ∈ s | p}` works); Batteries extended binders, pattern set-builders, and
  the `{f x y | (x) (y)}` form are omitted.
* `infixr` / `prefix` / `postfix` declarations rewritten as equivalent plain `notation`
  (Axiom's publish transform auto-promotes only `notation` to scoped).
* `sUnion` / `sInter` are defined directly rather than via `SupSet` / `InfSet`; indexed
  `⋃ i, s i` / `⋂ i, s i` are omitted (they require Mathlib's `notation3` engine).
* `⊂` is instantiated directly instead of through the order hierarchy; the `Compl` class is
  declared locally; `Set.image` is defined by explicit comprehension.
* Mathlib-specific attributes (`grind`, `push`, `mfld_simps`, `gcongr`, `to_dual`, `ext`),
  `alias`es, and deprecations are dropped; `simp` and `refl` are kept, declared `scoped`
  per Axiom's namespace rules (activate with `open Set`).
* Proofs marked `-- proof adapted` replace Mathlib proofs that used unavailable lemmas.
-/

universe u v

/-- A set is a collection of elements of some type `α`.

Although `Set` is defined as `α → Prop`, this is an implementation detail which should not be
relied on. Instead, `setOf` and membership of a set (`∈`) should be used to convert between sets
and predicates. -/
def Set (α : Type u) := α → Prop

/-- Turn a predicate `p : α → Prop` into a set, also written as `{x | p x}` -/
def setOf {α : Type u} (p : α → Prop) : Set α :=
  p

/-- Class for the `ᶜ` complement operator (Mathlib `Order/Notation.lean`, reduced). -/
class Compl (α : Type u) where
  /-- Complement -/
  compl : α → α

export Compl (compl)

namespace Set

variable {α : Type u}

/-- Membership in a set -/
protected def Mem (s : Set α) (a : α) : Prop :=
  s a

scoped instance : Membership α (Set α) :=
  ⟨Set.Mem⟩

theorem ext {a b : Set α} (h : ∀ (x : α), x ∈ a ↔ x ∈ b) : a = b :=
  funext (fun x => propext (h x))

/-- The subset relation on sets. `s ⊆ t` means that all elements of `s` are elements of `t`.

Note that you should **not** use this definition directly, but instead write `s ⊆ t`. -/
protected def Subset (s₁ s₂ : Set α) :=
  ∀ ⦃a⦄, a ∈ s₁ → a ∈ s₂

/-- We introduce `≤` before `⊆` to help the unifier when applying lattice theorems
to subset hypotheses. -/
scoped instance : LE (Set α) :=
  ⟨Set.Subset⟩

scoped instance : HasSubset (Set α) :=
  ⟨(· ≤ ·)⟩

scoped instance : HasSSubset (Set α) :=  -- adapted: Mathlib derives `⊂` from the order hierarchy
  ⟨fun s t => s ⊆ t ∧ ¬t ⊆ s⟩

scoped instance : EmptyCollection (Set α) :=
  ⟨fun _ => False⟩

end Set

/-- Set-builder notation: `{x | p x}`, `{x : α | p x}`, and `{x pred | p x}` for core binder
predicates such as `{x ∈ s | p x}` (Mathlib `Data/Set/Defs.lean` `setBuilder`, reduced from
extended binders to a macro). -/
syntax "{" ident " | " term "}" : term
syntax "{" ident " : " term " | " term "}" : term
syntax "{" ident binderPred " | " term "}" : term

scoped macro_rules
  | `({ $x:ident | $p }) => `(setOf fun $x:ident => $p)
  | `({ $x:ident : $t | $p }) => `(setOf fun $x:ident : $t => $p)
  | `({ $x:ident $b:binderPred | $p }) =>
      `(setOf fun $x:ident => satisfies_binder_pred% $x $b ∧ $p)

/-- Unexpander for set builder notation. -/
@[scoped app_unexpander setOf]
def setOf.unexpander : Lean.PrettyPrinter.Unexpander
  | `($_ fun $x:ident ↦ $p) => `({ $x:ident | $p })
  | `($_ fun ($x:ident : $ty:term) ↦ $p) => `({ $x:ident : $ty:term | $p })
  | _ => throw ()

namespace Set

variable {α : Type u} {β : Type v}

/-- The universal set on a type `α` is the set containing all elements of `α`. -/
def univ : Set α := {_a | True}

/-- `Set.insert a s` is the set `{a} ∪ s`. Write it as `insert a s`. -/
protected def insert (a : α) (s : Set α) : Set α := {b | b = a ∨ b ∈ s}

scoped instance : Insert α (Set α) := ⟨Set.insert⟩

/-- The singleton of an element `a` is the set with `a` as a single element. Write it `{a}`. -/
protected def singleton (a : α) : Set α := {b | b = a}

scoped instance instSingletonSet : Singleton α (Set α) := ⟨Set.singleton⟩

/-- The union of two sets `s` and `t`. Write it `s ∪ t`. -/
protected def union (s₁ s₂ : Set α) : Set α := {a | a ∈ s₁ ∨ a ∈ s₂}

scoped instance : Union (Set α) := ⟨Set.union⟩

/-- The intersection of two sets `s` and `t`. Write it `s ∩ t`. -/
protected def inter (s₁ s₂ : Set α) : Set α := {a | a ∈ s₁ ∧ a ∈ s₂}

scoped instance : Inter (Set α) := ⟨Set.inter⟩

/-- The complement of a set `s`. Write it `sᶜ`. -/
protected def compl (s : Set α) : Set α := {a | a ∉ s}

scoped instance : Compl (Set α) := ⟨Set.compl⟩

/-- The difference of two sets `s` and `t`. Write it `s \ t`. -/
protected def diff (s t : Set α) : Set α := {a ∈ s | a ∉ t}

scoped instance : SDiff (Set α) := ⟨Set.diff⟩

/-- `𝒫 s` is the set of all subsets of `s`. -/
def powerset (s : Set α) : Set (Set α) := {t | t ⊆ s}

/-- The image of `s : Set α` by `f : α → β`, written `f '' s`. -/
def image (f : α → β) (s : Set α) : Set β := {b | ∃ a ∈ s, f a = b}
  -- adapted: Mathlib writes `{f a | a ∈ s}` via extended binders

/-- The preimage of `s : Set β` by `f : α → β`, written `f ⁻¹' s`. -/
def preimage (f : α → β) (s : Set β) : Set α := {x | f x ∈ s}

/-- The property `s.Nonempty` expresses the fact that the set `s` is not empty. -/
protected def Nonempty (s : Set α) : Prop :=
  ∃ x, x ∈ s

/-- Intersection of a set of sets. -/
def sInter (S : Set (Set α)) : Set α := {a | ∀ t ∈ S, a ∈ t}
  -- adapted: Mathlib defines this as `sInf`

/-- Union of a set of sets. -/
def sUnion (S : Set (Set α)) : Set α := {a | ∃ t ∈ S, a ∈ t}
  -- adapted: Mathlib defines this as `sSup`

/-- Coercion from a set to the corresponding subtype (Mathlib `Data/Set/CoeSort.lean`). -/
def Elem (s : Set α) : Type u := { x // x ∈ s }

scoped instance : CoeSort (Set α) (Type u) := ⟨Elem⟩

end Set

scoped notation:1024 s:1024 "ᶜ" => Compl.compl s
scoped notation:100 "𝒫 " s:100 => Set.powerset s
scoped notation:110 "⋃₀ " S:110 => Set.sUnion S
scoped notation:110 "⋂₀ " S:110 => Set.sInter S
scoped notation:80 f:81 " '' " s:80 => Set.image f s
scoped notation:80 f:81 " ⁻¹' " s:80 => Set.preimage f s

namespace Set

variable {α : Type u} {β : Type v} {s t r : Set α} {a b x : α} {p q : α → Prop}

/-! ### Lemmas about `mem` and `setOf` -/

@[scoped simp]
theorem mem_setOf_eq {x : α} {p : α → Prop} : (x ∈ {y | p y}) = p x := rfl

theorem mem_setOf {a : α} {p : α → Prop} : a ∈ { x | p x } ↔ p a := Iff.rfl

theorem mem_def {a : α} {s : Set α} : a ∈ s ↔ s a := Iff.rfl

theorem notMem_setOf_iff {a : α} {p : α → Prop} : a ∉ { x | p x } ↔ ¬p a := Iff.rfl

@[scoped simp] theorem setOf_mem_eq {s : Set α} : { x | x ∈ s } = s := rfl

theorem setOf_subset_setOf : { a | p a } ⊆ { a | q a } ↔ ∀ a, p a → q a := Iff.rfl

theorem setOf_and : { a | p a ∧ q a } = { a | p a } ∩ { a | q a } := rfl

theorem setOf_or : { a | p a ∨ q a } = { a | p a } ∪ { a | q a } := rfl

/-! ### Subset -/

theorem subset_def : (s ⊆ t) = ∀ x, x ∈ s → x ∈ t := rfl

theorem ssubset_def : (s ⊂ t) = (s ⊆ t ∧ ¬t ⊆ s) := rfl

@[scoped refl]
theorem Subset.refl (a : Set α) : a ⊆ a := fun _ => id

theorem Subset.rfl {s : Set α} : s ⊆ s := Subset.refl s

theorem Subset.trans {a b c : Set α} (ab : a ⊆ b) (bc : b ⊆ c) : a ⊆ c := fun _ h => bc <| ab h

theorem mem_of_eq_of_mem {x y : α} {s : Set α} (hx : x = y) (h : y ∈ s) : x ∈ s :=
  hx.symm ▸ h

theorem Subset.antisymm {a b : Set α} (h₁ : a ⊆ b) (h₂ : b ⊆ a) : a = b :=
  ext fun _ => ⟨fun h => h₁ h, fun h => h₂ h⟩  -- proof adapted

theorem Subset.antisymm_iff {a b : Set α} : a = b ↔ a ⊆ b ∧ b ⊆ a :=
  ⟨fun e => ⟨e ▸ Subset.rfl, e ▸ Subset.rfl⟩, fun ⟨h₁, h₂⟩ => Subset.antisymm h₁ h₂⟩
  -- proof adapted

theorem eq_of_subset_of_subset {a b : Set α} : a ⊆ b → b ⊆ a → a = b :=
  Subset.antisymm

theorem mem_of_subset_of_mem {s₁ s₂ : Set α} {a : α} (h : s₁ ⊆ s₂) : a ∈ s₁ → a ∈ s₂ :=
  @h _

theorem mem_of_mem_of_subset {x : α} {s t : Set α} (hx : x ∈ s) (h : s ⊆ t) : x ∈ t :=
  h hx

theorem notMem_subset (h : s ⊆ t) : a ∉ t → a ∉ s :=
  mt <| mem_of_subset_of_mem h

theorem not_subset : ¬s ⊆ t ↔ ∃ a ∈ s, a ∉ t :=  -- proof adapted (classical)
  ⟨fun h => Classical.byContradiction fun hc =>
      h fun a ha => Classical.byContradiction fun hn => hc ⟨a, ha, hn⟩,
    fun ⟨_, ha, hna⟩ h => hna (h ha)⟩

theorem exists_of_ssubset {s t : Set α} (h : s ⊂ t) : ∃ x ∈ t, x ∉ s :=
  not_subset.1 h.2

/-! ### The empty set and nonemptiness -/

theorem empty_def : (∅ : Set α) = { _x : α | False } := rfl

@[scoped simp]
theorem mem_empty_iff_false (x : α) : x ∈ (∅ : Set α) ↔ False := Iff.rfl

theorem notMem_empty (x : α) : x ∉ (∅ : Set α) := id

@[scoped simp] theorem setOf_false : { _a : α | False } = ∅ := rfl

@[scoped simp]
theorem empty_subset (s : Set α) : ∅ ⊆ s := nofun

@[scoped simp]
theorem subset_empty_iff {s : Set α} : s ⊆ ∅ ↔ s = ∅ :=
  (Subset.antisymm_iff.trans <| and_iff_left (empty_subset _)).symm

theorem eq_empty_iff_forall_notMem {s : Set α} : s = ∅ ↔ ∀ x, x ∉ s :=
  subset_empty_iff.symm

theorem eq_empty_of_forall_notMem (h : ∀ x, x ∉ s) : s = ∅ :=
  subset_empty_iff.1 h

theorem nonempty_def : s.Nonempty ↔ ∃ x, x ∈ s := Iff.rfl

theorem nonempty_of_mem {x} (h : x ∈ s) : s.Nonempty := ⟨x, h⟩

theorem Nonempty.mono (ht : s ⊆ t) (hs : s.Nonempty) : t.Nonempty :=
  hs.imp ht

theorem not_nonempty_iff_eq_empty : ¬s.Nonempty ↔ s = ∅ :=  -- proof adapted
  ⟨fun h => eq_empty_of_forall_notMem fun x hx => h ⟨x, hx⟩,
    fun h hn => hn.elim fun x hx => notMem_empty x (h ▸ hx)⟩

theorem nonempty_iff_ne_empty : s.Nonempty ↔ s ≠ ∅ :=  -- proof adapted (classical)
  ⟨fun ⟨x, hx⟩ h => notMem_empty x (h ▸ hx),
    fun h => Classical.byContradiction fun h' => h (not_nonempty_iff_eq_empty.1 h')⟩

/-! ### The universal set -/

@[scoped simp]
theorem mem_univ (x : α) : x ∈ @univ α := trivial

@[scoped simp] theorem setOf_true : { _x : α | True } = univ := rfl

@[scoped simp]
theorem subset_univ (s : Set α) : s ⊆ univ := fun _ _ => trivial

@[scoped simp]
theorem univ_subset_iff {s : Set α} : univ ⊆ s ↔ s = univ :=  -- proof adapted
  ⟨fun h => Subset.antisymm (subset_univ s) h, fun h => h ▸ Subset.rfl⟩

theorem eq_univ_iff_forall {s : Set α} : s = univ ↔ ∀ x, x ∈ s :=  -- proof adapted
  ⟨fun h x => h.symm ▸ mem_univ x, fun H => ext fun x => ⟨fun _ => trivial, fun _ => H x⟩⟩

theorem eq_univ_of_forall {s : Set α} : (∀ x, x ∈ s) → s = univ :=
  eq_univ_iff_forall.2

/-! ### Union -/

theorem union_def {s₁ s₂ : Set α} : s₁ ∪ s₂ = { a | a ∈ s₁ ∨ a ∈ s₂ } := rfl

theorem mem_union_left {x : α} {a : Set α} (b : Set α) : x ∈ a → x ∈ a ∪ b := Or.inl

theorem mem_union_right {x : α} {b : Set α} (a : Set α) : x ∈ b → x ∈ a ∪ b := Or.inr

@[scoped simp]
theorem mem_union (x : α) (a b : Set α) : x ∈ a ∪ b ↔ x ∈ a ∨ x ∈ b := Iff.rfl

@[scoped simp]
theorem union_self (a : Set α) : a ∪ a = a := ext fun _ => or_self_iff

@[scoped simp]
theorem union_empty (a : Set α) : a ∪ ∅ = a := ext fun _ => iff_of_eq (or_false _)

@[scoped simp]
theorem empty_union (a : Set α) : ∅ ∪ a = a := ext fun _ => iff_of_eq (false_or _)

theorem union_comm (a b : Set α) : a ∪ b = b ∪ a := ext fun _ => or_comm

theorem union_assoc (a b c : Set α) : a ∪ b ∪ c = a ∪ (b ∪ c) := ext fun _ => or_assoc

@[scoped simp]
theorem subset_union_left {s t : Set α} : s ⊆ s ∪ t := fun _ => Or.inl

@[scoped simp]
theorem subset_union_right {s t : Set α} : t ⊆ s ∪ t := fun _ => Or.inr

theorem union_subset {s t r : Set α} (sr : s ⊆ r) (tr : t ⊆ r) : s ∪ t ⊆ r := fun _ =>
  Or.rec (@sr _) (@tr _)

@[scoped simp]
theorem union_subset_iff {s t u : Set α} : s ∪ t ⊆ u ↔ s ⊆ u ∧ t ⊆ u :=  -- proof adapted
  ⟨fun h => ⟨Subset.trans subset_union_left h, Subset.trans subset_union_right h⟩,
    fun ⟨h₁, h₂⟩ => union_subset h₁ h₂⟩

/-! ### Intersection -/

theorem inter_def {s₁ s₂ : Set α} : s₁ ∩ s₂ = { a | a ∈ s₁ ∧ a ∈ s₂ } := rfl

@[scoped simp]
theorem mem_inter_iff (x : α) (a b : Set α) : x ∈ a ∩ b ↔ x ∈ a ∧ x ∈ b := Iff.rfl

theorem mem_inter {x : α} {a b : Set α} (ha : x ∈ a) (hb : x ∈ b) : x ∈ a ∩ b := ⟨ha, hb⟩

theorem mem_of_mem_inter_left {x : α} {a b : Set α} (h : x ∈ a ∩ b) : x ∈ a := h.left

theorem mem_of_mem_inter_right {x : α} {a b : Set α} (h : x ∈ a ∩ b) : x ∈ b := h.right

@[scoped simp]
theorem inter_self (a : Set α) : a ∩ a = a := ext fun _ => and_self_iff

@[scoped simp]
theorem inter_empty (a : Set α) : a ∩ ∅ = ∅ := ext fun _ => iff_of_eq (and_false _)

@[scoped simp]
theorem empty_inter (a : Set α) : ∅ ∩ a = ∅ := ext fun _ => iff_of_eq (false_and _)

theorem inter_comm (a b : Set α) : a ∩ b = b ∩ a := ext fun _ => and_comm

theorem inter_assoc (a b c : Set α) : a ∩ b ∩ c = a ∩ (b ∩ c) := ext fun _ => and_assoc

@[scoped simp]
theorem inter_subset_left {s t : Set α} : s ∩ t ⊆ s := fun _ => And.left

@[scoped simp]
theorem inter_subset_right {s t : Set α} : s ∩ t ⊆ t := fun _ => And.right

theorem subset_inter {s t r : Set α} (rs : r ⊆ s) (rt : r ⊆ t) : r ⊆ s ∩ t := fun _ h =>
  ⟨rs h, rt h⟩

@[scoped simp]
theorem subset_inter_iff {s t r : Set α} : r ⊆ s ∩ t ↔ r ⊆ s ∧ r ⊆ t :=  -- proof adapted
  ⟨fun h => ⟨Subset.trans h inter_subset_left, Subset.trans h inter_subset_right⟩,
    fun ⟨h₁, h₂⟩ => subset_inter h₁ h₂⟩

/-! ### Insert and singleton -/

theorem mem_insert_iff {a b : α} {s : Set α} : a ∈ insert b s ↔ a = b ∨ a ∈ s := Iff.rfl

theorem mem_insert (a : α) (s : Set α) : a ∈ insert a s := Or.inl rfl

theorem mem_insert_of_mem {a : α} {s : Set α} (b : α) : a ∈ s → a ∈ insert b s := Or.inr

@[scoped simp]
theorem mem_singleton_iff {a b : α} : a ∈ ({b} : Set α) ↔ a = b := Iff.rfl

theorem mem_singleton (a : α) : a ∈ ({a} : Set α) := rfl

@[scoped simp]
theorem singleton_subset_iff {a : α} {s : Set α} : {a} ⊆ s ↔ a ∈ s := forall_eq

theorem insert_subset_iff {a : α} {s t : Set α} :
    insert a s ⊆ t ↔ a ∈ t ∧ s ⊆ t :=  -- proof adapted
  ⟨fun h => ⟨h (mem_insert a s), fun _ hx => h (Or.inr hx)⟩,
    fun ⟨ha, hs⟩ _ hx => hx.elim (fun e => e ▸ ha) fun h => hs h⟩

/-! ### Separation `{x ∈ s | p x}` -/

theorem mem_sep (xs : x ∈ s) (px : p x) : x ∈ { x ∈ s | p x } := ⟨xs, px⟩

@[scoped simp]
theorem mem_sep_iff : x ∈ { x ∈ s | p x } ↔ x ∈ s ∧ p x := Iff.rfl

@[scoped simp]
theorem sep_mem_eq : { x ∈ s | x ∈ t } = s ∩ t := rfl

theorem sep_setOf : { x ∈ { y | p y } | q x } = { x | p x ∧ q x } := rfl

/-! ### Complement and difference -/

@[scoped simp]
theorem mem_compl_iff (s : Set α) (x : α) : x ∈ sᶜ ↔ x ∉ s := Iff.rfl

theorem sdiff_eq (s t : Set α) : s \ t = s ∩ tᶜ := rfl

@[scoped simp]
theorem mem_sdiff {s t : Set α} (x : α) : x ∈ s \ t ↔ x ∈ s ∧ x ∉ t := Iff.rfl

theorem mem_sdiff_of_mem {s t : Set α} {x : α} (h1 : x ∈ s) (h2 : x ∉ t) : x ∈ s \ t := ⟨h1, h2⟩

/-! ### Powerset, sUnion, sInter -/

theorem mem_powerset {x s : Set α} (h : x ⊆ s) : x ∈ 𝒫 s := @h

theorem mem_powerset_iff (x s : Set α) : x ∈ 𝒫 s ↔ x ⊆ s := Iff.rfl

@[scoped simp]
theorem mem_sUnion {x : α} {S : Set (Set α)} : x ∈ ⋃₀ S ↔ ∃ t ∈ S, x ∈ t := Iff.rfl

@[scoped simp]
theorem mem_sInter {x : α} {S : Set (Set α)} : x ∈ ⋂₀ S ↔ ∀ t ∈ S, x ∈ t := Iff.rfl

/-! ### Image and preimage -/

@[scoped simp]
theorem mem_preimage {f : α → β} {s : Set β} {a : α} : a ∈ f ⁻¹' s ↔ f a ∈ s := Iff.rfl

@[scoped simp]
theorem mem_image (f : α → β) (s : Set α) (y : β) : y ∈ f '' s ↔ ∃ x ∈ s, f x = y := Iff.rfl

theorem mem_image_of_mem (f : α → β) {x : α} {a : Set α} (h : x ∈ a) : f x ∈ f '' a :=
  ⟨_, h, rfl⟩

/-! ### Coercion to a subtype -/

theorem coe_eq_subtype (s : Set α) : ↥s = { x // x ∈ s } := rfl

@[scoped simp]
theorem coe_setOf (p : α → Prop) : ↥{ x | p x } = { x // p x } := rfl

end Set

namespace Set

scoped instance {α : Type u} (s : Set α) : CoeTC s α := ⟨fun x => x.1⟩

end Set

open Set in
theorem SetCoe.ext {α : Type u} {s : Set α} {a b : s} : (a : α) = b → a = b :=
  Subtype.ext

open Set in
theorem Subtype.mem {α : Type u} {s : Set α} (p : s) : (p : α) ∈ s :=
  p.2

end zpg9xh52
