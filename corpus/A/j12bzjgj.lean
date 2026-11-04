import Axiom
import A.vpg72gwr
import A.c424c6bg

open c424c6bg

namespace j12bzjgj

namespace BFO

abbrev BFO : Prop := vpg72gwr.BFO.BFO

rigid universal Continuant := vpg72gwr.BFO.Continuant
rigid universal Occurrent := vpg72gwr.BFO.Occurrent

rigid universal IndependentContinuant extends Continuant := vpg72gwr.BFO.IndependentContinuant
rigid universal GenericallyDependentContinuant extends Continuant := vpg72gwr.BFO.GenericallyDependentContinuant
rigid universal SpecificallyDependentContinuant extends Continuant := vpg72gwr.BFO.SpecificallyDependentContinuant

rigid universal MaterialEntity extends IndependentContinuant := vpg72gwr.BFO.MaterialEntity
rigid universal ImmaterialEntity extends IndependentContinuant := vpg72gwr.BFO.ImmaterialEntity
rigid universal Object extends MaterialEntity := vpg72gwr.BFO.Object
rigid universal FiatObjectPart extends MaterialEntity := vpg72gwr.BFO.FiatObjectPart
rigid universal ObjectAggregate extends MaterialEntity := vpg72gwr.BFO.ObjectAggregate
rigid universal Site extends ImmaterialEntity := vpg72gwr.BFO.Site
rigid universal ContinuantFiatBoundary extends ImmaterialEntity := vpg72gwr.BFO.ContinuantFiatBoundary
rigid universal SpatialRegion extends ImmaterialEntity := vpg72gwr.BFO.SpatialRegion
rigid universal FiatSurface extends ContinuantFiatBoundary := vpg72gwr.BFO.FiatSurface
rigid universal FiatLine extends ContinuantFiatBoundary := vpg72gwr.BFO.FiatLine
rigid universal FiatPoint extends ContinuantFiatBoundary := vpg72gwr.BFO.FiatPoint
rigid universal ThreeDimensionalSpatialRegion extends SpatialRegion := vpg72gwr.BFO.ThreeDimensionalSpatialRegion
rigid universal TwoDimensionalSpatialRegion extends SpatialRegion := vpg72gwr.BFO.TwoDimensionalSpatialRegion
rigid universal OneDimensionalSpatialRegion extends SpatialRegion := vpg72gwr.BFO.OneDimensionalSpatialRegion
rigid universal ZeroDimensionalSpatialRegion extends SpatialRegion := vpg72gwr.BFO.ZeroDimensionalSpatialRegion

rigid universal Quality extends SpecificallyDependentContinuant := vpg72gwr.BFO.Quality
rigid universal RelationalQuality extends Quality := vpg72gwr.BFO.RelationalQuality
rigid universal RealizableEntity extends SpecificallyDependentContinuant := vpg72gwr.BFO.RealizableEntity
rigid universal Disposition extends RealizableEntity := vpg72gwr.BFO.Disposition
rigid universal Function extends Disposition := vpg72gwr.BFO.Function
rigid universal Role extends RealizableEntity := vpg72gwr.BFO.Role

rigid universal Process extends Occurrent := vpg72gwr.BFO.Process
rigid universal ProcessBoundary extends Occurrent := vpg72gwr.BFO.ProcessBoundary
rigid universal TemporalRegion extends Occurrent := vpg72gwr.BFO.TemporalRegion
rigid universal SpatiotemporalRegion extends Occurrent := vpg72gwr.BFO.SpatiotemporalRegion
rigid universal History extends Process := vpg72gwr.BFO.History
rigid universal OneDimensionalTemporalRegion extends TemporalRegion := vpg72gwr.BFO.OneDimensionalTemporalRegion
rigid universal ZeroDimensionalTemporalRegion extends TemporalRegion := vpg72gwr.BFO.ZeroDimensionalTemporalRegion
rigid universal TemporalInstant extends ZeroDimensionalTemporalRegion := vpg72gwr.BFO.TemporalInstant
rigid universal TemporalInterval extends OneDimensionalTemporalRegion := vpg72gwr.BFO.TemporalInterval

