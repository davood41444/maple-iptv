/*
 * Starts a built desktop app and checks that its interface loads (used by the Release
 * build on GitHub, on Windows, Mac and Linux):
 *
 *   node tools/smoke-desktop.js <program> [arguments...]
 *
 * The app is started with remote debugging; the check asks the page whether the interface
 * started and opened its first screen, and whether the app is in free mode.
 */
'use strict';
const { spawn, execSync } = require('child_process');

const PORT = 9333;
const [program, ...args] = process.argv.slice(2);
const child = spawn(program, args.concat('--remote-debugging-port=' + PORT), {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });
let exited = null;
child.on('exit', code => { exited = code; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stop() {
  try {
    if (process.platform === 'win32') execSync('taskkill /pid ' + child.pid + ' /T /F', { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch (e) { /* already gone */ }
}

async function evaluate(socketUrl, expression) {
  const ws = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = new Promise(resolve => {
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m);
    };
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expression, returnByValue: true } }));
  const m = await reply;
  ws.close();
  return m.result && m.result.result ? m.result.result.value : null;
}

(async () => {
  const deadline = Date.now() + 90000;
  let state = null;
  while (Date.now() < deadline && exited === null) {
    await sleep(2000);
    try {
      const pages = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = pages.find(p => p.type === 'page' && p.url.startsWith('http://127.0.0.1'));
      if (!page) continue;
      state = JSON.parse(await evaluate(page.webSocketDebuggerUrl, `JSON.stringify({
        version: window.App && App.version,
        screen: window.App && App.router && App.router.current ? App.router.current.name : null,
        free: !!(window.App && App.premium && App.premium.unlimited),
      })`));
      if (state.screen) break;
    } catch (e) { /* not ready yet */ }
  }
  stop();
  console.log('Interface:', JSON.stringify(state));
  if (!state || !state.screen || !state.free) {
    console.log(exited !== null ? 'The app closed (exit code ' + exited + ').' : 'The interface did not start in time.');
    console.log(log.slice(-6000));
    process.exit(1);
  }
  process.exit(0);
})();
