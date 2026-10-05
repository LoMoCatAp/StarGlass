const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRepo, validateSettings, GitHubClient, addSample } = require('../electron/core.cjs');
function reply(data, {status=200, next=false, etag=null, remaining=null}={}) { return { ok: status>=200&&status<300, status, json: async()=>data, headers: new Headers({...(next?{link:'<https://api.github.com/next>; rel="next"'}:{}),...(etag?{etag}:{}),...(remaining!==null?{'x-ratelimit-remaining':String(remaining),'x-ratelimit-reset':String(Math.ceil(Date.now()/1000)+100),'x-ratelimit-limit':'60'}:{})}) }; }
test('normalizes GitHub links and rejects arbitrary URLs and path traversal',()=>{
  assert.equal(normalizeRepo('https://github.com/LoMoCatAp/Bika-HarmonyOS/'),'LoMoCatAp/Bika-HarmonyOS');
  for(const bad of ['https://evil.com/a/b','a/b/c','a/..','../b','a/b?x=1']) assert.throws(()=>normalizeRepo(bad));
});
test('settings clamp values, deduplicate repos and preserve empty state',()=>{
  const s = validateSettings({repos:['A/repo','a/REPO'], interval:0, opacity:500, clickThrough:'yes'});
  assert.equal(s.repos.length,1);assert.equal(s.interval,15);assert.equal(s.opacity,90);assert.equal(s.clickThrough,false);
  assert.deepEqual(validateSettings({repos:[]}).repos,[]);
});
test('counts all release pages and all asset pages, skips drafts, includes prereleases',async()=>{
  const calls=[];
  const client=new GitHubClient({fetcher:async url=>{
    const p=new URL(url).pathname+new URL(url).search;calls.push(p);
    if(p==='/repos/a/b')return reply({name:'b',stargazers_count:123,forks_count:7});
    if(p==='/repos/a/b/releases?per_page=100&page=1')return reply([{id:1,tag_name:'v1',published_at:'2025-01-01'},{id:99,draft:true}],{next:true});
    if(p==='/repos/a/b/releases?per_page=100&page=2')return reply([{id:2,prerelease:true,tag_name:'v2',published_at:'2025-02-01'}]);
    if(p==='/repos/a/b/releases/1/assets?per_page=100&page=1')return reply([{download_count:20}],{next:true});
    if(p==='/repos/a/b/releases/1/assets?per_page=100&page=2')return reply([{download_count:30}]);
    if(p==='/repos/a/b/releases/2/assets?per_page=100&page=1')return reply([{download_count:40}]);
    throw Error(p);
  }});
  const result=await client.stats('a/b');assert.equal(result.downloads,90);assert.equal(result.releases,2);assert.equal(result.assetsCount,3);assert.equal(result.version,'v2');assert.equal(result.stars,123);assert.equal(calls.length,6);
});
test('304 reuses response and pagination metadata',async()=>{
  let count=0;const client=new GitHubClient({fetcher:async(_,options)=>{count++;if(count===1)return reply([1],{etag:'abc',next:true});assert.equal(options.headers['If-None-Match'],'abc');return reply(null,{status:304});}});
  await client.get('/x');assert.deepEqual(await client.get('/x'),{data:[1],etag:'abc',next:true});
});
test('rate limit blocks subsequent calls without retry storm',async()=>{
  let calls=0;const client=new GitHubClient({fetcher:async()=>{calls++;return reply(null,{status:403,remaining:0});}});
  await assert.rejects(()=>client.get('/x'),/限流/);await assert.rejects(()=>client.get('/y'),/额度/);assert.equal(calls,1);
});
test('partial asset failure never reports a misleading total',async()=>{
  const client=new GitHubClient({fetcher:async url=>url.endsWith('/a/b')?reply({}):url.includes('/assets')?reply(null,{status:500}):reply([{id:1}])});
  await assert.rejects(()=>client.stats('a/b'),/500/);
});
test('repository without releases has zero downloads',async()=>{
  const client=new GitHubClient({fetcher:async url=>reply(url.endsWith('/a/b')?{name:'b',stargazers_count:0,forks_count:0}:[])});
  const result=await client.stats('a/b');assert.equal(result.downloads,0);assert.equal(result.version,'暂无 Release');
});
test('history coalesces rapid refreshes and expires 90-day-old samples',()=>{
  const now=Date.now(); const history=[{time:now-100*86400000,stars:1,downloads:2},{time:now-5000,stars:4,downloads:5}];
  assert.deepEqual(addSample(history,{stars:7,downloads:8},now),[{time:now,stars:7,downloads:8}]);
  assert.equal(addSample([{time:now-3600000,stars:1,downloads:1}],{stars:2,downloads:2},now).length,2);
});
