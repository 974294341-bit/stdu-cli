import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILE_DIR = 'browser-profiles';

export function getStduHome(options = {}) {
  const env = options.env ?? process.env;
  return env.STDU_CLI_HOME || join(homedir(), '.stdu-cli');
}

export function getProfilePath(browserId, options = {}) {
  return join(getStduHome(options), PROFILE_DIR, browserId);
}

export function getSessionFile(browserId, options = {}) {
  return join(getStduHome(options), `session-${browserId}.json`);
}
