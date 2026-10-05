const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, safeStorage, powerMonitor, net, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, validateSettings, normalizeRepo, GitHubClient, addSample } = require('./core.cjs');
const { GlassCapture } = require('./glass.cjs');
const { roundWindowShape } = require('./frame-reader.cjs');
const { PanelBridge } = require('./panel-bridge.cjs');
const {panelSize,panelRadius}=require('./panel-layout.cjs');
const {CapsuleManager}=require('./capsule-manager.cjs');
const {CaptureCoordinator}=require('./capture-coordinator.cjs');
const {panelSettings,overridePanel}=require('./panel-appearance.cjs');
const gpuSharedName=`Local\\StarGlassGPU_${process.pid}_${require('node:crypto').randomUUID()}`;
let settingsFocus={repo:'',revision:0};
if (process.env.STARGLASS_DATA_DIR) app.setPath('userData', path.resolve(process.env.STARGLASS_DATA_DIR));
const single = app.requestSingleInstanceLock();
// The native D3D11 glass panel (native/glass-panel) is now the default path: it
// replaces the rejected GDI-capture + WebGL renderer.  STARGLASS_NATIVE_PANEL=0
// forces the old path back for comparison. Native exits keep all panels closed;
// only an explicit tray action restarts them. Never resurrect the legacy panel.
const NATIVE_PANEL = process.env.STARGLASS_NATIVE_PANEL !== '0';
// Packaged builds receive the panel through extraResources (it sits next to the
// asar in resources/); dev runs use it straight out of the working tree.
const PANEL_EXE = process.env.STARGLASS_PANEL_EXE
  || (app.isPackaged
    ? path.join(process.resourcesPath, 'glasspanel.exe')
    : path.join(__dirname, '../native/glass-panel/glasspanel.exe'));
