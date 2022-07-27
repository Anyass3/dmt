import path from 'path';

import { push } from 'dmt/notify';

import { log, colors, dmtPath, isRPi } from 'dmt/common';

import bashShutdown from './lib/shutdown';
import bashReboot from './lib/reboot';
import bashSetAccessPoint from './lib/setAccessPoint';
import bashDmtNext from './lib/dmtNext';
import sleepMacOS from './lib/sleepMacOS';

const scriptsPath = path.join(dmtPath, 'etc/scripts');

function ensureRPi({ namespace, action }) {
  if (isRPi()) {
    return true;
  }

  log.red(
    `Device is not ${colors.yellow(
      'RaspberryPi'
    )}, ignoring action ${namespace}/${action}\nIt shouldn't have come in the first place because options in GUI should not be visible!`
  );
}

export default function setupScriptActionHandlers(program) {
  program.onUserAction('device', ({ namespace, action }) => {
    log.yellow(`Received ${colors.magenta(namespace)}:${colors.cyan(action)} action`);
  });

  program.onUserAction('device/dmt_next', () => {
    bashDmtNext({ scriptsPath });
  });

  program.onUserAction('device/sleep_macos', () => {
    const msg = `Sleeping ${program.device.id} ...`;
    push.notify(msg);
    program.nearbyNotification({ msg, ttl: 60, color: '#1D61C0' });
    log.red(msg);
    sleepMacOS({ program });
  });

  program.onUserAction('device/shutdown', ({ namespace, action }) => {
    if (ensureRPi({ namespace, action })) {
      log.red('Shutting down now...');
      bashShutdown({ program });
    }
  });

  program.onUserAction('device/reboot', ({ namespace, action }) => {
    if (ensureRPi({ namespace, action })) {
      log.red('Rebooting now...');
      bashReboot({ program });
    }
  });

  program.onUserAction('device/ap_mode_enable', ({ namespace, action }) => {
    if (ensureRPi({ namespace, action })) {
      bashSetAccessPoint({ program, scriptsPath, action: 'enable' });
    }
  });

  program.onUserAction('device/ap_mode_disable', ({ namespace, action }) => {
    if (ensureRPi({ namespace, action })) {
      bashSetAccessPoint({ program, scriptsPath, action: 'disable' });
    }
  });
}
