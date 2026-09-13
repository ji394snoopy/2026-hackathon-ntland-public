// commercialActivity's four facility-with-count fields must always print a quantity when the
// facility exists (fillEngine only draws quantityX when .quantity is present at all) — prompt.ts
// already instructs the model to default to 1 when the survey gives no explicit count, but this
// is enforced here too rather than trusted from the model alone, the same way this repo's other
// Bedrock pipelines resolve mechanical values locally instead of trusting them from the model
// (see src/regionalFactorGrading/resolveGrades.ts).

const QUANTITY_FIELDS = [
  "departmentStore",
  "financialInstitution",
  "entertainmentFacility",
  "exhibitionCenterOrHotel",
] as const;

function applyQuantityDefaults(commercialActivity: Record<string, any>): Record<string, any> {
  for (const field of QUANTITY_FIELDS) {
    const value = commercialActivity[field]?.value;
    if (value?.isExist === true && value.quantity === undefined) {
      value.quantity = 1;
    }
  }
  return commercialActivity;
}

export { applyQuantityDefaults };
