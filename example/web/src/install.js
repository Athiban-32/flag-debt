import flagsmith from '@flagsmith/flagsmith';
import { FLAGS } from './flags.js';

export function installVariant() {
  return flagsmith.getExperimentFlag(FLAGS.installSection)?.value ?? 'one_liner';
}

export function theme() {
  return flagsmith.hasFeature(FLAGS.darkMode) ? 'dark' : 'light';
}
