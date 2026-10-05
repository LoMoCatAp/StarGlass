const DEFAULTS = { repos: ['LoMoCatAp/Bika-HarmonyOS'], activeRepo: 0, settingsTheme: 'system', showLogo: true, showBrandText: true, textColor: 'dark', textOutline: 0, textOutlineWidth: 1, interval: 30, opacity: 32, gloss: 40, blur: 5, refraction:32, dispersion:8, glassFps:0, fontSize:14, fontWeight:600, displayName:'', nameFontSize:0, starsFontSize:0, downloadsFontSize:0, showProjectName:true, showOwner:true, showStars:true, showDownloads:true, showDescription:true, showTrend:true, showMetadata:true, showFooter:true, radius:28, glassOnly:false, tint: 'pearl', alwaysOnTop: false, clickThrough: false, autoStart: false, compact: false, mini: false, multiMini: false, visibleRepos: null, panelOverrides: {}, customSize: false, panelWidth: 440, panelHeight: 610, panelShape: 'auto', resizeEnabled: false, showTooltips: false, allowScreenCapture: true, material: 'liquid' };
function normalizeRepo(value) {
  const raw = String(value).trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d._-]{1,100}$/i.test(raw) || raw.endsWith('/.') || raw.endsWith('/..')) throw new Error('请输入 owner/repo 或完整的 GitHub 仓库链接');
  return raw;
}
function validateSettings(input,withOverrides=true) {
  const s = { ...DEFAULTS };
  s.repos = [...new Map((Array.isArray(input.repos) ? input.repos : DEFAULTS.repos).map(r => { const n = normalizeRepo(r); return [n.toLowerCase(), n]; })).values()];
  if (s.repos.length > 12) throw new Error('最多监控 12 个项目');
  // Index of the repo the panel shows; clamped so removing a repo cannot leave it
  // pointing past the end.
  const active = Number(input.activeRepo);
  s.activeRepo = Number.isInteger(active) ? Math.max(0, Math.min(s.repos.length - 1, Math.max(0, active))) : 0;
  for (const [key, lo, hi] of [['interval',15,1440],['opacity',0,90],['gloss',0,100],['blur',0,40],['refraction',0,100],['dispersion',0,100],['glassFps',0,360],['textOutline',0,100],['textOutlineWidth',.5,3],['fontSize',8,48],['fontWeight',400,800],['radius',0,100],['panelWidth',260,1200],['panelHeight',32,1200]]) s[key] = Math.min(hi, Math.max(lo, Number.isFinite(Number(input[key])) ? Number(input[key]) : DEFAULTS[key]));
  for (const key of ['alwaysOnTop','clickThrough','autoStart','compact','mini','multiMini','customSize','resizeEnabled','showTooltips','allowScreenCapture','glassOnly','showLogo','showBrandText','showProjectName','showOwner','showStars','showDownloads','showDescription','showTrend','showMetadata','showFooter']) s[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULTS[key];
  s.visibleRepos = require('./project-display.cjs').visibleRepos({...s,visibleRepos:input.visibleRepos});
  s.multiMini = s.visibleRepos.length > 1;
  if(s.visibleRepos.length&&!s.visibleRepos.includes(s.repos[s.activeRepo]))s.activeRepo=s.repos.indexOf(s.visibleRepos[0]);
  s.allowScreenCapture = true; // Migrate old capture exclusion / frozen-background settings.
  s.displayName=typeof input.displayName==='string'?input.displayName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,64):'';
  for(const [key,max]of [['nameFontSize',64],['starsFontSize',96],['downloadsFontSize',96]]){const v=Number(input[key]);s[key]=Number.isFinite(v)&&v>0?Math.round(Math.min(max,Math.max(8,v))):0;}
  s.tint = ['pearl','ocean','rose','graphite'].includes(input.tint) ? input.tint : 'pearl';
  s.panelShape = ['auto','rounded','pill','rectangle'].includes(input.panelShape)?input.panelShape:'auto';
  s.panelWidth=Math.round(s.panelWidth);s.panelHeight=Math.round(Math.max(require('./panel-layout.cjs').minimumPanelHeight(s),s.panelHeight));
  s.material = 'liquid'; // One renderer; old material names migrate to the same adjustable glass.
  s.textColor = ['auto','light','dark'].includes(input.textColor) ? input.textColor : DEFAULTS.textColor;
  s.settingsTheme = ['system','light','dark'].includes(input.settingsTheme) ? input.settingsTheme : 'system';
  s.glassFps = s.glassFps === 0 ? 0 : Math.max(15, Math.round(s.glassFps));
  s.panelOverrides={};
  if(withOverrides&&input.panelOverrides&&typeof input.panelOverrides==='object'){
    const keys=require('./panel-appearance.json');
    const known=new Set(s.repos.map(repo=>repo.toLowerCase()));
    for(const [repo,value]of Object.entries(input.panelOverrides).slice(0,12)){
      if(!known.has(repo.toLowerCase())||!value||typeof value!=='object')continue;
      const appearance=Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
      const validated=validateSettings({...s,...appearance},false);
      s.panelOverrides[repo.toLowerCase()]=Object.fromEntries(Object.keys(appearance).map(key=>[key,validated[key]]));
    }
  }
  return s;
}
class GitHubClient {
  constructor({ token = '', fetcher = fetch } = {}) { this.token = token; this.fetcher = fetcher; this.cache = new Map(); this.rate = null; this.blockedUntil = 0; }
  async get(path) {
    if (Date.now() < this.blockedUntil) throw new Error(`GitHub 请求额度暂不可用，${new Date(this.blockedUntil).toLocaleTimeString('zh-CN')} 后重试`);
    const cached = this.cache.get(path);
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'StarGlass/0.1' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    let response;
    try { response = await this.fetcher(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('无法连接 GitHub，请检查网络后重试'); }
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining !== null) this.rate = { remaining: Number(remaining), limit: Number(response.headers.get('x-ratelimit-limit')), reset: Number(response.headers.get('x-ratelimit-reset')) * 1000 };
    if (response.status === 304 && cached) return cached;
    if (!response.ok) {
      if (response.status === 404) throw new Error('仓库不存在，或 Token 没有访问权限');
      if (response.status === 401) throw new Error('GitHub Token 无效，请在设置中更新');
      if (response.status === 403 || response.status === 429) {
        this.blockedUntil = this.rate?.remaining === 0 ? this.rate.reset : Date.now() + (Number(response.headers.get('retry-after')) || 60) * 1000;
        throw new Error('GitHub 限流或访问受限，已暂停请求，请稍后重试');
      }
      throw new Error(`GitHub 返回错误 ${response.status}`);
    }
    const result = { data: await response.json(), etag: response.headers.get('etag'), next: /rel="next"/.test(response.headers.get('link') || '') };
    this.cache.set(path, result); return result;
  }
  async pages(path) {
    const all = [];
    for (let page = 1; page <= 1000; page++) {
      const result = await this.get(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(result.data)) throw new Error('GitHub 返回了异常数据');
      all.push(...result.data);
      if (!result.next) return all;
    }
    throw new Error('分页数量超出安全上限，未显示不完整的累计下载量');
  }
  async stats(repo) {
    repo = normalizeRepo(repo);
    const { data: info } = await this.get(`/repos/${repo}`);
    const releases = (await this.pages(`/repos/${repo}/releases`)).filter(r => !r.draft);
    let downloads = 0, assetsCount = 0;
    for (const release of releases) {
      // The embedded asset list may be truncated; the asset endpoint is paginated independently.
      const assets = await this.pages(`/repos/${repo}/releases/${release.id}/assets`);
      for (const asset of assets) downloads += Number(asset.download_count) || 0;
      assetsCount += assets.length;
    }
    const latest = [...releases].sort((a,b) => new Date(b.published_at) - new Date(a.published_at))[0];
    return { repo, name: info.name, description: info.description || '', stars: info.stargazers_count, forks: info.forks_count, downloads, assetsCount, releases: releases.length, version: latest?.tag_name || '暂无 Release', updatedAt: new Date().toISOString() };
  }
}
function addSample(history = [], stats, now = Date.now()) {
  const sample = { time: now, stars: stats.stars, downloads: stats.downloads };
  const next = [...history];
  if (next.length && now - next.at(-1).time < 15 * 60 * 1000) next[next.length - 1] = sample; else next.push(sample);
  return next.filter(p => p.time >= now - 90 * 86400000).slice(-8640);
}
module.exports = { DEFAULTS, normalizeRepo, validateSettings, GitHubClient, addSample };
