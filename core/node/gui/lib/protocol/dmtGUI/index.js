import { log, colors, isDevMachine } from 'dmt/common';

import handleErrorFromGui from './helpers/handleErrorFromGui';

import loadGuiViewsDef from '../../../loadGuiViewsDef';

import onConnect from './onConnect';

export default function initProtocol({ program }) {
  loadGuiViewsDef(program);

  const channels = program.registerProtocol({ protocol: 'dmt/gui', onConnect });

  program.store().sync(channels);

  if (isDevMachine()) {
    log.magenta('⚠️  Reminder: remove this GUITarget after dmt gui moves to Svelte3');
  }

  program.onUserAction('gui/errors', ({ payload }) => {
    handleErrorFromGui(payload);
  });

  program.onUserAction('gui/show_frontend_log', () => {
    program.store('device').update({ showFrontendLog: true });
  });

  program.onUserAction('gui/close_frontend_log', () => {
    program.store('device').removeKey('showFrontendLog');
  });

  program.onUserAction('*', ({ namespace, action, payload }) => {
    if (namespace != 'gui') {
      log.gray(`Received user action ${colors.cyan(namespace)}::${colors.green(action)}`);
      if (payload) {
        log.gray('Payload: ', JSON.stringify(payload, null, 2));
      }
    }
  });

  program.on('send_to_connected_guis', ({ action, payload }) => {
    log.cyan(
      `Received request to send action ${colors.magenta(`gui:${action}`)} to frontend${
        payload ? `${colors.cyan(' with payload')} ${colors.yellow(payload)}` : ''
      }`
    );

    if (action == 'reload') {
      loadGuiViewsDef(program);
    }

    channels.signalAll('frontend_action', { action, payload });
  });
}
