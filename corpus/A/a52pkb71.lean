import Axiom
import Lean
import A.vpg72gwr
import A.jz5twd51

open jz5twd51

open Lean vpg72gwr.BFO

namespace a52pkb71

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
    and activation stays consensual. -/
def universalInstAttrKind : Lean.MacroM (Lean.TSyntax ``Lean.Parser.Term.attrKind) := do
  if (← Lean.Macro.getCurrNamespace).isAnonymous then
    `(Lean.Parser.Term.attrKind|)
  else
    `(Lean.Parser.Term.attrKind| scoped)

syntax (name := universalCmd) "universal " ident " := " term : command
syntax (name := universalExtendsCmd) "universal " ident " extends " ident " := " term : command

macro_rules
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

syntax (name := rigidUniversalCmd) "rigid " "universal " ident " := " term : command
syntax (name := rigidUniversalExtendsCmd) "rigid " "universal " ident " extends " ident " := " term : command
syntax (name := rigidUniversalExtendsNonrigidCmd)
  "rigid " "universal " ident " extends " "nonrigid " ident " := " term : command

macro_rules
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
-- Axiom particulars (`Type`s), as a conjunction of the declared ontology
-- constraints and the relation payload.
--
-- relation MurdersIn : Person → Person → Murder := "murders in"
--
-- expands to:
--
-- abbrev MurdersIn (arg0 arg1 arg2 : Type) : Prop :=
--   Person.Is arg0 ∧ Person.Is arg1 ∧ Murder.Is arg2 ∧
--     ("murders in" : Type → Type → Type → Prop) arg0 arg1 arg2
-- def MurdersIn.inst0 … (h : MurdersIn arg0 arg1 arg2) : Person.Is arg0 := …
-- def MurdersIn.inst1 … : Person.Is arg1 := …
-- def MurdersIn.inst2 … : Murder.Is arg2 := …
-- def MurdersIn.relation … : ("murders in" : Type → Type → Type → Prop) arg0 arg1 arg2 := …
-- def MurdersIn.mk … [inst0 : Person.Is arg0] … (relation : …) : MurdersIn arg0 arg1 arg2 := …
--
-- The payload semantic string is typed at the RAW single-sorted signature
-- (`Type → … → Prop`), never at the declaring file's subtype telescope, so
-- two files declaring the same relation share the same kernel-level payload
-- constant. Classification travels beside the payload as `∧`-conjuncts.
-- ---------------------------------------------------------------------------

def relationClassIdent (name : TSyntax `ident) (suffix : String) : TSyntax `ident :=
  mkIdent (name.getId.str suffix)

def relationLocalIdent (name : String) : TSyntax `ident :=
  mkIdent (Name.mkSimple name)

def relationArgIdent (i : Nat) : TSyntax `ident :=
  relationLocalIdent s!"arg{i}"

def relationIsTypeTerm (ty : TSyntax `term) : Bool :=
  ty.raw.isOfKind ``Lean.Parser.Term.type

def relationIsPropTerm (ty : TSyntax `term) : Bool :=
  ty.raw.isOfKind ``Lean.Parser.Term.prop

def relationClassIdentOfTerm (ty : TSyntax `term) : MacroM (TSyntax `ident) :=
  match ty.raw with
  | Syntax.ident _ _ name _ => pure (mkIdent (name.str "Is"))
  | _ =>
      Lean.Macro.throwError
        "relation expected a universal identifier here; use (x : Type) [Constraint x] for dependent constraints"

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
  | _ => Lean.Macro.throwError "expected relation type slot"

/-- `true` iff the slot carries no ontology constraint (a raw `Type` / `Prop`
    slot rather than a universal identifier). -/
def relationSlotIsRaw (ty : TSyntax `term) : Bool :=
  relationIsTypeTerm ty || relationIsPropTerm ty ||
    relationTermIsSimpleIdent ty "Type" || relationTermIsSimpleIdent ty "Prop"

/-- The RAW single-sorted type for a slot: `Prop` slots stay `Prop`; universal
    slots and `Type` slots are raw `Type`. -/
def relationRawSlotTerm (ty : TSyntax `term) : MacroM (TSyntax `term) := do
  if relationIsPropTerm ty || relationTermIsSimpleIdent ty "Prop" then
    `(Prop)
  else
    `(Type)

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

def relationParamForType (arg : TSyntax `ident) (ty : TSyntax `term) :
    MacroM (TSyntax ``Lean.Parser.Term.bracketedBinder) := do
  if relationIsPropTerm ty || relationTermIsSimpleIdent ty "Prop" then
    `(bracketedBinder| ($arg:ident : Prop))
  else
    `(bracketedBinder| ($arg:ident : Type))

def relationImplicitParamForType (arg : TSyntax `ident) (ty : TSyntax `term) :
    MacroM (TSyntax ``Lean.Parser.Term.bracketedBinder) := do
  if relationIsPropTerm ty || relationTermIsSimpleIdent ty "Prop" then
    `(bracketedBinder| {$arg:ident : Prop})
  else
    `(bracketedBinder| {$arg:ident : Type})

/-- The classification conjunct for a slot: `<Universal>.Is <arg>` for a
    universal slot, `none` for a raw `Type` / `Prop` slot. -/
def relationConjunctForType (arg : TSyntax `ident) (ty : TSyntax `term) :
    MacroM (Option (TSyntax `term)) := do
  if relationSlotIsRaw ty then
    pure none
  else
    let tyIs ← relationClassIdentOfTerm ty
    some <$> `($tyIs:ident $arg:ident)

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
  let argNames := argTypes.mapIdx (fun i _ => relationArgIdent i)
  let params ← argTypes.zip argNames |>.mapM fun (ty, arg) =>
    relationParamForType arg ty
  let iparams ← argTypes.zip argNames |>.mapM fun (ty, arg) =>
    relationImplicitParamForType arg ty
  let conjunctsOpt ← argTypes.zip argNames |>.mapIdxM fun i (ty, arg) => do
    match ← relationConjunctForType arg ty with
    | some c => pure (some (Name.mkSimple s!"inst{i}", c))
    | none => pure none
  let conjuncts := conjunctsOpt.filterMap id
  let rawSlots ← argTypes.mapM relationRawSlotTerm
  let rawType ← relationCurriedPropType rawSlots.toList
  let payload ← relationApplyArgs (← `(($rhs:term : $rawType:term))) argNames.toList
  relationEmit name params iparams argNames conjuncts payload

