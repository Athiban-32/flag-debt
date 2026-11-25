import flagsmith from "flagsmith";

// Names of the flags in Flagsmith.
export enum Feature {
  NEW_SEARCH = "new_search",
  BILLING_V2 = "billing_v2",
  OLD_REPORTS = "old_reports",
}

export const isFeatureEnabled = (feature: Feature) => flagsmith.hasFeature(feature);