// StarGlass material names -> Glass::Material indices (Thin/Regular/Thick/Accent/Knob/Clear).
const { panelState: makePanelState } = require('./panel-model.cjs');
let nativeActive = false;
let captureStatus='live',mainCapsuleRepo=null,panelError='';
let panel, settingsWindow, tray, state, client, timer, glass, bridge, nativePanelVisible = true, quitting = false, refreshing = false, lastRefresh = 0, storageError = '';
const file = () => path.join(app.getPath('userData'), 'state.json');
function persist() {
  try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(`${file()}.tmp`, JSON.stringify(state)); fs.renameSync(`${file()}.tmp`, file()); storageError = ''; }
  catch { storageError = '设置保存失败，请检查磁盘空间及目录权限'; throw new Error(storageError); }
}
function snapshot() { return { settings: state.settings, projects: state.projects, history: state.history, errors: state.errors, refreshing, rate: client.rate, hasToken: Boolean(state.token), storageError, panelError, settingsFocus, captureStatus, nativePanel:nativeActive, nativeGlass: process.platform === 'win32' && Number(require('node:os').release().split('.')[2]) >= 22621 }; }
function broadcast() { for (const w of [panel, settingsWindow]) if (w && !w.isDestroyed()) w.webContents.send('state', snapshot()); pushPanelState(); }
// Exactly what the native panel draws -- numbers and appearance only.  It never
// receives the token or the raw settings object; only a bounded display series.
function panelState() { return makePanelState(state, refreshing); }
// Panel size mirrors what the Electron panel window would have used, so the two
// stay interchangeable while the native panel is being brought up.
function pushPanelShape() {
  if (!bridge) return;
  const s = panelSettings(state.settings);
  const { w, h } = panelSize(s);
  bridge.resize(w, h);
  bridge.font(s.fontSize, s.fontWeight >= 600);
}
function pushPanelState() { if (bridge) bridge.push(panelState()); capsules.push(state); }
function security(win) {
  win.on('page-title-updated', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
function load(win, view) { security(win); return win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { view } }); }
function hidePanel() {
  nativePanelVisible=false;bridge?.hide();capsules.setVisible(false);
  panel?.hide();glass?.setActive(false);tray?.setContextMenu(trayMenu());
}
function showPanel() {
  if(!state||!panel||quitting)return;
  nativePanelVisible=true;
  if(NATIVE_PANEL){
    if(!nativeActive)startNativePanel();
    else {bridge?.show();capsules.resume(state);}
  }else{
    glass?.setActive(true,state.settings.glassFps);panel.show();panel.focus();
  }
  tray?.setContextMenu(trayMenu());
}
function stopNativePanels(reason,message='') {
  nativeActive=false;nativePanelVisible=false;mainCapsuleRepo=null;panelError=message;
  const previous=bridge;bridge=null;previous?.stop();capsules.stop();
  panel?.hide();glass?.setActive(false);captureCoordinator.reconcile();
  tray?.setContextMenu(trayMenu());broadcast();
  console.error(`[panel-bridge] ${reason}; panels stay closed`);
}
function settingsDark() { return state.settings.settingsTheme === 'dark' || (state.settings.settingsTheme === 'system' && nativeTheme.shouldUseDarkColors); }
function showSettings(repo) {
  settingsFocus={repo:typeof repo==='string'&&state.settings.repos.includes(repo)?repo:'',revision:settingsFocus.revision+1};
  broadcast();
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ width: 1020, height: 790, minWidth: 900, minHeight: 700, title: 'StarGlass · 设置', frame: false, show: false, backgroundColor: settingsDark() ? '#111a20' : '#f3f6f5', icon: path.join(__dirname, '../assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  load(settingsWindow, 'settings'); settingsWindow.once('ready-to-show', () => settingsWindow.show()); settingsWindow.on('close', event => { if (!quitting) { event.preventDefault(); settingsWindow.hide(); } }); settingsWindow.on('closed', () => settingsWindow = null);
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'StarGlass · GitHub 桌面监控', enabled: false }, { type: 'separator' },
    { id:'panel-visibility',label:nativePanelVisible?'隐藏桌面面板':'显示桌面面板',
      click:()=>{if(nativePanelVisible)hidePanel();else showPanel();} },
    { label: '设置…', click: showSettings },
    { label: '立即刷新', enabled: !refreshing, click: () => refresh() },
    { label: '监控项目', enabled: state.settings.repos.length > 0,
      submenu: state.settings.repos.map((repo, index) => ({
        label: repo, type: 'radio', checked: index === state.settings.activeRepo,
        click: () => updateSettings({ ...state.settings, activeRepo: index })
      })) },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: panelSettings(state.settings).alwaysOnTop, click: item => updateCurrentPanel({alwaysOnTop:item.checked}) },
    { label: '鼠标穿透（可在此取消）', type: 'checkbox', checked: panelSettings(state.settings).clickThrough, click: item => updateCurrentPanel({clickThrough:item.checked}) },
    { label: '重置面板位置', click: () => {
        const area=screen.getPrimaryDisplay().workArea,size=panelSize(panelSettings(state.settings));
        const position={x:area.x+area.width-size.w-32,y:area.y+64};state.position=position;
        const repo=state.settings.repos[state.settings.activeRepo]||state.settings.repos[0];
        if(repo){state.capsulePositions??={};state.capsulePositions[repo]=position;}
        try{persist();}catch{}
        if(bridge)bridge.move(position.x,position.y);else panel.setPosition(position.x,position.y);
        showPanel();
      } },
    { type: 'separator' }, { id:'quit',label: '退出 StarGlass', click: () => { quitting = true; app.quit(); } }
  ]);
}
function applySettings() {
  const s = panelSettings(state.settings);
  settingsWindow?.setBackgroundColor(settingsDark() ? '#111a20' : '#f3f6f5');
  panel.setAlwaysOnTop(s.alwaysOnTop);
  panel.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  // Windows fixes min/max tracking bounds on non-resizable windows.
  panel.setResizable(true);
  const size=panelSize(s);
  panel.setMinimumSize(260,s.mini?32:330+(s.fontSize-12)*14);
  panel.setMaximumSize(1200,1200);
  panel.setSize(size.w,size.h);
  panel.setResizable(s.resizeEnabled);
  if (process.platform === 'win32') {
    const optical = ['pure','liquid'].includes(s.material);
    panel.setContentProtection(optical);
    // A system Acrylic backdrop fills the native rectangle, including CSS corners.
    panel.setBackgroundMaterial(s.material === 'acrylic' ? 'acrylic' : 'none');
    const [width,height]=panel.getSize();
    panel.setShape(roundWindowShape(width,height,panelRadius(s)));
    glass?.setActive(optical&&!NATIVE_PANEL&&nativePanelVisible,s.glassFps);
  }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.autoStart, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
  if (tray) tray.setContextMenu(trayMenu());
  pushPanelShape();
  const currentRepo=s.repos[s.activeRepo]||s.repos[0];
  if(nativeActive&&currentRepo&&mainCapsuleRepo!==currentRepo){
    const position=capsulePosition(currentRepo,s.activeRepo,panelSize(s),mainCapsuleRepo===null?state.position:undefined);
    state.capsulePositions??={};state.capsulePositions[currentRepo]=position;state.position=position;bridge?.move(position.x,position.y);mainCapsuleRepo=currentRepo;
    try{persist();}catch{}
  }
  if(nativeActive)capsules.reconcile(state,nativePanelVisible);else capsules.stop();
  captureCoordinator.reconcile();
  clearInterval(timer); timer = setInterval(() => refresh(), s.interval * 60000);
}
function updateCurrentPanel(patch){const repo=state.settings.repos[state.settings.activeRepo]||state.settings.repos[0];return updateSettings(repo?overridePanel(state.settings,repo,patch):{...state.settings,...patch});}
function updateSettings(value) {
  const previous = state.settings; state.settings = validateSettings(value);
  try { persist(); } catch (e) { state.settings = previous; throw e; }
  applySettings(); broadcast();
  if (state.settings.repos.some(r => !previous.repos.includes(r))) { lastRefresh = 0; if (!refreshing) void refresh(); }
  return snapshot();
}
async function refresh() {
  if (refreshing || Date.now() - lastRefresh < 60000) return snapshot();
  refreshing = true; lastRefresh = Date.now(); broadcast();
  const repos = [...state.settings.repos];
  try {
    for (const repo of repos) {
      try {
        const stats = await client.stats(repo);
        state.projects[repo] = stats; state.history[repo] = addSample(state.history[repo], stats); delete state.errors[repo];
      } catch (error) { state.errors[repo] = error.message; }
      broadcast();
    }
    try { persist(); } catch { /* The visible storage error keeps the last good file intact. */ }
  } finally { refreshing = false; if (tray) tray.setContextMenu(trayMenu()); broadcast(); }
  if (state.settings.repos.some(r => !repos.includes(r))) { lastRefresh = 0; void refresh(); }
  return snapshot();
}
// Shows the legacy Electron panel.  Used when the native panel is forced off and
// only by the explicit STARGLASS_NATIVE_PANEL=0 development override.
let panelLoaded = false;
function useElectronPanel(reason) {
  nativeActive = false;capsules.stop();captureCoordinator.reconcile();
  if (!glass) glass = new GlassCapture({app, screen, panel, send:frame=>{if(!panel.isDestroyed())panel.webContents.send('glass-frame',frame);}});
  applySettings();
  console.error(`[panel-bridge] ${reason}; falling back to the Electron panel`);
  if (!panel || panel.isDestroyed()) return;
  if (panelLoaded) { showPanel(); return; }
  panelLoaded = true;
  load(panel, 'panel');
  panel.once('ready-to-show', showPanel);
}

