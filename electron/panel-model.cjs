// Only public display data crosses into the native renderer.
const text = value => encodeURIComponent(String(value ?? ''));
const {panelRadius,compactLayout}=require('./panel-layout.cjs');
const {panelSettings}=require('./panel-appearance.cjs');
function panelState(state, refreshing = false, now = Date.now()) {
  const s = panelSettings(state.settings);
  const repo = s.repos[s.activeRepo] || s.repos[0] || '';
  const data = state.projects[repo];
  const error = state.errors[repo];
  const history = (state.history[repo] || []).filter(p => p.time >= now - 7 * 86400000);
  // Bound the wire payload, retain the first and last point and actual time spacing.
  const series = history.length <= 120 ? history : Array.from({length:120}, (_, i) => history[Math.round(i * (history.length - 1) / 119)]);
  const previous = history.length > 1 ? history.at(-2) : null;
  return {
    repo, stars: data?.stars ?? -1, downloads: data?.downloads ?? -1,
    forks: data?.forks ?? -1, version: text(data?.version),
    description: text(data?.description),
    updated: text(data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) : ''),
    repoIndex: s.multiMini?0:s.activeRepo, repoCount: s.multiMini?1:s.repos.length,
    seriesStars: series.map(p => `${p.time}:${p.stars}`).join(','),
    seriesDownloads: series.map(p => `${p.time}:${p.downloads}`).join(','),
    deltaStars: previous && data ? data.stars - previous.stars : '',
    deltaDownloads: previous && data ? data.downloads - previous.downloads : '',
    refreshing: refreshing ? 1 : 0, hasError: error ? 1 : 0,
    flow: 0, opacity: s.opacity / 100, blur: s.blur / 40, radius: panelRadius(s),
    material: 1, gloss: s.gloss / 100,
    refraction: s.refraction * .56, dispersion: s.dispersion * .5,
    tint: s.tint, textColor: s.textColor, textOutline: s.textOutline, textOutlineWidth: s.textOutlineWidth, frameLimit: s.glassFps, compact: compactLayout(s) ? 1 : 0,
    topmost: s.alwaysOnTop ? 1 : 0, clickThrough: s.clickThrough ? 1 : 0,
    showLogo: s.showLogo === false ? 0 : 1, showBrandText: s.showBrandText === false ? 0 : 1,
    displayName:text(s.displayName),nameFontSize:s.nameFontSize||0,starsFontSize:s.starsFontSize||0,downloadsFontSize:s.downloadsFontSize||0,
    showProjectName:s.showProjectName===false?0:1,showOwner:s.showOwner===false?0:1,showStars:s.showStars===false?0:1,showDownloads:s.showDownloads===false?0:1,showDescription:s.showDescription===false?0:1,showTrend:s.showTrend===false?0:1,showMetadata:s.showMetadata===false?0:1,showFooter:s.showFooter===false?0:1,
    fps: 0, glassOnly: s.glassOnly ? 1 : 0,
    mini:s.mini?1:0,
    panelShape:s.panelShape??'auto',resizeEnabled:s.resizeEnabled?1:0,showTooltips:s.showTooltips?1:0,
    status: error || '',
  };
}
module.exports = { panelState };
