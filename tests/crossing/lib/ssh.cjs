'use strict';
/**
 * tests/crossing/lib/ssh.cjs — one way to run a command on a SIT VM over ssh (the key and user come from topology.json), with stdin.
 * OWNS      the ssh argument list · the compose container names · a timeout that kills the child
 * CALLED BY lib/secret.cjs (read the tester code) · lib/db.cjs (read-only psql) · scenarios that stop/start the far side (R8, opt-in)
 * FLOW      run(topo, installation, remoteCommand, { stdin }) → { code, stdout, stderr }
 * The remote command is a fixed string built from the topology's own words (project, container); nothing a server answered is ever put in it.
 */
const cp = require('child_process');
const os = require('os');
const path = require('path');

const home = (file) => String(file).replace(/^~(?=$|[\/])/, os.homedir());
const SAFE_WORD = /^[a-z][a-z0-9_-]*$/;

/** the container a compose project names: <project>-api-1 · <project>-db-1 */
function container(topo, key, service) {
  const project = topo.installations[key].project;
  if (!SAFE_WORD.test(project) || !SAFE_WORD.test(service)) throw new Error('ssh: refusing an odd container name ' + project + '/' + service);
  return project + '-' + service + '-1';
}

/** the argument list for ssh (exported so the self-test can look at it without connecting) */
function argsFor(topo, key, remoteCommand) {
  const inst = topo.installations[key];
  return ['-i', path.resolve(home(topo.ssh.key)), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', topo.ssh.user + '@' + inst.ip, remoteCommand];
}

function run(topo, key, remoteCommand, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const child = cp.spawn('ssh', argsFor(topo, key, remoteCommand), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('ssh to ' + key + ' timed out after ' + (o.timeoutMs || 60000) + ' ms'));
    }, o.timeoutMs || 60000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(o.stdin || '');
  });
}

module.exports = { argsFor, container, run, SAFE_WORD };
