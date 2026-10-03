const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const {powershell,unsafeFile}=require('./native.cjs');
const {within,excluded}=require('./scope.cjs');
const {photoQuery}=require('./photos.cjs');

const websites = [
  ['YouTube', 'https://www.youtube.com'], ['Claude', 'https://claude.ai'],
  ['ChatGPT', 'https://chatgpt.com'], ['Gemini', 'https://gemini.google.com'],
  ['Gmail', 'https://mail.google.com'], ['Google', 'https://www.google.com']
];
const settingsLinks = [ ['Display settings','ms-settings:display'], ['Sound settings','ms-settings:sound'], ['Bluetooth','ms-settings:bluetooth'], ['Wi-Fi','ms-settings:network-wifi'], ['Windows Update','ms-settings:windowsupdate'], ['Storage','ms-settings:storagesense'], ['Personalization','ms-settings:personalization'] ];
const imageExtensions = new Set(['.jpg','.jpeg','.png','.webp','.avif','.gif','.tif','.tiff','.bmp','.heic']);

function score(title, query, usage) {
  const t = title.toLowerCase(), q = query.toLowerCase().trim();
  if (!q) return 0;
  let base = t === q ? 10000 : t.startsWith(q) ? 1800 : t.includes(q) ? 900 : 0;
  if (!base) {
    let at = 0, distance = 0, last = -1;
    for (const letter of q) { const next = t.indexOf(letter, at); if (next < 0) return 0; distance += last < 0 ? next : next-last-1; last = next; at = next+1; }
    base = Math.max(10, 350 - distance * 10 - t.length);
  }
  return base + Math.min(150, (usage?.count || 0) * 8) + (usage?.last > Date.now()-86400000 ? 40 : 0);
}

