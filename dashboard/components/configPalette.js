// Config identity colors, fixed order, validated for the dark surface
// (dataviz six-checks: lightness band, chroma, CVD separation, contrast).
// #C06B9B is the dark-surface variant of Okabe-Ito reddish-purple #CC79A7
// (hue preserved, darkened to meet the lightness band). f16 is the baseline,
// not a series: it renders as a neutral marker with a direct label.
export const CONFIG_COLORS = {
  "q8_0": "#0072B2",
  "q4_0": "#D55E00",
  "q8_0/q4_0": "#009E73",
  "q4_0/q8_0": "#C06B9B",
};
export const CONFIG_ORDER = ["f16", "q8_0", "q4_0", "q8_0/q4_0", "q4_0/q8_0"];
export const BASELINE_COLOR = "#ffffff";
export const TEXT_SECONDARY = "#b7bcce";
export const TEXT_MUTED = "#7a8098";
export const HAIRLINE = "#1e2440";
export const SURFACE_RAISED = "#101430";

export function configColor(config) {
  return config === "f16" ? BASELINE_COLOR : CONFIG_COLORS[config];
}
