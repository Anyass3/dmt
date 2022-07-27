import setupScriptActionHandlers from './setupScriptActionHandlers';

import platformTools from './platformTools';

function init(program) {
  setupScriptActionHandlers(program);
}

export { init, platformTools };
