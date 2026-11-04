import Axiom
import Lean
import A.vpg72gwr
import A.mwh5b5da

open mwh5b5da

open Lean vpg72gwr.BFO

namespace r59jf3ak

-- ---------------------------------------------------------------------------
-- The `universal` / `rigid universal` / `relation` macro library. Relation
-- slots may be classified universals, raw `Type` / `Prop`, or ordinary Lean
-- data types.
--
-- Everything these macros emit is a plain `def` / `abbrev` over the shared
-- classification classes, so two users who write the same declaration in
-- different files denote definitionally equal predicates — identity rides on
-- the semantic string (or term) behind `<Name>.U`, not on the declaring file.
--
-- Every grammar below carries `(priority := high)`: when another library in
-- the import closure registers the same command shapes, these parsers win
-- the parse regardless of import order. The winning parse commits before
-- elaboration begins — no other interpretation is retried afterwards — so
-- which macro fires is decided entirely at parse time.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- `universal` — non-rigid (phase/role): time-indexed membership only, no bare Type.
-- ---------------------------------------------------------------------------

def universalIdent (name : Lean.TSyntax `ident) (suffix : String) : Lean.TSyntax `ident :=
  Lean.mkIdent (name.getId.str suffix)

/-- Single-component instance name (`pfx ++ name ++ sfx`) in the current
    namespace. Instance names must stay single-component: a dotted name like
    `Person.instCoeHeadEver` would land the `scoped instance` in the `Person`
    namespace, where it is never activated. -/
def universalInstIdent (pfx : String) (name : Lean.TSyntax `ident) (sfx : String) : Lean.TSyntax `ident :=
  Lean.mkIdent (Lean.Name.mkSimple (pfx ++ name.getId.toString ++ sfx))

/-- Attribute kind for macro-emitted instances: `scoped` when expanding inside
    a namespace, global at the file root (where Lean rejects `scoped`).
    Top-level local authoring therefore elaborates, with the instances ambient
    in the author's workspace — the same lifecycle hand-written top-level
    instances already get. Published elaboration always happens inside the
    file-id wrapper namespace, so published expansions always emit `scoped`
    and activation stays consensual (namespaces.md rule 2). -/
def universalInstAttrKind : Lean.MacroM (Lean.TSyntax ``Lean.Parser.Term.attrKind) := do
  if (← Lean.Macro.getCurrNamespace).isAnonymous then
    `(Lean.Parser.Term.attrKind|)
  else
    `(Lean.Parser.Term.attrKind| scoped)

syntax (name := universalCmd) (priority := high) "universal " ident " := " term : command
syntax (name := universalExtendsCmd) (priority := high) "universal " ident " extends " ident " := " term : command

scoped macro_rules
  | `(universal $name:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameAt   := universalIdent name "At"
      let nameEver := universalIdent name "Ever"
      let nameAsUniversal := universalIdent name "asUniversal"
      let everCoe := universalInstIdent "instCoeHead" name "Ever"
      let ak ← universalInstAttrKind
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        abbrev $nameAt : Type → Type → Prop := UniversalAt $nameU
        abbrev $nameEver : Type 1 :=
          { x : Type // ∃ t : Type, $nameAt x t ∧ InstanceOf t TemporalRegion t }
        $ak:attrKind instance $everCoe:ident : CoeHead $nameEver Type := ⟨Subtype.val⟩)
  | `(universal $name:ident extends $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameAt   := universalIdent name "At"
      let parentAt := universalIdent parent "At"
      let nameEver := universalIdent name "Ever"
      let nameAsUniversal := universalIdent name "asUniversal"
      let atToParent := universalInstIdent "inst" name "AtToParent"
      let everCoe := universalInstIdent "instCoeHead" name "Ever"
      let ak ← universalInstAttrKind
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        abbrev $nameAt : Type → Type → Prop := UniversalAtUnder $nameU $parentAt
        abbrev $nameEver : Type 1 :=
          { x : Type // ∃ t : Type, $nameAt x t ∧ InstanceOf t TemporalRegion t }
        $ak:attrKind instance $everCoe:ident : CoeHead $nameEver Type := ⟨Subtype.val⟩
        $ak:attrKind instance $atToParent:ident (x t : Type) [h : $nameAt x t] : $parentAt x t := h.parent)

-- ---------------------------------------------------------------------------
-- `rigid universal` — substantial kind: membership holds whenever the entity exists,
-- so the universal is sound to use as a Type.
-- ---------------------------------------------------------------------------

syntax (name := rigidUniversalCmd) (priority := high) "rigid " "universal " ident " := " term : command
syntax (name := rigidUniversalExtendsCmd) (priority := high) "rigid " "universal " ident " extends " ident " := " term : command
syntax (name := rigidUniversalExtendsNonrigidCmd) (priority := high)
  "rigid " "universal " ident " extends " "nonrigid " ident " := " term : command

scoped macro_rules
  | `(rigid universal $name:ident := $s:term) => do
      let nameU  := universalIdent name "U"
      let nameIs := universalIdent name "Is"
      let nameAt := universalIdent name "At"
      let nameAsUniversal := universalIdent name "asUniversal"
      let ak ← universalInstAttrKind
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        abbrev $nameAt : Type → Type → Prop := UniversalAt $nameU
        abbrev $nameIs : Type → Prop := RigidlyIs $nameAt
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        $ak:attrKind instance : CoeHead $name Type := ⟨Subtype.val⟩
        $ak:attrKind instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩)
  | `(rigid universal $name:ident extends $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameIs   := universalIdent name "Is"
      let nameAt   := universalIdent name "At"
      let parentIs := universalIdent parent "Is"
      let parentAt := universalIdent parent "At"
      let nameAsUniversal := universalIdent name "asUniversal"
      let atToParent := universalInstIdent "inst" name "AtToParent"
      let isToParent := universalInstIdent "inst" name "IsToParent"
      let ak ← universalInstAttrKind
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        abbrev $nameAt : Type → Type → Prop := UniversalAtUnder $nameU $parentAt
        abbrev $nameIs : Type → Prop := RigidlyIsUnder $nameAt $parentIs
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        $ak:attrKind instance : CoeHead $name Type := ⟨Subtype.val⟩
        $ak:attrKind instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩
        $ak:attrKind instance $atToParent:ident (x t : Type) [h : $nameAt x t] : $parentAt x t := h.parent
        $ak:attrKind instance $isToParent:ident (x : Type) [h : $nameIs x] : $parentIs x := h.parent
        $ak:attrKind instance : Coe $name $parent := ⟨fun v => ⟨v.val, v.property.parent⟩⟩)
  | `(rigid universal $name:ident extends nonrigid $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameIs   := universalIdent name "Is"
      let nameAt   := universalIdent name "At"
      let parentAt := universalIdent parent "At"
      let nameAsUniversal := universalIdent name "asUniversal"
      let atToParent := universalInstIdent "inst" name "AtToParent"
      let ak ← universalInstAttrKind
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        abbrev $nameAt : Type → Type → Prop := UniversalAtUnder $nameU $parentAt
        abbrev $nameIs : Type → Prop := RigidlyIs $nameAt
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        $ak:attrKind instance : CoeHead $name Type := ⟨Subtype.val⟩
        $ak:attrKind instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩
        $ak:attrKind instance $atToParent:ident (x t : Type) [h : $nameAt x t] : $parentAt x t := h.parent)

-- ---------------------------------------------------------------------------
-- `relation` — defines a proposition-valued relation whose arguments are
-- classified Axiom particulars and/or ordinary Lean data, as a conjunction of
-- the declared ontology constraints and the relation payload.
--
-- relation MurdersIn : Person → Person → Murder := "murders in"
-- relation HasAge : Person → Nat := "has age in years"
--
-- expand to:
--
-- abbrev MurdersIn (arg0 arg1 arg2 : Type) : Prop :=
--   Person.Is arg0 ∧ Person.Is arg1 ∧ Murder.Is arg2 ∧
--     ("murders in" : Type → Type → Type → Prop) arg0 arg1 arg2
-- abbrev HasAge (arg0 : Type) (arg1 : Nat) : Prop :=
--   Person.Is arg0 ∧ ("has age in years" : Type → Nat → Prop) arg0 arg1
-- def MurdersIn.inst0 … (h : MurdersIn arg0 arg1 arg2) : Person.Is arg0 := …
-- def MurdersIn.relation … : ("murders in" : Type → Type → Type → Prop) arg0 arg1 arg2 := …
-- def MurdersIn.mk … [inst0 : Person.Is arg0] … (relation : …) : MurdersIn arg0 arg1 arg2 := …
--
-- Slot classification: `Type` / `Prop` slots stay raw (no constraint); an
-- identifier whose `<X>.Is` resolves in scope is a rigid-universal slot (Type
-- binder, `<X>.Is arg` conjunct, raw payload slot `Type`); any other slot —
-- an unresolvable identifier like `Nat`, or a parenthesized compound type
-- like `(List Nat)` — is a data slot, bound at itself and typed at itself in
-- the raw payload signature. Constraint accessors are `inst<argIndex>`, so
-- raw and data slots leave index gaps.
--
-- The payload semantic string is typed at the RAW single-sorted signature
-- (`Type → … → Prop`, with data slots at their own type), never at the
-- declaring file's subtype telescope, so two files declaring the same
-- relation share the same kernel-level payload constant. Classification
-- travels beside the payload as `∧`-conjuncts.
-- ---------------------------------------------------------------------------

def relationLocalIdent (name : String) : TSyntax `ident :=
  mkIdent (Name.mkSimple name)

def relationArgIdent (i : Nat) : TSyntax `ident :=
  relationLocalIdent s!"arg{i}"

def relationIsTypeTerm (ty : TSyntax `term) : Bool :=
  ty.raw.isOfKind ``Lean.Parser.Term.type

def relationIsPropTerm (ty : TSyntax `term) : Bool :=
  ty.raw.isOfKind ``Lean.Parser.Term.prop

def relationFlattenArrowAux (fuel : Nat) (sig : TSyntax `term) :
    MacroM (Array (TSyntax `term)) := do
  match fuel with
  | 0 => return #[sig]
  | fuel + 1 =>
      match sig.raw with
      | Syntax.node _ kind #[lhs, _, rhs] =>
          if kind == ``Lean.Parser.Term.arrow then
            return #[⟨lhs⟩] ++ (← relationFlattenArrowAux fuel ⟨rhs⟩)
          else
            return #[sig]
      | _ =>
          return #[sig]

def relationFlattenArrow (sig : TSyntax `term) : MacroM (Array (TSyntax `term)) :=
  relationFlattenArrowAux 128 sig

def relationTermIsIdentNamed (ty : TSyntax `term) (target : Name) : Bool :=
  match ty.raw with
  | Syntax.ident _ _ name _ => name == target
  | _ => false

def relationTermIsSimpleIdent (ty : TSyntax `term) (target : String) : Bool :=
  relationTermIsIdentNamed ty (Name.mkSimple target)

def relationSegmentSlotAsTerm (slot : Syntax) : MacroM (TSyntax `term) := do
  match slot with
  | Syntax.ident _ _ _ _ => pure ⟨slot⟩
  | Syntax.node _ `token.Type _ => `(Type)
  | Syntax.node _ `token.Prop _ => `(Prop)
  | Syntax.node _ ``Lean.Parser.Term.paren _ => pure ⟨slot⟩
  | _ => Lean.Macro.throwError "expected relation type slot"

/-- One classified relation slot: how it binds, how it appears in the raw
    payload signature, and its classification constraint (if any). -/
structure RelationSlotSpec where
  binderTy : TSyntax `term
  rawTy : TSyntax `term
  constraint? : Option (TSyntax `ident)

/-- Classify a slot: `Type` / `Prop` stay raw; an identifier whose `<X>.Is`
    resolves in the current scope is a rigid-universal slot; anything else is
    a data slot, bound at itself and typed at itself. -/
def relationSlotSpecOfTerm (ty : TSyntax `term) : MacroM RelationSlotSpec := do
  if relationIsPropTerm ty || relationTermIsSimpleIdent ty "Prop" then
    return { binderTy := ← `(Prop), rawTy := ← `(Prop), constraint? := none }
  if relationIsTypeTerm ty || relationTermIsSimpleIdent ty "Type" then
    return { binderTy := ← `(Type), rawTy := ← `(Type), constraint? := none }
  match ty.raw with
  | Syntax.ident _ _ name _ =>
      let cands ← Lean.Macro.resolveGlobalName (name.str "Is")
      if cands.any (fun c => c.2.isEmpty) then
        return { binderTy := ← `(Type), rawTy := ← `(Type),
                 constraint? := some (mkIdent (name.str "Is")) }
      return { binderTy := ty, rawTy := ty, constraint? := none }
  | _ => return { binderTy := ty, rawTy := ty, constraint? := none }

def relationCurriedPropType (args : List (TSyntax `term)) : MacroM (TSyntax `term) := do
  match args with
  | [] => `(Prop)
  | arg :: rest =>
      let tail ← relationCurriedPropType rest
      `($arg:term → $tail:term)

def relationApplyArgs (fn : TSyntax `term) (args : List (TSyntax `ident)) :
    MacroM (TSyntax `term) := do
  match args with
  | [] => pure fn
  | arg :: rest =>
      relationApplyArgs (← `($fn:term $arg:ident)) rest

/-- Right-nested conjunction of `conjuncts` ending in `payload`. -/
def relationAndChain (conjuncts : List (TSyntax `term)) (payload : TSyntax `term) :
    MacroM (TSyntax `term) := do
  match conjuncts with
  | [] => pure payload
  | c :: rest =>
      let tail ← relationAndChain rest payload
      `($c:term ∧ $tail:term)

/-- Projection into a right-nested `∧`-chain: `rights` `.right`s, then one
    `.left` when `left` is set. -/
def relationProjTerm (h : TSyntax `term) (rights : Nat) (left : Bool) :
    MacroM (TSyntax `term) := do
  let mut e := h
  for _ in [0:rights] do
    e ← `(($e:term).right)
  if left then `(($e:term).left) else pure e

def relationIdentAsTerm (id : TSyntax `ident) : TSyntax `term :=
  ⟨id.raw⟩

/-- Emit the relation `abbrev` plus its accessor and constructor helpers. -/
def relationEmit
    (name : TSyntax `ident)
    (params iparams : Array (TSyntax ``Lean.Parser.Term.bracketedBinder))
    (argNames : Array (TSyntax `ident))
    (conjuncts : Array (Name × TSyntax `term))
    (payload : TSyntax `term) : MacroM Syntax := do
  let body ← relationAndChain (conjuncts.map (·.2)).toList payload
  let relApp ← relationApplyArgs (relationIdentAsTerm name) argNames.toList
  let hId := relationLocalIdent "h"
  let hTerm := relationIdentAsTerm hId
  let mut cmds : Array Syntax := #[]
  cmds := cmds.push
    (← `(abbrev $name:ident $params:bracketedBinder* : Prop := $body:term))
  -- Classification accessors (`inst0` / named), then the payload accessor.
  for k in [0:conjuncts.size] do
    let (accName, accTy) := conjuncts[k]!
    let accId := mkIdent (name.getId ++ accName)
    let proj ← relationProjTerm hTerm k true
    cmds := cmds.push
      (← `(@[reducible] def $accId:ident $iparams:bracketedBinder* ($hId:ident : $relApp:term) :
            $accTy:term := $proj:term))
  let relAccId := mkIdent (name.getId ++ `relation)
  let relProj ← relationProjTerm hTerm conjuncts.size false
  cmds := cmds.push
    (← `(def $relAccId:ident $iparams:bracketedBinder* ($hId:ident : $relApp:term) :
          $payload:term := $relProj:term))
  -- Smart constructor: classification via instance synthesis, payload explicit.
  let mkId := mkIdent (name.getId ++ `mk)
  let relBinderId := relationLocalIdent "relation"
  let mut instBinders : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  for (accName, accTy) in conjuncts do
    let instId := mkIdent accName
    instBinders := instBinders.push (← `(bracketedBinder| [$instId:ident : $accTy:term]))
  let mut ctorVal := relationIdentAsTerm relBinderId
  for (accName, _) in conjuncts.reverse do
    let instId := mkIdent accName
    ctorVal ← `(⟨$(relationIdentAsTerm instId):term, $ctorVal:term⟩)
  cmds := cmds.push
    (← `(def $mkId:ident $iparams:bracketedBinder* $instBinders:bracketedBinder*
          ($relBinderId:ident : $payload:term) : $relApp:term := $ctorVal:term))
  return mkNullNode cmds

def relationBuildFromTypesCommand
    (name : TSyntax `ident)
    (argTypes : Array (TSyntax `term))
    (rhs : TSyntax `term) :
    MacroM Syntax := do
  if argTypes.isEmpty then
    Lean.Macro.throwError "relation requires at least one argument type"
  let slots ← argTypes.mapM relationSlotSpecOfTerm
  let argNames := argTypes.mapIdx fun i _ => relationArgIdent i
  let mut params : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  let mut iparams : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  let mut conjuncts : Array (Name × TSyntax `term) := #[]
  let mut i := 0
  for (slot, arg) in slots.zip argNames do
    let bty := slot.binderTy
    params := params.push (← `(bracketedBinder| ($arg:ident : $bty:term)))
    iparams := iparams.push (← `(bracketedBinder| {$arg:ident : $bty:term}))
    if let some c := slot.constraint? then
      conjuncts := conjuncts.push (Name.mkSimple s!"inst{i}", ← `($c:ident $arg:ident))
    i := i + 1
  let rawType ← relationCurriedPropType (slots.map (·.rawTy)).toList
  let payload ← relationApplyArgs (← `(($rhs:term : $rawType:term))) argNames.toList
  relationEmit name params iparams argNames conjuncts payload

def relationBuildArrowCommand (name : TSyntax `ident) (sig rhs : TSyntax `term) :
    MacroM Syntax := do
  relationBuildFromTypesCommand name (← relationFlattenArrow sig) rhs

def relationStringLiteralValue (s : TSyntax `str) : MacroM String :=
  match s.raw.isStrLit? with
  | some value => pure value
  | none => Lean.Macro.throwError "expected relation phrase string literal"

/-- Template string for phrase segments: optional leading text, one text
    segment between consecutive slots, optional trailing text. Interleaved
    shapes (`Person "murders" Person`) produce `"{0} murders {1}"`. -/
def relationPhraseTemplate
    (leading? : Option String) (mids : Array String) (trailing? : Option String) :
    String := Id.run do
  let mut s := match leading? with
    | some l => l ++ " {0}"
    | none => "{0}"
  for j in [0:mids.size] do
    s := s ++ " " ++ mids[j]! ++ " {" ++ toString (j + 1) ++ "}"
  if let some t := trailing? then
    s := s ++ " " ++ t
  return s

def relationBuildSegmentedCommand
    (name : TSyntax `ident)
    (leading? : Option (TSyntax `str))
    (argTypes : Array (TSyntax `term))
    (mids : Array (TSyntax `str))
    (trailing? : Option (TSyntax `str)) : MacroM Syntax := do
  if leading?.isNone && mids.isEmpty && trailing?.isNone then
    Lean.Macro.throwError "segmented relation requires at least one phrase segment"
  let leadingV ← leading?.mapM relationStringLiteralValue
  let midVs ← mids.mapM relationStringLiteralValue
  let trailingV ← trailing?.mapM relationStringLiteralValue
  let template := Syntax.mkStrLit (relationPhraseTemplate leadingV midVs trailingV)
  relationBuildFromTypesCommand name argTypes ⟨template⟩

structure RelationNamedState where
  params : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  iparams : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  args : Array (TSyntax `ident) := #[]
  conjuncts : Array (Name × TSyntax `term) := #[]
  nextInst : Nat := 0

def relationAddExplicitBinder
    (state : RelationNamedState)
    (ids : Array (TSyntax `ident))
    (ty : TSyntax `term) : MacroM RelationNamedState := do
  let slot ← relationSlotSpecOfTerm ty
  ids.foldlM (init := state) fun state id => do
    let bty := slot.binderTy
    let param ← `(bracketedBinder| ($id:ident : $bty:term))
    let iparam ← `(bracketedBinder| {$id:ident : $bty:term})
    let mut conjuncts := state.conjuncts
    let mut nextInst := state.nextInst
    if let some c := slot.constraint? then
      conjuncts := conjuncts.push (Name.mkSimple s!"inst{nextInst}", ← `($c:ident $id:ident))
      nextInst := nextInst + 1
    pure
      { state with
        params := state.params.push param
        iparams := state.iparams.push iparam
        args := state.args.push id
        conjuncts := conjuncts
        nextInst := nextInst }

def relationAddNamedInstBinder
    (state : RelationNamedState)
    (id : TSyntax `ident)
    (ty : TSyntax `term) : MacroM RelationNamedState := do
  pure
    { state with
      conjuncts := state.conjuncts.push (id.getId, ty)
      nextInst := state.nextInst + 1 }

def relationAddAnonInstBinder
    (state : RelationNamedState)
    (ty : TSyntax `term) : MacroM RelationNamedState := do
  let id := relationLocalIdent s!"inst{state.nextInst}"
  relationAddNamedInstBinder state id ty

def relationAddBinder
    (state : RelationNamedState)
    (binder : TSyntax ``Lean.Parser.Term.bracketedBinder) : MacroM RelationNamedState := do
  match binder with
  | `(bracketedBinder| ($ids:ident* : $ty:term)) =>
      relationAddExplicitBinder state ids ty
  | `(bracketedBinder| [$id:ident : $ty:term]) =>
      relationAddNamedInstBinder state id ty
  | `(bracketedBinder| [$ty:term]) =>
      relationAddAnonInstBinder state ty
  | _ =>
      Lean.Macro.throwError
        "relation named binders support explicit binders (x : Type), universal sugar (x : Person), data binders (n : Nat), and instance binders [C x]"

def relationBuildNamedCommand
    (name : TSyntax `ident)
    (binders : Array (TSyntax ``Lean.Parser.Term.bracketedBinder))
    (result rhs : TSyntax `term) : MacroM Syntax := do
  let state ← binders.foldlM relationAddBinder {}
  if state.args.isEmpty then
    Lean.Macro.throwError "relation named-binder form requires at least one explicit argument binder"
  let payload ← `(($rhs:term : $result:term))
  relationEmit name state.params state.iparams state.args state.conjuncts payload

syntax (name := relationArrowCmd) (priority := high) "relation" ident " : " term " := " term : command
syntax (name := relationNamedCmd) (priority := high)
  "relation" ident bracketedBinder+ " : " term " := " term : command

scoped macro_rules
  | `(relation $name:ident : $sig:term := $rhs:term) =>
      relationBuildArrowCommand name sig rhs
  | `(relation $name:ident $binders:bracketedBinder* : $result:term := $rhs:term) =>
      relationBuildNamedCommand name binders result rhs

-- ---------------------------------------------------------------------------
-- Segmented (mixfix) forms: optional leading phrase, interleaved
-- `"phrase" slot` pairs, optional trailing phrase. Slots are universal
-- identifiers, `Type` / `Prop`, data-type identifiers, or parenthesized
-- compound types:
--
--   relation Murders : Person "murders" Person
--   relation Poor : Person "is poor"
--   relation TallestPerson : "the tallest person is" Person
--   relation AgeInYears : Person "is" Nat "years old"
--   relation Ranks : Person "ranks" (List Nat) "favorably"
--
-- The segmented grammars are parse-disjoint from the arrow and named forms:
-- those require ` := `, which no segmented shape accepts, so at most one
-- grammar here parses any given command.
-- ---------------------------------------------------------------------------

syntax (name := relationLeadingSegmentedCmd) (priority := high)
  "relation" ident " : "
    str (ident <|> "Type" <|> "Prop" <|> Lean.Parser.Term.paren)
    (atomic(str (ident <|> "Type" <|> "Prop" <|> Lean.Parser.Term.paren)))* (str)? : command

syntax (name := relationTrailingSegmentedCmd) (priority := high)
  "relation" ident " : "
    (ident <|> "Type" <|> "Prop" <|> Lean.Parser.Term.paren)
    (atomic(str (ident <|> "Type" <|> "Prop" <|> Lean.Parser.Term.paren)))* (str)? : command

def relationSegmentPairs (pairs : Syntax) :
    MacroM (Array (TSyntax `str) × Array (TSyntax `term)) := do
  let mut mids : Array (TSyntax `str) := #[]
  let mut slotTypes : Array (TSyntax `term) := #[]
  for pair in pairs.getArgs do
    mids := mids.push ⟨pair.getArg 0⟩
    slotTypes := slotTypes.push (← relationSegmentSlotAsTerm (pair.getArg 1))
  return (mids, slotTypes)

@[scoped macro relationLeadingSegmentedCmd]
def expandRelationLeadingSegmented : Macro := fun stx => do
  let name : TSyntax `ident := ⟨stx.getArg 1⟩
  let leading : TSyntax `str := ⟨stx.getArg 3⟩
  let first ← relationSegmentSlotAsTerm (stx.getArg 4)
  let (mids, slotTypes) ← relationSegmentPairs (stx.getArg 5)
  let trailingStx := stx.getArg 6
  let trailing? : Option (TSyntax `str) :=
    if trailingStx.getNumArgs == 0 then none else some ⟨trailingStx.getArg 0⟩
  relationBuildSegmentedCommand name (some leading) (#[first] ++ slotTypes) mids trailing?

@[scoped macro relationTrailingSegmentedCmd]
def expandRelationTrailingSegmented : Macro := fun stx => do
  let name : TSyntax `ident := ⟨stx.getArg 1⟩
  let first ← relationSegmentSlotAsTerm (stx.getArg 3)
  let (mids, slotTypes) ← relationSegmentPairs (stx.getArg 4)
  let trailingStx := stx.getArg 5
  let trailing? : Option (TSyntax `str) :=
    if trailingStx.getNumArgs == 0 then none else some ⟨trailingStx.getArg 0⟩
  relationBuildSegmentedCommand name none (#[first] ++ slotTypes) mids trailing?

end r59jf3ak
