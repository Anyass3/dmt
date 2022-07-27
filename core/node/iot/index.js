import path from 'path';

import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const modulesPath = path.join(__dirname, 'modules');

import mqttClient from './createMqttClient';

import * as powerline from './lib/powerline';

import removeStaleNearbySensorsData from './removeStaleNearbySensorsData';

import loadIotModules from './loadIotModules';

let program;

function init(_program) {
  program = _program;

  loadIotModules({ program, modulesPath });

  removeStaleNearbySensorsData(program);
  program.on('tick', () => removeStaleNearbySensorsData(program));
}

export { init, loadIotModules, mqttClient, powerline };
