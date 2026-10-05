'use strict';
// Bridge between the Electron main process and the native D3D11 glass panel.
//
// The panel deliberately carries no data logic: Electron keeps owning GitHub
// fetching, settings and persistence, and pushes them across loopback TCP as
// newline-delimited records.  See native/glass-panel/panel_main.cpp for the
// other end of this protocol.
//
//   host -> panel : STATE key=value ...      (one line; "status" last, may contain spaces)
//                   HOST show | hide | quit
//   panel -> host : HELLO panel
//                   CMD quit | openSettings | refresh | menu
//                   CMD moved x=<px> y=<py>
//
// The port is chosen by the OS (listen on 0) and handed to the panel through
// SG_IPC_PORT, so two instances never collide.  ASCII-only, like the rest of
// the project's tooling.

const net = require('node:net');
const { spawn } = require('node:child_process');

function encodeState(fields) {
  const parts = ['STATE'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${String(value).replace(/[\r\n]+/g, ' ')}`);
  }
  return parts.join(' ');
}

class PanelBridge {
  constructor({ exePath, env = {}, onCommand = () => {}, onConnect = () => {}, onExit = () => {}, log = () => {} }) {
    this.exePath = exePath;
    this.env = env;
    this.onCommand = onCommand;
    this.onConnect = onConnect;
    this.onExit = onExit;
    this.log = log;
    this.server = null;
    this.socket = null;
    this.child = null;
    this.port = 0;
    this.lastState = null;
    // HOST commands that must be re-applied on every (re)connect.  resize/font are
    // usually issued before the socket is up, so a fire-and-forget send would be
    // silently dropped and the panel would keep its startup geometry.
    this.shape = [];
    this.stopping = false;
  }

  start() {
    this.server = net.createServer((socket) => this.#onConnection(socket));
    this.server.on('error', (error) => this.log(`panel bridge server error: ${error.message}`));
    this.server.listen(0, '127.0.0.1', () => {
      this.port = this.server.address().port;
      this.log(`panel bridge listening on 127.0.0.1:${this.port}`);
      this.#spawnPanel();
    });
  }

  #spawnPanel() {
    this.child = spawn(this.exePath, [], {
      env: { ...process.env, ...this.env, SG_IPC_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.on('data', (chunk) => this.log(`[panel] ${String(chunk).trimEnd()}`));
    this.child.stderr.on('data', (chunk) => this.log(`[panel:err] ${String(chunk).trimEnd()}`));
    this.child.on('exit', (code, signal) => {
      this.child = null;
      this.log(`panel exited code=${code} signal=${signal}`);
      if (!this.stopping) { this.stop(); this.onExit(code); }
    });
    this.child.on('error', (error) => {
      this.log(`panel spawn failed: ${error.message}`);
      if (!this.stopping) { this.stop(); this.onExit(-1); }
    });
  }

  #onConnection(socket) {
    if (this.socket) { try { this.socket.destroy(); } catch { /* ignore */ } }
    this.socket = socket;
    socket.setEncoding('utf8');
    this.log('panel connected');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        if (line === 'HELLO panel') {
          if (this.lastState) this.send(this.lastState);
          for (const queued of this.shape) if (queued) this.send(queued);
          this.onConnect();
        } else if (line.startsWith('CMD ')) {
          this.#dispatch(line.slice(4));
        }
      }
    });
    socket.on('close', () => { if (this.socket === socket) this.socket = null; this.log('panel disconnected'); });
    socket.on('error', () => { /* close follows */ });
  }

  #dispatch(command) {
    const [name, ...rest] = command.split(' ');
    const args = {};
    for (const token of rest) {
      const eq = token.indexOf('=');
      if (eq > 0) args[token.slice(0, eq)] = token.slice(eq + 1);
    }
    try { this.onCommand(name, args); }
    catch (error) { this.log(`panel command '${name}' failed: ${error.message}`); }
  }

  send(line) {
    if (!this.socket || this.socket.destroyed) return false;
    this.socket.write(`${line}\n`);
    return true;
  }

  push(fields) {
    this.lastState = encodeState(fields);
    return this.send(this.lastState);
  }

  show() { return this.send('HOST show'); }
  hide() { return this.send('HOST hide'); }
  move(x, y) { return this.send(`HOST move x=${Math.round(x)} y=${Math.round(y)}`); }
  resize(w, h) {
    const line = `HOST resize w=${Math.round(w)} h=${Math.round(h)}`;
    this.shape[0] = line;
    return this.send(line);
  }

  font(px, bold) {
    const line = `HOST font px=${Math.round(px)} bold=${bold ? 1 : 0}`;
    this.shape[1] = line;
    return this.send(line);
  }

  get connected() { return Boolean(this.socket && !this.socket.destroyed); }

  stop() {
    this.stopping = true;
    this.send('HOST quit');
    if (this.socket) { try { this.socket.end(); } catch { /* ignore */ } }
    if (this.server) { try { this.server.close(); } catch { /* ignore */ } }
    if (this.child) { try { this.child.kill(); } catch { /* ignore */ } }
  }
}

module.exports = { PanelBridge, encodeState };
