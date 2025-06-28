
import { VVVFSimulator } from './simulator.js';
import { trainSpecs, globalConfig } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const simulator = new VVVFSimulator(trainSpecs, globalConfig);
  simulator.initialize();
});
