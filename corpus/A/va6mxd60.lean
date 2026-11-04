import Axiom
import Lean
import A.vpg72gwr

open Lean vpg72gwr.BFO

namespace va6mxd60

-- ---------------------------------------------------------------------------
-- `universal` — non-rigid (phase/role): time-indexed membership only, no bare Type.
-- ---------------------------------------------------------------------------

def universalIdent (name : Lean.TSyntax `ident) (suffix : String) : Lean.TSyntax `ident :=
  Lean.mkIdent (name.getId.str suffix)

def universalFieldIdent (pfx : String) (name : Lean.TSyntax `ident) : Lean.TSyntax `ident :=
  Lean.mkIdent (Lean.Name.mkSimple (pfx ++ name.getId.toString))

syntax (name := universalCmd) "universal " ident " := " term : command
syntax (name := universalExtendsCmd) "universal " ident " extends " ident " := " term : command

macro_rules
  | `(universal $name:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameAt   := universalIdent name "At"
      let nameEver := universalIdent name "Ever"
      let nameAsUniversal := universalIdent name "asUniversal"
      let field    := universalFieldIdent "mem_" name
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        class $nameAt (x t : Type) : Prop where
          $field:ident : InstanceOf x $nameU t
        abbrev $nameEver : Type 1 :=
          { x : Type // ∃ t : Type, $nameAt x t ∧ InstanceOf t TemporalRegion t }
        scoped instance : CoeHead $nameEver Type := ⟨Subtype.val⟩)
  | `(universal $name:ident extends $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameAt   := universalIdent name "At"
      let parentAt := universalIdent parent "At"
      let parentField := universalFieldIdent "to_" parent
      let nameEver := universalIdent name "Ever"
      let nameAsUniversal := universalIdent name "asUniversal"
      let field    := universalFieldIdent "mem_" name
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        class $nameAt (x t : Type) extends $parentField:ident : $parentAt x t where
          $field:ident : InstanceOf x $nameU t
        abbrev $nameEver : Type 1 :=
          { x : Type // ∃ t : Type, $nameAt x t ∧ InstanceOf t TemporalRegion t }
        scoped instance : CoeHead $nameEver Type := ⟨Subtype.val⟩)

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
      let field  := universalFieldIdent "mem_" name
      let atField := universalFieldIdent "at_" name
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        class $nameAt (x t : Type) : Prop where
          $atField:ident : InstanceOf x $nameU t
        class $nameIs (x : Type) : Prop where
          $field:ident : ∀ t : Type, InstanceOf t TemporalRegion t → ExistsAt x t → $nameAt x t
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        scoped instance : CoeHead $name Type := ⟨Subtype.val⟩
        scoped instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩)
  | `(rigid universal $name:ident extends $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameIs   := universalIdent name "Is"
      let nameAt   := universalIdent name "At"
      let parentIs := universalIdent parent "Is"
      let parentAt := universalIdent parent "At"
      let parentField := universalFieldIdent "to_" parent
      let nameAsUniversal := universalIdent name "asUniversal"
      let field    := universalFieldIdent "mem_" name
      let atField  := universalFieldIdent "at_" name
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        class $nameAt (x t : Type) extends $parentField:ident : $parentAt x t where
          $atField:ident : InstanceOf x $nameU t
        class $nameIs (x : Type) : Prop extends $parentField:ident : $parentIs x where
          $field:ident : ∀ t : Type, InstanceOf t TemporalRegion t → ExistsAt x t → $nameAt x t
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        scoped instance : CoeHead $name Type := ⟨Subtype.val⟩
        scoped instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩
        scoped instance : Coe $name $parent :=
          ⟨fun v => ⟨v.val, by haveI := v.property; exact inferInstance⟩⟩)
  | `(rigid universal $name:ident extends nonrigid $parent:ident := $s:term) => do
      let nameU    := universalIdent name "U"
      let nameIs   := universalIdent name "Is"
      let nameAt   := universalIdent name "At"
      let parentAt := universalIdent parent "At"
      let parentField := universalFieldIdent "to_" parent
      let nameAsUniversal := universalIdent name "asUniversal"
      let field    := universalFieldIdent "mem_" name
      let atField  := universalFieldIdent "at_" name
      `(def $nameU : Type := $s
        def $nameAsUniversal (h : Universal $nameU) : { u : Type // Universal u } := ⟨$nameU, h⟩
        class $nameAt (x t : Type) extends $parentField:ident : $parentAt x t where
          $atField:ident : InstanceOf x $nameU t
        class $nameIs (x : Type) : Prop where
          $field:ident : ∀ t : Type, InstanceOf t TemporalRegion t → ExistsAt x t → $nameAt x t
        abbrev $name : Type 1 := { x : Type // $nameIs x }
        scoped instance : CoeHead $name Type := ⟨Subtype.val⟩
        scoped instance (x : Type) [$nameIs x] : CoeDep Type x $name := ⟨⟨x, inferInstance⟩⟩)

-- ---------------------------------------------------------------------------
-- `relation` — defines a proposition-valued bundled relation whose arguments are
-- Axiom particulars (`Type`s) plus stored class evidence for the declared ontology
-- constraints.
--
-- relation Loves : Person → Person := "loves"
--
-- roughly expands to:
--
-- structure MurdersIn (arg0 arg1 arg2 : Type) : Prop where
--   [inst0 : Person.Is arg0]
--   [inst1 : Person.Is arg1]
--   [inst2 : Murder.Is arg2]
--   relation : ("murders in" : Person → Person → Murder → Prop) arg0 arg1 arg2
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

def relationInstForType (i : Nat) (arg : TSyntax `ident) (ty : TSyntax `term) :
    MacroM (Option (TSyntax ``Lean.Parser.Command.structInstBinder)) := do
  if relationIsTypeTerm ty || relationIsPropTerm ty ||
      relationTermIsSimpleIdent ty "Type" || relationTermIsSimpleIdent ty "Prop" then
    pure none
  else
    let inst := relationLocalIdent s!"inst{i}"
    let tyIs ← relationClassIdentOfTerm ty
    some <$> `(Lean.Parser.Command.structInstBinder| [$inst:ident : $tyIs:ident $arg:ident])

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
  let insts ← argTypes.zip argNames |>.mapIdxM fun i (ty, arg) =>
    relationInstForType i arg ty
  let insts := insts.filterMap id
  let rhsType ← relationCurriedPropType argTypes.toList
  let relationType ← relationApplyArgs (← `(($rhs:term : $rhsType:term))) argNames.toList
  let relationField ←
    `(Lean.Parser.Command.structSimpleBinder| «relation» : $relationType:term)
  `(structure $name:ident $params:bracketedBinder* : Prop where
      $insts:structInstBinder*
      $relationField:structSimpleBinder)

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

def relationIdentAsTerm (id : TSyntax `ident) : TSyntax `term :=
  ⟨id.raw⟩

structure RelationNamedState where
  params : Array (TSyntax ``Lean.Parser.Term.bracketedBinder) := #[]
  args : Array (TSyntax `ident) := #[]
  insts : Array (TSyntax ``Lean.Parser.Command.structInstBinder) := #[]
  nextInst : Nat := 0

def relationAddExplicitBinder
    (state : RelationNamedState)
    (ids : Array (TSyntax `ident))
    (ty : TSyntax `term) : MacroM RelationNamedState := do
  ids.foldlM (init := state) fun state id => do
    let param ← relationParamForType id ty
    let inst? ← relationInstForType state.nextInst id ty
    let nextInst := state.nextInst + if inst?.isSome then 1 else 0
    pure
      { params := state.params.push param
        args := state.args.push id
        insts := match inst? with
          | some inst => state.insts.push inst
          | none => state.insts
        nextInst := nextInst }

def relationAddNamedInstBinder
    (state : RelationNamedState)
    (id : TSyntax `ident)
    (ty : TSyntax `term) : MacroM RelationNamedState := do
  let inst ← `(Lean.Parser.Command.structInstBinder| [$id:ident : $ty:term])
  pure { state with insts := state.insts.push inst, nextInst := state.nextInst + 1 }

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
  let relationField ←
    `(Lean.Parser.Command.structSimpleBinder| «relation» : ($rhs:term : $result:term))
  `(structure $name:ident $state.params:bracketedBinder* : Prop where
      $state.insts:structInstBinder*
      $relationField:structSimpleBinder)

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


end va6mxd60
