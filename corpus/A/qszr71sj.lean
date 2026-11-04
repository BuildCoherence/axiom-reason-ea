import Axiom
import A.vpg72gwr
import A.jz5twd51
import A.a52pkb71

open jz5twd51
open a52pkb71

namespace qszr71sj

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

relation BearerOf : IndependentContinuant → SpecificallyDependentContinuant :=
  vpg72gwr.BFO.BearerOf

relation Concretizes : Type → GenericallyDependentContinuant → TemporalRegion :=
  vpg72gwr.BFO.Concretizes

relation ContinuantPartOf : Continuant → Continuant → TemporalRegion :=
  vpg72gwr.BFO.ContinuantPartOf

relation Environs : IndependentContinuant → Occurrent :=
  vpg72gwr.BFO.Environs

relation ExistsAt : Type → TemporalRegion :=
  vpg72gwr.BFO.ExistsAt

relation FirstInstantOf : TemporalInstant → TemporalRegion :=
  vpg72gwr.BFO.FirstInstantOf

relation GenericallyDependsOn : GenericallyDependentContinuant → IndependentContinuant → TemporalRegion :=
  vpg72gwr.BFO.GenericallyDependsOn

relation HasContinuantPart : Continuant → Continuant → TemporalRegion :=
  vpg72gwr.BFO.HasContinuantPart

relation HasFirstInstant : TemporalRegion → TemporalInstant :=
  vpg72gwr.BFO.HasFirstInstant

relation HasHistory : MaterialEntity → History :=
  vpg72gwr.BFO.HasHistory

relation HasLastInstant : TemporalRegion → TemporalInstant :=
  vpg72gwr.BFO.HasLastInstant

relation HasMaterialBasis : Disposition → MaterialEntity → TemporalRegion :=
  vpg72gwr.BFO.HasMaterialBasis

relation HasMemberPart : ObjectAggregate → Object → TemporalRegion :=
  vpg72gwr.BFO.HasMemberPart

relation HasOccurrentPart : Occurrent → Occurrent :=
  vpg72gwr.BFO.HasOccurrentPart

relation HasParticipant : Process → Continuant → TemporalRegion :=
  vpg72gwr.BFO.HasParticipant

relation HasProperContinuantPart : Continuant → Continuant → TemporalRegion :=
  vpg72gwr.BFO.HasProperContinuantPart

relation HasProperOccurrentPart : Occurrent → Occurrent :=
  vpg72gwr.BFO.HasProperOccurrentPart

relation HasProperTemporalPart : Occurrent → Occurrent :=
  vpg72gwr.BFO.HasProperTemporalPart

relation HasRealization : RealizableEntity → Process :=
  vpg72gwr.BFO.HasRealization

relation HasTemporalPart : Occurrent → Occurrent :=
  vpg72gwr.BFO.HasTemporalPart

relation HistoryOf : History → MaterialEntity :=
  vpg72gwr.BFO.HistoryOf

relation InheresIn : SpecificallyDependentContinuant → IndependentContinuant :=
  vpg72gwr.BFO.InheresIn

relation InstanceOf : Type → Type → TemporalRegion :=
  vpg72gwr.BFO.InstanceOf

relation IsCarrierOf : IndependentContinuant → GenericallyDependentContinuant → TemporalRegion :=
  vpg72gwr.BFO.IsCarrierOf

relation IsConcretizedBy : GenericallyDependentContinuant → Type → TemporalRegion :=
  vpg72gwr.BFO.IsConcretizedBy

relation LastInstantOf : TemporalInstant → TemporalRegion :=
  vpg72gwr.BFO.LastInstantOf

relation LocatedIn : IndependentContinuant → IndependentContinuant → TemporalRegion :=
  vpg72gwr.BFO.LocatedIn

relation LocationOf : IndependentContinuant → IndependentContinuant → TemporalRegion :=
  vpg72gwr.BFO.LocationOf

relation MaterialBasisOf : MaterialEntity → Disposition → TemporalRegion :=
  vpg72gwr.BFO.MaterialBasisOf

relation MemberPartOf : Object → ObjectAggregate → TemporalRegion :=
  vpg72gwr.BFO.MemberPartOf

relation OccupiesSpatialRegion : IndependentContinuant → SpatialRegion → TemporalRegion :=
  vpg72gwr.BFO.OccupiesSpatialRegion

relation OccupiesSpatiotemporalRegion : Occurrent → SpatiotemporalRegion :=
  vpg72gwr.BFO.OccupiesSpatiotemporalRegion

relation OccupiesTemporalRegion : Occurrent → TemporalRegion :=
  vpg72gwr.BFO.OccupiesTemporalRegion

relation OccurrentPartOf : Occurrent → Occurrent :=
  vpg72gwr.BFO.OccurrentPartOf

relation OccursIn : Occurrent → IndependentContinuant :=
  vpg72gwr.BFO.OccursIn

relation ParticipatesIn : Continuant → Process → TemporalRegion :=
  vpg72gwr.BFO.ParticipatesIn

relation PrecededBy : Occurrent → Occurrent :=
  vpg72gwr.BFO.PrecededBy

relation Precedes : Occurrent → Occurrent :=
  vpg72gwr.BFO.Precedes

relation ProperContinuantPartOf : Continuant → Continuant → TemporalRegion :=
  vpg72gwr.BFO.ProperContinuantPartOf

relation ProperOccurrentPartOf : Occurrent → Occurrent :=
  vpg72gwr.BFO.ProperOccurrentPartOf

relation ProperTemporalPartOf : Occurrent → Occurrent :=
  vpg72gwr.BFO.ProperTemporalPartOf

relation Realizes : Process → RealizableEntity :=
  vpg72gwr.BFO.Realizes

relation SpatiallyProjectsOnto : SpatiotemporalRegion → SpatialRegion → TemporalRegion :=
  vpg72gwr.BFO.SpatiallyProjectsOnto

relation SpecificallyDependedOnBy : Continuant → SpecificallyDependentContinuant :=
  vpg72gwr.BFO.SpecificallyDependedOnBy

relation SpecificallyDependsOn : SpecificallyDependentContinuant → Continuant :=
  vpg72gwr.BFO.SpecificallyDependsOn

relation TemporallyProjectsOnto : SpatiotemporalRegion → TemporalRegion :=
  vpg72gwr.BFO.TemporallyProjectsOnto

relation TemporalPartOf : Occurrent → Occurrent :=
  vpg72gwr.BFO.TemporalPartOf


end qszr71sj