def relationBuildArrowCommand (name : TSyntax `ident) (sig rhs : TSyntax `term) :
    MacroM Syntax := do
  relationBuildFromTypesCommand name (← relationFlattenArrow sig) rhs

def relationStringLiteralValue (s : TSyntax `str) : MacroM String :=
  match s.raw.isStrLit? with
  | some value => pure value
  | none => Lean.Macro.throwError "expected relation phrase string literal"

def relationTemplateStringAux (i : Nat) : List String → String
  | [] => "{" ++ toString i ++ "}"
  | segment :: rest =>
      "{" ++ toString i ++ "} " ++ segment ++ " " ++ relationTemplateStringAux (i + 1) rest

def relationTemplateString (segments : Array String) : String :=
  relationTemplateStringAux 0 segments.toList

def relationBuildSegmentedCommand
    (name : TSyntax `ident)
    (argTypes : Array (TSyntax `term))
    (segments : Array (TSyntax `str)) :
    MacroM Syntax := do
  if segments.size + 1 != argTypes.size then
    Lean.Macro.throwError "segmented relation requires one more type slot than phrase segment"
  let segmentValues ← segments.mapM relationStringLiteralValue
  let template := Syntax.mkStrLit (relationTemplateString segmentValues)
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
  ids.foldlM (init := state) fun state id => do
    let param ← relationParamForType id ty
    let iparam ← relationImplicitParamForType id ty
    let conjunct? ← relationConjunctForType id ty
    let (conjuncts, nextInst) :=
      match conjunct? with
      | some c => (state.conjuncts.push (Name.mkSimple s!"inst{state.nextInst}", c), state.nextInst + 1)
      | none => (state.conjuncts, state.nextInst)
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
        "relation named binders support explicit binders (x : Type), universal sugar (x : Person), and instance binders [C x]"

def relationBuildNamedCommand
    (name : TSyntax `ident)
    (binders : Array (TSyntax ``Lean.Parser.Term.bracketedBinder))
    (result rhs : TSyntax `term) : MacroM Syntax := do
  let state ← binders.foldlM relationAddBinder {}
  if state.args.isEmpty then
    Lean.Macro.throwError "relation named-binder form requires at least one explicit argument binder"
  let payload ← `(($rhs:term : $result:term))
  relationEmit name state.params state.iparams state.args state.conjuncts payload

syntax (name := relationArrowCmd) "relation" ident " : " term " := " term : command
syntax (name := relationSegmentedCmd)
  "relation" ident " : "
    (ident <|> "Type" <|> "Prop") (str (ident <|> "Type" <|> "Prop"))+ : command
syntax (name := relationNamedCmd)
  "relation" ident bracketedBinder+ " : " term " := " term : command

macro_rules
  | `(relation $name:ident : $sig:term := $rhs:term) =>
      relationBuildArrowCommand name sig rhs
  | `(relation $name:ident : $first $[$segments:str $slots]*) => do
      let firstType ← relationSegmentSlotAsTerm first.raw
      let restTypes ← slots.mapM (fun slot => relationSegmentSlotAsTerm slot.raw)
      relationBuildSegmentedCommand name (#[firstType] ++ restTypes) segments
  | `(relation $name:ident $binders:bracketedBinder* : $result:term := $rhs:term) =>
      relationBuildNamedCommand name binders result rhs

end a52pkb71
