# regionalFactors — Fillable Items from jinshan-radius.response.json

Source data: `references/jinshan-radius.response.json` (POI radius query, center
121.636, 25.221, Jinshan)

Schema: `references/factor-standard.json` → `regionalFactors` (28 items total)

## Fillable (5)

| Category | Item | Matching data | Grade (by distance rule) |
|---|---|---|---|
| trafficAndTransport | `proximityToBusStop` (站牌之接近程度) | 公車站「金山區公所」, 153m | 稍優 (<200m) |
| publicInfrastructure | `parkingConvenience` (停車場地之便利程度) | 停車場, nearest 54m | 稍優 (<200m) |
| publicInfrastructure | `proximityToParkPlazaPedestrianZone` (接近公園、廣場、徒步區之程度) | 杜鵑公園, 115m | 稍優 (<500m) |
| specialFacilities | `proximityToFuneralFacility` (殯葬設施之有無及接近程度) | 新北市金山區第一公墓, 670m | 稍優 (500m–1,000m) |
| commercialActivity | `proximityToFinancialInstitution` (金融機構之有無、數量、接近程度) | 金山地區農會, 186m | 稍優 (<500m) |

## Not fillable (23)

No corresponding facility category present in the response.

### landUseRegulation (6/6 not fillable)
- `insideOutsideUrbanPlan` — needs urban-plan boundary data
- `zoningDesignation` — needs zoning data
- `buildingCoverageRatio` — needs building-code data
- `floorAreaRatio` — needs building-code data
- `buildingProhibition` — needs regulatory data
- `buildingRestriction` — needs regulatory data

### trafficAndTransport (5/6 not fillable)
- `mainRoadWidth` — no road-width data
- `averageRoadWidthInSection` — no road-width data
- `proximityToMajorStation` — only 公車站 (bus stop) present, no rail/MRT station
- `proximityToInterchange` — no 交流道 data
- `roadPlanningAndConstructionLevel` — no road-development data

### naturalConditions (2/2 not fillable)
- `drainageQuality` — separate pipeline (`src/drainageQuality/`), not POI-derived
- `terrain` — no terrain data

### publicInfrastructure (2/4 not fillable)
- `proximityToMarket` — no 市場 (market) in data
- `proximityToTouristRecreationFacility` — no 觀光遊憩設施 in data

### specialFacilities (2/3 not fillable)
- `proximityToUtilityGasFacility` — no 電業/公用氣體燃料設施 in data
- `proximityToWasteFacility` — no 廢棄物處理設施 in data

### environmentalPollution (1/1 not fillable)
- `proximityToPollutionSource` — no pollution-source data

### commercialActivity (5/6 not fillable)
- `proximityToDepartmentStore` — no 百貨公司 in data
- `proximityToEntertainmentFacility` — no 娛樂設施 in data
- `proximityToExhibitionCenterOrHotel` — no 展示中心/觀光飯店 in data
- `customerTrafficVolume` — subjective, not derivable from POI counts
- `shopContiguityRatio` — needs % shop-frontage data, not derivable

## Caveat

Absence of a POI category in the response is not conclusive evidence of "劣" —
it may just mean the dataset/search radius doesn't cover that category, so
these are *not* auto-inferred as the worst grade.