abbrev Entity : Type 1 := { x : Type // vpg72gwr.BFO.Entity x }
abbrev Universal : Type 1 := { u : Type // vpg72gwr.BFO.Universal u }
abbrev Particular : Type 1 := { x : Type // vpg72gwr.BFO.Particular x }

scoped instance : CoeHead Entity Type := ⟨Subtype.val⟩
scoped instance : CoeHead Universal Type := ⟨Subtype.val⟩
scoped instance : CoeHead Particular Type := ⟨Subtype.val⟩

abbrev Time := TemporalRegion

structure NonSpatialIndependentContinuant where
  val : IndependentContinuant
  not_spatial_at : ∀ t : Time, ¬ SpatialRegion.At val t

scoped instance : CoeHead NonSpatialIndependentContinuant Type :=
  ⟨fun x => x.val⟩

inductive ProcessOrProcessBoundary : Type 1 where
  | process : Process → ProcessOrProcessBoundary
  | processBoundary : ProcessBoundary → ProcessOrProcessBoundary

scoped instance : Coe Process ProcessOrProcessBoundary :=
  ⟨ProcessOrProcessBoundary.process⟩

scoped instance : Coe ProcessBoundary ProcessOrProcessBoundary :=
  ⟨ProcessOrProcessBoundary.processBoundary⟩

scoped instance (x : Type) [Process.Is x] : CoeDep Type x ProcessOrProcessBoundary :=
  ⟨(x : Process)⟩

scoped instance (x : Type) [ProcessBoundary.Is x] : CoeDep Type x ProcessOrProcessBoundary :=
  ⟨(x : ProcessBoundary)⟩

scoped instance : CoeHead ProcessOrProcessBoundary Type :=
  ⟨fun x =>
    match x with
    | ProcessOrProcessBoundary.process p => p
    | ProcessOrProcessBoundary.processBoundary b => b⟩

inductive MaterialEntityOrSite : Type 1 where
  | materialEntity : MaterialEntity → MaterialEntityOrSite
  | site : Site → MaterialEntityOrSite

scoped instance : Coe MaterialEntity MaterialEntityOrSite :=
  ⟨MaterialEntityOrSite.materialEntity⟩

scoped instance : Coe Site MaterialEntityOrSite :=
  ⟨MaterialEntityOrSite.site⟩

scoped instance (x : Type) [MaterialEntity.Is x] : CoeDep Type x MaterialEntityOrSite :=
  ⟨(x : MaterialEntity)⟩

scoped instance (x : Type) [Site.Is x] : CoeDep Type x MaterialEntityOrSite :=
  ⟨(x : Site)⟩

scoped instance : CoeHead MaterialEntityOrSite Type :=
  ⟨fun x =>
    match x with
    | MaterialEntityOrSite.materialEntity m => m
    | MaterialEntityOrSite.site s => s⟩

inductive Concretizer : Type 1 where
  | specificallyDependentContinuant : SpecificallyDependentContinuant → Concretizer
  | process : Process → Concretizer

scoped instance : Coe SpecificallyDependentContinuant Concretizer :=
  ⟨Concretizer.specificallyDependentContinuant⟩

scoped instance : Coe Process Concretizer :=
  ⟨Concretizer.process⟩

scoped instance (x : Type) [SpecificallyDependentContinuant.Is x] : CoeDep Type x Concretizer :=
  ⟨(x : SpecificallyDependentContinuant)⟩

scoped instance (x : Type) [Process.Is x] : CoeDep Type x Concretizer :=
  ⟨(x : Process)⟩

scoped instance : CoeHead Concretizer Type :=
  ⟨fun x =>
    match x with
    | Concretizer.specificallyDependentContinuant s => s
    | Concretizer.process p => p⟩

inductive Participant : Type 1 where
  | independentContinuant : NonSpatialIndependentContinuant → Participant
  | specificallyDependentContinuant : SpecificallyDependentContinuant → Participant
  | genericallyDependentContinuant : GenericallyDependentContinuant → Participant

scoped instance : Coe NonSpatialIndependentContinuant Participant :=
  ⟨Participant.independentContinuant⟩

scoped instance : Coe SpecificallyDependentContinuant Participant :=
  ⟨Participant.specificallyDependentContinuant⟩

scoped instance : Coe GenericallyDependentContinuant Participant :=
  ⟨Participant.genericallyDependentContinuant⟩

scoped instance (x : Type) [SpecificallyDependentContinuant.Is x] : CoeDep Type x Participant :=
  ⟨(x : SpecificallyDependentContinuant)⟩

scoped instance (x : Type) [GenericallyDependentContinuant.Is x] : CoeDep Type x Participant :=
  ⟨(x : GenericallyDependentContinuant)⟩

scoped instance : CoeHead Participant Type :=
  ⟨fun x =>
    match x with
    | Participant.independentContinuant c => c
    | Participant.specificallyDependentContinuant s => s
    | Participant.genericallyDependentContinuant g => g⟩

inductive SpecificDependencyTarget : Type 1 where
  | specificallyDependentContinuant : SpecificallyDependentContinuant → SpecificDependencyTarget
  | independentContinuant : NonSpatialIndependentContinuant → SpecificDependencyTarget

scoped instance : Coe SpecificallyDependentContinuant SpecificDependencyTarget :=
  ⟨SpecificDependencyTarget.specificallyDependentContinuant⟩

scoped instance : Coe NonSpatialIndependentContinuant SpecificDependencyTarget :=
  ⟨SpecificDependencyTarget.independentContinuant⟩

scoped instance (x : Type) [SpecificallyDependentContinuant.Is x] :
    CoeDep Type x SpecificDependencyTarget :=
  ⟨(x : SpecificallyDependentContinuant)⟩

scoped instance : CoeHead SpecificDependencyTarget Type :=
  ⟨fun x =>
    match x with
    | SpecificDependencyTarget.specificallyDependentContinuant s => s
    | SpecificDependencyTarget.independentContinuant c => c⟩

inductive OccurrentOrTemporalRegion : Type 1 where
  | occurrent : Occurrent → OccurrentOrTemporalRegion
  | temporalRegion : TemporalRegion → OccurrentOrTemporalRegion

scoped instance : Coe Occurrent OccurrentOrTemporalRegion :=
  ⟨OccurrentOrTemporalRegion.occurrent⟩

scoped instance : Coe TemporalRegion OccurrentOrTemporalRegion :=
  ⟨OccurrentOrTemporalRegion.temporalRegion⟩

scoped instance (x : Type) [Occurrent.Is x] : CoeDep Type x OccurrentOrTemporalRegion :=
  ⟨(x : Occurrent)⟩

scoped instance (x : Type) [TemporalRegion.Is x] : CoeDep Type x OccurrentOrTemporalRegion :=
  ⟨(x : TemporalRegion)⟩

scoped instance : CoeHead OccurrentOrTemporalRegion Type :=
  ⟨fun x =>
    match x with
    | OccurrentOrTemporalRegion.occurrent o => o
    | OccurrentOrTemporalRegion.temporalRegion t => t⟩

def InstanceOf (x : Particular) (u : Universal) (t : Time) : Prop :=
  vpg72gwr.BFO.InstanceOf x u t

def ExistsAt (x : Type) (t : Time) : Prop :=
  vpg72gwr.BFO.ExistsAt x t

def ContinuantPartOf (part whole : Continuant) (t : Time) : Prop :=
  vpg72gwr.BFO.ContinuantPartOf part whole t

def HasContinuantPart (whole part : Continuant) (t : Time) : Prop :=
  vpg72gwr.BFO.HasContinuantPart whole part t

def ProperContinuantPartOf (part whole : Continuant) (t : Time) : Prop :=
  vpg72gwr.BFO.ProperContinuantPartOf part whole t

def HasProperContinuantPart (whole part : Continuant) (t : Time) : Prop :=
  vpg72gwr.BFO.HasProperContinuantPart whole part t

def GenericallyDependsOn
    (dependent : GenericallyDependentContinuant)
    (carrier : NonSpatialIndependentContinuant)
    (t : Time) : Prop :=
  vpg72gwr.BFO.GenericallyDependsOn dependent carrier t

def IsCarrierOf
    (carrier : NonSpatialIndependentContinuant)
    (dependent : GenericallyDependentContinuant)
    (t : Time) : Prop :=
  vpg72gwr.BFO.IsCarrierOf carrier dependent t

def Concretizes (a : Concretizer) (b : GenericallyDependentContinuant) (t : Time) : Prop :=
  vpg72gwr.BFO.Concretizes a b t

def IsConcretizedBy (b : GenericallyDependentContinuant) (a : Concretizer) (t : Time) : Prop :=
  vpg72gwr.BFO.IsConcretizedBy b a t

def HistoryOf (history : History) (entity : MaterialEntity) : Prop :=
  vpg72gwr.BFO.HistoryOf history entity

def HasHistory (entity : MaterialEntity) (history : History) : Prop :=
  vpg72gwr.BFO.HasHistory entity history

def MemberPartOf (member : Object) (aggregate : ObjectAggregate) (t : Time) : Prop :=
  vpg72gwr.BFO.MemberPartOf member aggregate t

def HasMemberPart (aggregate : ObjectAggregate) (member : Object) (t : Time) : Prop :=
  vpg72gwr.BFO.HasMemberPart aggregate member t

def OccurrentPartOf (part whole : Occurrent) : Prop :=
  vpg72gwr.BFO.OccurrentPartOf part whole

def HasOccurrentPart (whole part : Occurrent) : Prop :=
  vpg72gwr.BFO.HasOccurrentPart whole part

def ProperOccurrentPartOf (part whole : Occurrent) : Prop :=
  vpg72gwr.BFO.ProperOccurrentPartOf part whole

def HasProperOccurrentPart (whole part : Occurrent) : Prop :=
  vpg72gwr.BFO.HasProperOccurrentPart whole part

def Precedes (earlier later : Occurrent) : Prop :=
  vpg72gwr.BFO.Precedes earlier later

def PrecededBy (later earlier : Occurrent) : Prop :=
  vpg72gwr.BFO.PrecededBy later earlier

def ParticipatesIn (participant : Participant) (process : Process) (t : Time) : Prop :=
  vpg72gwr.BFO.ParticipatesIn participant process t

def HasParticipant (process : Process) (participant : Participant) (t : Time) : Prop :=
  vpg72gwr.BFO.HasParticipant process participant t

def LocatedIn
    (located location : NonSpatialIndependentContinuant)
    (t : Time) : Prop :=
  vpg72gwr.BFO.LocatedIn located location t

def LocationOf
    (location located : NonSpatialIndependentContinuant)
    (t : Time) : Prop :=
  vpg72gwr.BFO.LocationOf location located t

def OccupiesSpatialRegion
    (occupant : NonSpatialIndependentContinuant)
    (region : SpatialRegion)
    (t : Time) : Prop :=
  vpg72gwr.BFO.OccupiesSpatialRegion occupant region t

def OccursIn (process : ProcessOrProcessBoundary) (context : MaterialEntityOrSite) : Prop :=
  vpg72gwr.BFO.OccursIn process context

def Environs (context : MaterialEntityOrSite) (process : ProcessOrProcessBoundary) : Prop :=
  vpg72gwr.BFO.Environs context process

def SpatiallyProjectsOnto
    (source : SpatiotemporalRegion)
    (projection : SpatialRegion)
    (t : Time) : Prop :=
  vpg72gwr.BFO.SpatiallyProjectsOnto source projection t

def TemporallyProjectsOnto
    (source : SpatiotemporalRegion)
    (projection : TemporalRegion) : Prop :=
  vpg72gwr.BFO.TemporallyProjectsOnto source projection

def OccupiesTemporalRegion
    (occupant : ProcessOrProcessBoundary)
    (region : TemporalRegion) : Prop :=
  vpg72gwr.BFO.OccupiesTemporalRegion occupant region

relation ProcessOccupiesTemporalRegion : Process → TemporalRegion :=
  fun process region => vpg72gwr.BFO.OccupiesTemporalRegion process region

def OccupiesSpatiotemporalRegion
    (occupant : ProcessOrProcessBoundary)
    (region : SpatiotemporalRegion) : Prop :=
  vpg72gwr.BFO.OccupiesSpatiotemporalRegion occupant region

def InheresIn (dependent : SpecificallyDependentContinuant) (bearer : NonSpatialIndependentContinuant) : Prop :=
  vpg72gwr.BFO.InheresIn dependent bearer

def BearerOf (bearer : NonSpatialIndependentContinuant) (dependent : SpecificallyDependentContinuant) : Prop :=
  vpg72gwr.BFO.BearerOf bearer dependent

def HasMaterialBasis (disposition : Disposition) (basis : MaterialEntity) (t : Time) : Prop :=
  vpg72gwr.BFO.HasMaterialBasis disposition basis t

def MaterialBasisOf (basis : MaterialEntity) (disposition : Disposition) (t : Time) : Prop :=
  vpg72gwr.BFO.MaterialBasisOf basis disposition t

def SpecificallyDependsOn
    (dependent : SpecificallyDependentContinuant)
    (target : SpecificDependencyTarget) : Prop :=
  vpg72gwr.BFO.SpecificallyDependsOn dependent target

def SpecificallyDependedOnBy
    (target : SpecificDependencyTarget)
    (dependent : SpecificallyDependentContinuant) : Prop :=
  vpg72gwr.BFO.SpecificallyDependedOnBy target dependent

def Realizes (process : Process) (realizable : RealizableEntity) : Prop :=
  vpg72gwr.BFO.Realizes process realizable

def HasRealization (realizable : RealizableEntity) (process : Process) : Prop :=
  vpg72gwr.BFO.HasRealization realizable process

def TemporalPartOf (part whole : OccurrentOrTemporalRegion) : Prop :=
  vpg72gwr.BFO.TemporalPartOf part whole

relation TemporalRegionPartOf : TemporalRegion → TemporalRegion :=
  fun part whole => vpg72gwr.BFO.TemporalPartOf part whole

def HasTemporalPart (whole part : OccurrentOrTemporalRegion) : Prop :=
  vpg72gwr.BFO.HasTemporalPart whole part

def ProperTemporalPartOf (part whole : OccurrentOrTemporalRegion) : Prop :=
  vpg72gwr.BFO.ProperTemporalPartOf part whole

def HasProperTemporalPart (whole part : OccurrentOrTemporalRegion) : Prop :=
  vpg72gwr.BFO.HasProperTemporalPart whole part

def HasFirstInstant (region : TemporalRegion) (instant : TemporalInstant) : Prop :=
  vpg72gwr.BFO.HasFirstInstant region instant

def FirstInstantOf (instant : TemporalInstant) (region : TemporalRegion) : Prop :=
  vpg72gwr.BFO.FirstInstantOf instant region

def HasLastInstant (region : TemporalRegion) (instant : TemporalInstant) : Prop :=
  vpg72gwr.BFO.HasLastInstant region instant

def LastInstantOf (instant : TemporalInstant) (region : TemporalRegion) : Prop :=
  vpg72gwr.BFO.LastInstantOf instant region

end BFO

end j12bzjgj
