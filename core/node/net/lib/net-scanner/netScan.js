import fs from 'fs';
import path from 'path';

import { colors, dmtStateDir } from 'dmt/common';
import arpscanner from './arpscanner-promise';
import { identify } from './deviceIdentifier';
import deviceDiffer from './deviceDiffer';
import deviceFilter from './deviceFilter';
import deviceSorter from './deviceSorter';

import currentNetworkDef from '../currentNetworkDef';
import networkInterfaces from '../networkInterfaces';

async function netScan(term = '', { rescan = true, silent = true } = {}) {
  try {
    const networkDef = await currentNetworkDef();

    const stateDir = networkDef ? path.join(dmtStateDir, networkDef.id.toLowerCase()) : dmtStateDir;

    if (!rescan) {
      const lastScanPath = path.join(stateDir, 'lastScan.json');

      if (fs.existsSync(lastScanPath)) {
        const devices = identify(JSON.parse(fs.readFileSync(lastScanPath)));
        return deviceSorter(deviceFilter(term, devices));
      }
    }

    const _interfaces = await networkInterfaces();

    let _interface;

    if (_interfaces.length > 0) {
      console.log(_interfaces);
      _interface = _interfaces[0].name;
    } else if (!silent) {
      console.log(colors.red('⚠️  No active network interfaces found, still trying to scan...'));
    }

    const scanResults = await arpscanner({ interface: _interface });

    return deviceSorter(deviceFilter(term, identify(deviceDiffer(stateDir, scanResults))));
  } catch (err) {
    console.log(colors.red(err));
  }
}

export default netScan;
