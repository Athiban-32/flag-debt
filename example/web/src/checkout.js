import flagsmith from '@flagsmith/flagsmith';

export function checkoutFlow() {
  if (flagsmith.hasFeature('checkout_v3')) return 'v3';
  if (flagsmith.hasFeature('old_checkout')) return 'legacy';
  return 'v2';
}

export function showBetaDashboardLink() {
  return flagsmith.hasFeature('beta_dashboard');
}
