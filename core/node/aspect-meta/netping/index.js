import { log, device, apMode, isRPi, isMainDevice, isMobileDevice } from 'dmt/common';

import os from 'os';

const BOOT_WAIT_SECONDS = 30;

import { desktop } from 'dmt/notify';

import ExecutePing from './executePing';

const CLOUDFLARE_DNS = '1.0.0.1';
const DEFAULT_TTL = 20;
const NOTIFICATION_GROUP_PREFIX = `${device().id}_connectivity`;

function reportConnectivityOnLan() {
  return isRPi() || ['labstore', 'elmstore'].includes(device().id);
}

function init(program) {
  const wanConnectivity = new ExecutePing({ program, target: CLOUDFLARE_DNS, prefix: 'connectivity' });

  const localConnectivity = new ExecutePing({ program, prefix: 'localConnectivity' });

  wanConnectivity.on('connection_lost', ({ code }) => {
    const color = '#e34042';

    const prefix = isMainDevice() ? '❌ ' : '';
    const noConnectivityMsg = `${prefix}Internet unreachable — ping fail ${code || ''}`.trim();

    if (!isMobileDevice()) {
      log.red(noConnectivityMsg);
    }

    if (reportConnectivityOnLan()) {
      program.nearbyNotification({ msg: noConnectivityMsg, ttl: DEFAULT_TTL, color, group: `${NOTIFICATION_GROUP_PREFIX}_unreachable` });
    } else {
      desktop.notify(noConnectivityMsg);
    }
  });

  wanConnectivity.on('connection_resumed', () => {
    const prefix = isMainDevice() ? '✅ ' : '';
    const connResumedMsg = `${prefix}Internet connection resumed`;

    if (!isMobileDevice()) {
      log.green(`${connResumedMsg}`);
    }

    if (reportConnectivityOnLan()) {
      program.nearbyNotification({ msg: connResumedMsg, ttl: DEFAULT_TTL, color: '#E9D872', group: `${NOTIFICATION_GROUP_PREFIX}_resumed` });
    } else {
      desktop.notify(connResumedMsg);
    }

    program.store('device').removeKeys(['localConnectivityProblem', 'localConnectivityResumed', 'localConnectivityResumedAt']);
  });

  localConnectivity.on('connection_lost', ({ code }) => {
    const color = '#FF7A2C';

    const noConnectivityMsg = `✖ Router unreachable — ping fail ${code || ''}`.trim();

    if (!isMobileDevice()) {
      log.red(noConnectivityMsg);
    }

    if (reportConnectivityOnLan()) {
      program.nearbyNotification({ msg: noConnectivityMsg, ttl: 20, color, group: `${NOTIFICATION_GROUP_PREFIX}_local_connectivity` });
    } else {
      desktop.notify(noConnectivityMsg);
    }
  });

  localConnectivity.on('connection_resumed', () => {
    const connResumedMsg = 'Router connection resumed';

    if (!isMobileDevice()) {
      log.green(`${connResumedMsg}`);
    }

    if (reportConnectivityOnLan()) {
      program.nearbyNotification({ msg: connResumedMsg, ttl: 20, color: '#F1A36B', group: `${NOTIFICATION_GROUP_PREFIX}_local_connectivity` });
    } else {
      desktop.notify(connResumedMsg);
    }
  });

  const interval = 'tick';

  let count = 0;

  program.on(interval, () => {
    localConnectivity.cleanup();
    wanConnectivity.cleanup();

    if (!apMode()) {
      if (count > 0 && os.uptime() > BOOT_WAIT_SECONDS) {
        wanConnectivity.ping().then(() => {
          if (program.store('device').get('connectivityProblem')) {
            localConnectivity.ping();
          }
        });
      } else {
        count += 1;
      }
    }
  });
}

export { init };
