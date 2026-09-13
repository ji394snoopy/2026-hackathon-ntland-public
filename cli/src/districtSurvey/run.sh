#!/usr/bin/env bash
#
# Dispatches districtSurvey's per-category generate/fill scripts, replacing
# the 21 category-specific npm scripts that used to live in package.json.
#
# Usage: src/districtSurvey/run.sh <action> <category> [-- extra tsx args]
#   action:   generate | generateCoordinate | fill
#   category: tt | pi | sf | ep | ca | lr | li | nc
#
# Examples:
#   src/districtSurvey/run.sh generate tt
#   src/districtSurvey/run.sh generateCoordinate li
#   src/districtSurvey/run.sh fill ca

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

usage() {
  echo "Usage: $0 <action> <category> [extra args...]" >&2
  echo "  action:   generate | generateCoordinate | fill" >&2
  echo "  category: tt | pi | sf | ep | ca | lr | li | nc" >&2
  exit 1
}

[ $# -ge 2 ] || usage

ACTION=$1
CATEGORY=$2
shift 2

case "$CATEGORY" in
  tt) FOLDER=trafficAndTransport ;;
  pi) FOLDER=publicInfrastructure ;;
  sf) FOLDER=specialFacilities ;;
  ep) FOLDER=environmentalPollution ;;
  ca) FOLDER=commercialActivity ;;
  lr) FOLDER=landUseRegulation ;;
  li) FOLDER=landImprovement ;;
  nc) FOLDER=naturalConditions ;;
  *) usage ;;
esac

case "$ACTION" in
  generate)
    exec npx tsx --env-file-if-exists=.env "src/districtSurvey/$FOLDER/sample/generateSample.ts" "$@"
    ;;
  generateCoordinate)
    exec npx tsx --env-file-if-exists=.env "src/districtSurvey/$FOLDER/generateCoordinate.ts" "$@"
    ;;
  fill)
    exec npx tsx "src/districtSurvey/$FOLDER/fillPdf.ts" "$@"
    ;;
  *) usage ;;
esac
