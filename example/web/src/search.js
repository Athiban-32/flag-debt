import flagsmith from '@flagsmith/flagsmith';

export function searchEndpoint() {
  return flagsmith.hasFeature('legacy_search') ? '/api/search-v1' : '/api/search';
}
