// Minimal stand-in for the Electron side of the native panel link.
//
// Used to exercise panel_main.cpp's IPC client without booting the whole app:
// it listens on loopback, sends one STATE line when the panel says HELLO, and
// logs every CMD the panel sends back.  ASCII-only, like the other probe tools.
//
//   node scripts/glass-probe/mock-panel-host.cjs [port] [extraStateFields]

const net = require('node:net');

const port = Number(process.argv[2] || 45999);
const extra = process.argv[3] || '';
const secondDelayMs = Number(process.argv[4] || 0);
// PowerShell splits a quoted ArgumentList entry on spaces, so re-join everything
// past the fixed positions rather than trusting a single argv slot.  Several HOST
// commands can be scheduled by separating them with ";;" (sent 2s apart).
const hostCmds = process.argv.slice(5).join(' ').split(';;').map((s) => s.trim()).filter(Boolean);
const state =
  'STATE repo=Mock/Injected-Repo stars=1234567 downloads=89012 ' +
  'flow=0 opacity=0.18 blur=0 radius=28 material=1 fps=1 ' +
  'status=injected-by-mock-host' + (extra ? ' ' + extra : '');

const server = net.createServer((sock) => {
  console.log('[mock] panel connected');
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      console.log('[mock] <- ' + line);
      if (line.startsWith('HELLO')) {
        sock.write(state + '\n');
        console.log('[mock] -> ' + state);
        if (hostCmds.length) {
          hostCmds.forEach((cmd, i) => {
            setTimeout(() => {
              try { sock.write(cmd + '\n'); console.log('[mock] -> ' + cmd); }
              catch (e) { console.log('[mock] host cmd write failed: ' + e.message); }
            }, 1500 + i * 2000);
          });
        }
        // Optional liveness check: push a *different* STATE later so we can tell
        // whether the panel actually re-renders on a live update, rather than
        // only reading the first one it ever receives.
        if (secondDelayMs > 0) {
          setTimeout(() => {
            const updated = state
              .replace('stars=1234567', 'stars=9999999')
              .replace('downloads=89012', 'downloads=111222')
              .replace('status=injected-by-mock-host', 'status=live-update-applied');
            try { sock.write(updated + '\n'); console.log('[mock] -> ' + updated); }
            catch (e) { console.log('[mock] update write failed: ' + e.message); }
          }, secondDelayMs);
        }
      }
    }
  });
  sock.on('close', () => console.log('[mock] panel disconnected'));
  sock.on('error', (e) => console.log('[mock] sock error: ' + e.message));
});

server.on('error', (e) => console.log('[mock] server error: ' + e.message));
server.listen(port, '127.0.0.1', () => console.log('[mock] listening on 127.0.0.1:' + port));
setTimeout(() => { console.log('[mock] done'); server.close(); process.exit(0); }, 90000);
