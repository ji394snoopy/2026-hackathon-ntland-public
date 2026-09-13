import { ref } from "./jsonSchemaRef.js";

const COORDINATE_DESCRIPTION =
  "PDF point coordinates (bottom-left origin, same space as the page's own text layer) — " +
  "start from the reference value given in the prompt and correct it only if the printed " +
  "layout has actually moved.";

const MATCHES_REFERENCE_PROPERTY = {
  matchesReference: {
    type: "boolean",
    description:
      "Your judgment call, forced explicit: true only if you actually compared every number " +
      "in this group against the reference and the printed layout matches exactly, so you " +
      "copied them through unchanged. false if you changed any number in this group for any " +
      "reason — including a reference value that looked implausible on its face (e.g. far " +
      "outside a normal page's dimensions) rather than something you visually confirmed had " +
      "shifted.",
  },
};

export { ref, COORDINATE_DESCRIPTION, MATCHES_REFERENCE_PROPERTY };