class Search {
  constructor(store, emit) { this.store = store; this.emit = emit; this.worker = null; this.status = { state: 'idle', count: 0, current: '' };this.watchers=[];this.nativeCache=new Map();this.nativeUnavailable=0; }
  put(item) { this.store.db.prepare('INSERT OR REPLACE INTO entries(id,title,path,kind,detail) VALUES(?,?,?,?,?)').run(item.id,item.title,item.path,item.kind,item.detail || ''); }
  async apps() {
    const roots = [path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs'), path.join(process.env.PROGRAMDATA || 'C:/ProgramData','Microsoft/Windows/Start Menu/Programs')];
    const walk = async dir => {
      let files; try { files = await fs.readdir(dir,{ withFileTypes: true }); } catch { return; }
      for (const file of files) { const p=path.join(dir,file.name); if(file.isDirectory()) await walk(p); else if(/\.(lnk|url)$/i.test(file.name)) this.put({id:'app:'+p,title:file.name.replace(/\.(lnk|url)$/i,''),path:p,kind:'app',detail:'Application'}); }
    };
    this.store.db.prepare("DELETE FROM entries WHERE kind IN ('app','web','setting')").run();
    await Promise.all(roots.map(walk));
    try{for(const item of await powershell('apps'))if(item.id.includes('!')&&/^[\w.\-!]+$/.test(item.id))this.put({id:'appx:'+item.id,title:item.title,path:'shell:AppsFolder\\'+item.id,kind:'app',detail:'Windows application'});}catch{}
    for(const [title,url] of websites) this.put({id:'web:'+url,title,path:url,kind:'web',detail:new URL(url).hostname});
    for(const [title,url] of settingsLinks) this.put({id:'setting:'+url,title,path:url,kind:'setting',detail:'Windows settings'});
    this.emit('index', this.status);
  }
  async bookmarks() {
    this.store.db.prepare("DELETE FROM entries WHERE kind='bookmark'").run();
    for (const [browser,root] of [['Chrome',path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data')],['Edge',path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/User Data')]]) {
      let profiles; try { profiles=await fs.readdir(root); } catch { continue; }
      for(const profile of profiles.filter(x=>x==='Default'||/^Profile \d+$/.test(x))) {
        try {
          const data=JSON.parse(await fs.readFile(path.join(root,profile,'Bookmarks'),'utf8'));
          const visit=node=>{ if(node.url && /^https?:\/\//i.test(node.url)) this.put({id:'bookmark:'+node.url,title:node.name,path:node.url,kind:'bookmark',detail:browser+' bookmark'}); for(const child of node.children||[]) visit(child); };
          for(const node of Object.values(data.roots||{})) visit(node);
        } catch { /* Missing or locked profiles are skipped. */ }
      }
    }
  }
  start() {
    if(this.worker) return;
    const settings=this.store.settings();
    if(!settings.roots.length) return;
    if(!this.watchers.length)for(const root of settings.roots){try{const watcher=require('node:fs').watch(root,{recursive:true},()=>{clearTimeout(this.changeTimer);this.changeTimer=setTimeout(()=>{if(!this.worker)this.start();else this.changed=true;},2000);});watcher.on('error',()=>{});this.watchers.push(watcher);}catch{}}
    this.status={state:'indexing',count:0,current:''}; this.emit('index',this.status);
    this.worker=new Worker(path.join(__dirname,'index-worker.cjs'),{workerData:{directory:this.store.directory,settings}});
    this.worker.on('message',status=>{this.status=status;this.emit('index',status);});
    this.worker.on('error',error=>{this.status={...this.status,state:'error',current:error.message};this.emit('index',this.status);});
    this.worker.on('exit',()=>{this.worker=null;if(this.changed){this.changed=false;this.start();}});
  }
  async stop() {clearTimeout(this.changeTimer);this.changed=false;this.watchers.forEach(x=>x.close());this.watchers=[];if(this.worker) { const worker=this.worker;this.worker=null;await worker.terminate(); } this.status={...this.status,state:'paused'}; this.emit('index',this.status); }
  async nativeQuery(q){
    const settings=this.store.settings();if(process.platform!=='win32'||!settings.roots.length||Date.now()<this.nativeUnavailable)return;
    const key=q.toLowerCase();if(this.nativeCache.get(key)>Date.now()-60000)return;this.nativeCache.set(key,Date.now());if(this.nativeCache.size>50)this.nativeCache.delete(this.nativeCache.keys().next().value);
    try{const items=await powershell('search',{query:q},1800);for(const item of items){if(!item.path||!settings.roots.some(root=>within(item.path,root))||excluded(item.path,settings.exclusions)||unsafeFile(item.path))continue;const stat=await fs.lstat(item.path);if(!stat.isFile()||stat.isSymbolicLink())continue;this.store.db.prepare('INSERT OR IGNORE INTO entries(id,title,path,kind,detail,modified,size) VALUES(?,?,?,?,?,?,?)').run('file:'+item.path,item.title,item.path,'file',path.dirname(item.path),stat.mtimeMs,stat.size);}}
    catch{this.nativeUnavailable=Date.now()+15*60000;}
  }
  query(raw, kind='all') {
    let q=raw.trim().replace(/^open\s+/i,'');
    const photo=photoQuery(q);if(photo){return this.store.db.prepare('SELECT e.id,e.title,e.path,e.kind,e.size,e.modified,p.taken FROM entries e LEFT JOIN photos p ON p.id=e.id WHERE e.kind=\'file\' AND COALESCE(p.taken,e.modified)>=? AND COALESCE(p.taken,e.modified)<? ORDER BY COALESCE(p.taken,e.modified) DESC').all(photo.start,photo.end).filter(item=>imageExtensions.has(path.extname(item.path).toLowerCase())).slice(0,30).map(item=>({...item,detail:(item.taken?'Date taken':'Modified date fallback')+' / '+new Date(item.taken||item.modified).toISOString().slice(0,10),score:1000}));}
    const drives=q.match(/^search drives? ([a-z](?:\s*(?:,|and)\s*[a-z])*) (?:drive )?for (.+)$/i);let letters=[];if(drives){letters=drives[1].match(/[a-z]/gi).map(x=>x.toLowerCase()+':');q=drives[2];kind='file';}
    if(!q) return [];
    const usage=new Map(this.store.db.prepare('SELECT * FROM usage').all().map(x=>[x.id,x]));
    const words=q.toLowerCase().split(/\s+/);
    let candidates=this.store.db.prepare(`SELECT id,title,path,kind,detail,modified,size FROM entries ${kind==='all' ? '' : 'WHERE kind=?'} LIMIT 150000`).all(...(kind==='all'?[]:[kind]));
    let results=candidates.map(item=>({...item,score:score(item.title,q,usage.get(item.id))})).filter(x=>x.score>0);
    if(q.length>=3 && (kind==='all'||kind==='file')) {
      const fts=words.map(w=>'"'+w.replace(/"/g,'""')+'"*').join(' AND ');
      try { for(const row of this.store.db.prepare('SELECT id,snippet(content_fts,2,\'\',\'\',\'...\',18) snippet FROM content_fts WHERE content_fts MATCH ? LIMIT 20').all(fts)) {
        const item=this.store.db.prepare('SELECT id,title,path,kind,detail,modified,size FROM entries WHERE id=?').get(row.id);
        if(item&&!results.some(x=>x.id===item.id)) results.push({...item,detail:row.snippet,score:500,contentMatch:true});
      } } catch { /* Invalid FTS input cannot interrupt filename search. */ }
    }
    if(letters.length)results=results.filter(x=>letters.includes(x.path.slice(0,2).toLowerCase()));
    return results.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,30);
  }
  count() { return this.store.db.prepare('SELECT count(*) count FROM entries').get().count; }
  get(id) { return this.store.db.prepare('SELECT * FROM entries WHERE id=?').get(id); }
}
function commonRoots() { return ['Desktop','Documents','Downloads','Pictures','Videos','Music'].map(x=>path.join(os.homedir(),x)); }
module.exports={Search,score,commonRoots,imageExtensions,websites};
