import { Feature, isFeatureEnabled } from "./featureFlag";

export const Page = () => (isFeatureEnabled(Feature.NEW_SEARCH) ? "new" : "old");
export const billing = () => isFeatureEnabled(Feature.BILLING_V2);
export const typo = () => isFeatureEnabled("billing_vv2");
