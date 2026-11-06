/*
 * Debug helper: runs a JavaScript expression inside the app's WebView on the
 * Android TV (debug builds only) and prints the result.
 *
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node tools/tv-eval.js "window.innerWidth"
 */
'use strict';

async function main() {
  const expression = process.argv[2];
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No WebView page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  const reply = await new Promise(resolve => {
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id === 1) resolve(msg);
    };
  });
  ws.close();
  const result = reply.result && reply.result.result;
  console.log(JSON.stringify(result && 'value' in result ? result.value : reply, null, 2));
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
