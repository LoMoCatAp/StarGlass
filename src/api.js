const defaults = { activeRepo: 0, repos: ['LoMoCatAp/Bika-HarmonyOS'], settingsTheme: 'system', showLogo: true, showBrandText: true, textColor: 'dark', textOutline: 0, textOutlineWidth: 1, interval: 30, opacity: 32, gloss: 40, blur: 5, refraction:32, dispersion:8, glassFps:0, fontSize:14, fontWeight:600, radius:28, glassOnly:false, tint: 'pearl', alwaysOnTop: false, clickThrough: false, autoStart: false, compact: false, mini: false, multiMini: false, panelOverrides: {}, customSize: false, panelWidth: 440, panelHeight: 610, panelShape: 'auto', resizeEnabled: false, showTooltips: false, allowScreenCapture: false, material: 'liquid' };
let preview = { settings: defaults, projects: {}, history: {}, errors: {}, refreshing: false, hasToken: false, rate: null, nativeGlass: false };
const listeners = new Set();
export const isDesktop = Boolean(window.starglass);
export const api = window.starglass || {
  getState: async () => preview,
  saveSettings: async settings => { preview = { ...preview, settings }; listeners.forEach(f => f(preview)); return preview; },
  setToken: async () => { throw new Error('请在桌面应用中设置 Token'); },
  refresh: async () => preview,
  openSettings: async () => { window.location.search = '?view=settings'; },
  openRepo: async repo => window.open(`https://github.com/${repo}`, '_blank', 'noopener'),
  hide: async () => {}, menu: async () => { window.location.search = '?view=settings'; },
  onState: fn => { listeners.add(fn); return () => listeners.delete(fn); }
};
