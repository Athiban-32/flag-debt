import flagsmith from '@flagsmith/flagsmith';
import { FLAGS } from './flags.js';
import { renderNewPricing, renderOldPricing } from './pricing-views.js';

export function renderPricing(root) {
  if (flagsmith.hasFeature(FLAGS.pricing)) {
    renderNewPricing(root);
  } else {
    renderOldPricing(root); // dead since the new page went to 100%
  }
}