// Spawns the native D3D11 glass panel and wires its command channel back into
// the app.  Electron keeps owning GitHub data, settings and persistence; the
// panel only draws.
function startNativePanel() {
  if(nativeActive||bridge||quitting)return;
  if (!fs.existsSync(PANEL_EXE)) {
    stopNativePanels(`native panel missing at ${PANEL_EXE}`,'玻璃面板启动失败，请检查应用文件是否完整。');
    return;
  }
  const s = panelSettings(state.settings);
  {const repo=s.repos[s.activeRepo]||s.repos[0];if(repo){state.position=capsulePosition(repo,s.activeRepo,panelSize(s),state.position);state.capsulePositions??={};state.capsulePositions[repo]=state.position;mainCapsuleRepo=repo;}}
  nativeActive = true;panelError='';
  const activeBridge = new PanelBridge({
    exePath: PANEL_EXE,
    env: {
      SG_GPU_SHARED_NAME:gpuSharedName,SG_GPU_SHARED_ROLE:'producer',
      SG_W:String(panelSize(s).w),SG_H:String(panelSize(s).h),SG_MINI:s.mini?'1':'0',
      SG_FONT_PX: String(s.fontSize),
      SG_SHOW_FPS: '0',
      SG_TOPMOST: s.alwaysOnTop ? '1' : '0',
      SG_CLICKTHROUGH: s.clickThrough ? '1' : '0',
      SG_X: state.position ? String(state.position.x) : undefined,
      SG_Y: state.position ? String(state.position.y) : undefined,
    },
    log: (line) => console.log(`[panel-bridge] ${line}`),
    onConnect:()=>{if(!nativePanelVisible)bridge?.hide();captureCoordinator.reconcile(true);},
    onCommand: (name, args) => {
      if(name==='snapshotReady'){captureCoordinator.acknowledge('primary',args);return;}
      if(name==='captureError'){captureCoordinator.fail(args);return;}
      if(name==='resized'){applyPanelResize(args);return;}
      if (name === 'openSettings') showSettings(state.settings.repos[state.settings.activeRepo]);
      else if (name === 'hide') hidePanel();
      else if (name === 'openRepo') { const repo = state.settings.repos[state.settings.activeRepo]; if (repo) void shell.openExternal(`https://github.com/${normalizeRepo(repo)}`); }
      else if (name === 'nextRepo' || name === 'previousRepo') { const s = panelSettings(state.settings); if (s.repos.length) updateSettings({...s, activeRepo:(s.activeRepo + (name === 'nextRepo' ? 1 : s.repos.length - 1)) % s.repos.length}); }
      else if (name === 'refresh') void refresh();
      else if (name === 'menu') tray?.popUpContextMenu(trayMenu());
      else if (name === 'quit') { quitting = true; app.quit(); }
      else if (name === 'moved') {
        const x = Number(args.x), y = Number(args.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          state.position = { x, y };
          if(state.settings.repos.length){state.capsulePositions??={};state.capsulePositions[state.settings.repos[state.settings.activeRepo]]={x,y};}
          try { persist(); } catch { /* keep the last good file */ }
        }
      }
    },
    onExit: (code) => {
      if(quitting||bridge!==activeBridge)return;
      stopNativePanels(`native panel exited (code=${code})`,'玻璃面板已关闭，可从托盘选择“显示桌面面板”重新打开。');
    },
  });
  bridge=activeBridge;bridge.start();
  capsules.reconcile(state,nativePanelVisible);captureCoordinator.reconcile();
  pushPanelShape();
  pushPanelState();
}
function applyPanelResize(args,repo=state.settings.repos[state.settings.activeRepo]||state.settings.repos[0]){
 const w=Number(args.w),h=Number(args.h);if(!Number.isFinite(w)||!Number.isFinite(h))return;
 const size=panelSize(panelSettings(state.settings,repo));if(Math.abs(size.w-w)<1&&Math.abs(size.h-h)<1)return;
 updateSettings(repo?overridePanel(state.settings,repo,{customSize:true,panelWidth:w,panelHeight:h}):{...state.settings,customSize:true,panelWidth:w,panelHeight:h});
}
function capsulePosition(repo,index,size,fallback){
 const saved=state.capsulePositions?.[repo]??fallback,area=screen.getPrimaryDisplay().workArea;
 if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)&&screen.getAllDisplays().some(d=>saved.x>=d.workArea.x&&saved.y>=d.workArea.y&&saved.x+size.w<=d.workArea.x+d.workArea.width&&saved.y+size.h<=d.workArea.y+d.workArea.height))return saved;
 const rows=Math.max(1,Math.floor((area.height-96)/(size.h+12))),columns=Math.max(1,Math.floor((area.width-64)/(size.w+16)));
 const column=Math.min(Math.floor(index/rows),columns-1),row=index%rows;
 return {x:area.x+Math.max(0,area.width-size.w-32-column*(size.w+16)),y:area.y+Math.min(64+row*(size.h+12),Math.max(0,area.height-size.h))};
}
const capsules=new CapsuleManager({exePath:PANEL_EXE,sharedName:gpuSharedName,positionFor:capsulePosition,
 log:line=>console.log(`[capsules] ${line}`),onConnect:()=>captureCoordinator.reconcile(true),onExit:()=>captureCoordinator.reconcile(true),
 onCommand:(repo,name,args)=>{
  if(name==='snapshotReady'){captureCoordinator.acknowledge(`repo:${repo}`,args);return;}
  if(name==='captureError'){captureCoordinator.fail(args);return;}
  if(name==='moved'){const x=Number(args.x),y=Number(args.y);if(Number.isFinite(x)&&Number.isFinite(y)){state.capsulePositions??={};state.capsulePositions[repo]={x,y};try{persist();}catch{}}}
  else if(name==='resized')applyPanelResize(args,repo);
  else if(name==='openSettings')showSettings(repo);
  else if(name==='openRepo')void shell.openExternal(`https://github.com/${normalizeRepo(repo)}`);
  else if(name==='refresh')void refresh();
  else if(name==='hide')capsules.hideRepo(repo);
 }});
