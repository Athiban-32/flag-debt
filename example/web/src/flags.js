import flagsmith from '@flagsmith/flagsmith';

export const FLAGS = {
  installSection: 'install_section',
  pricing: 'new_pricing_page',
  darkMode: 'dark_mode',
};

export async function initFlags(identity) {
  await flagsmith.init({
    environmentID: import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_KEY,
    identity,
    enableEvents: true,
  });
  return flagsmith;
}