const captureCoordinator=new CaptureCoordinator({
 getBridges:()=>nativeActive?[['primary',bridge],...capsules.entries()]:[],
 onStatus:status=>{captureStatus=status;if(state)for(const w of [panel,settingsWindow])if(w&&!w.isDestroyed())w.webContents.send('state',snapshot());}
});
// Test-only hook: lets an external harness drive the SAME main-process path the
// settings UI uses, so a settings change can be asserted end to end against the
// native panel window.  Off unless explicitly
// enabled, and it exposes nothing the renderer could not already reach.
if (process.env.STARGLASS_TEST_HOOKS === '1') {
  global.__starglassTest = {
    snapshot,
    sendNative:command=>bridge?.send(command),
    updateSettings,
    showSettings,
    showPanel,
    trayAction:id=>{const item=trayMenu().getMenuItemById(id);if(!item)throw new Error('Unknown tray action');item.click(item);},
    captureFrame: repo => (repo?capsules.entries().find(([id])=>id===`repo:${repo}`)?.[1]:bridge)?.send('HOST capture'),
    capsules:()=>capsules.entries().map(([id,b])=>({id,pid:b.child?.pid,connected:b.connected})),
    // Lets a harness assert the packaged app really spawned AND connected the
    // native panel.
    panelBridge: () => (bridge ? { connected: bridge.connected, exe: PANEL_EXE, pid: bridge.child?.pid } : null),
  };
}
if (!single) app.quit();
else {
  app.on('second-instance', showPanel);
  app.whenReady().then(() => {
    state = { settings: { ...DEFAULTS }, projects: {}, history: {}, errors: {}, token: '' };
    try { const saved = JSON.parse(fs.readFileSync(file(), 'utf8')); state = { ...state, ...saved, settings: validateSettings(saved.settings || {}) }; }
    catch (e) { if (e.code !== 'ENOENT') storageError = '上次配置无法读取，已恢复默认设置'; }
    let token = '';
    try { if (state.token && safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(state.token, 'base64')); }
    catch { storageError = '保存的 Token 无法解密，请重新设置'; }
    client = new GitHubClient({ token, fetcher: (url, options) => net.fetch(url, options) });
    const area = screen.getPrimaryDisplay().workArea;
    const savedPosition = state.position;
    const validPosition = savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y) && screen.getAllDisplays().some(d => savedPosition.x >= d.workArea.x && savedPosition.y >= d.workArea.y && savedPosition.x + panelSize(panelSettings(state.settings)).w <= d.workArea.x + d.workArea.width && savedPosition.y + panelSize(panelSettings(state.settings)).h <= d.workArea.y + d.workArea.height);
    if (!validPosition) state.position=undefined;
    panel = new BrowserWindow({ width: panelSize(panelSettings(state.settings)).w, height: panelSize(panelSettings(state.settings)).h, x: validPosition ? savedPosition.x : area.x + area.width - panelSize(panelSettings(state.settings)).w - 32, y: validPosition ? savedPosition.y : area.y + 64, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, roundedCorners: true, resizable: false, maximizable: false, skipTaskbar: true, show: false, title: 'StarGlass', icon: path.join(__dirname, '../assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    panel.on('system-context-menu',event=>{if(panelSettings(state.settings).mini){event.preventDefault();showSettings();}});
    panel.on('close', event => { if (!quitting) { event.preventDefault();hidePanel(); } });
    let resizeTimer;
    panel.on('resized',()=>{if(nativeActive||!panelSettings(state.settings).resizeEnabled)return;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!panel.isDestroyed()&&!nativeActive){const [w,h]=panel.getSize();applyPanelResize({w,h});}},150);});
    let moveTimer;
    panel.on('moved', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { if (panel.isDestroyed()) return; const { x, y } = panel.getBounds(); state.position = { x, y }; try { persist(); } catch { broadcast(); } }, 400); });
    if (!NATIVE_PANEL) glass = new GlassCapture({app,screen,panel,send:frame=>{if(!panel.isDestroyed())panel.webContents.send('glass-frame',frame);}});
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png')).resize({ width: 32, height: 32 }));
    tray.setToolTip('StarGlass · GitHub 桌面监控'); tray.on('double-click', showPanel); tray.on('click', showPanel);
    applySettings();
    // The Electron panel window is always created AND loaded: the tray and
    // settings code paths call into it, and the smoke tests look for its page.
    // In native mode it is simply never shown -- the D3D11 panel is what the
    // user sees. The old surface stays hidden unless explicitly selected at startup.
    load(panel, 'panel');
    panelLoaded = true;
    if (NATIVE_PANEL) startNativePanel();
    else useElectronPanel('STARGLASS_NATIVE_PANEL=0');
    function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { if (![panel, settingsWindow].some(w => w && !w.isDestroyed() && w.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized'); return fn(event, ...args); }); }
    handle('get-state', () => snapshot());
    handle('save-settings', (_, value) => updateSettings(value));
    handle('set-token', (_, value) => {
      if (typeof value !== 'string' || value.length > 512) throw new Error('Token 格式无效');
      value = value.trim(); if (value && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未保存 Token');
      const old = state.token; state.token = value ? safeStorage.encryptString(value).toString('base64') : '';
      try { persist(); } catch (e) { state.token = old; throw e; }
      client = new GitHubClient({ token: value, fetcher: (url, options) => net.fetch(url, options) }); lastRefresh = 0; broadcast(); return snapshot();
    });
    handle('refresh', () => refresh()); handle('open-settings', showSettings);
    handle('open-repo', (_, repo) => shell.openExternal(`https://github.com/${normalizeRepo(repo)}`));
    handle('hide', event => { if (settingsWindow?.webContents === event.sender) settingsWindow.hide(); else hidePanel(); });
    handle('menu', () => tray.popUpContextMenu(trayMenu()));
    powerMonitor.on('resume', () => refresh());
    powerMonitor.on('lock-screen', () => { if (glass) glass.locked = true; });
    powerMonitor.on('unlock-screen', () => { if (glass) glass.locked = false; });
    powerMonitor.on('suspend', () => { if (glass) glass.locked = true; });
    powerMonitor.on('resume', () => { if (glass) glass.locked = false; });
    void refresh();
  });
  app.on('before-quit', () => { quitting = true; clearInterval(timer); capsules.stop();captureCoordinator.stop();bridge?.stop(); glass?.dispose(); });
  app.on('window-all-closed', () => {});
}
