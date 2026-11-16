/* Rebound: rendering, sound and interface. Runs after core.js, which defines DATA, RULES, AUG, WEAPONS and the rest.
   Sections: 1 setup and theme, 2 assets and sound, 3 flow between screens, 4 click and key handling, 5 side panel HTML, 6 canvas drawing, 7 main loop.
   All wording comes from DATA.text; all colours from DATA.theme; all art and sound slots from DATA.assets. */
(function(){
const $=s=>document.querySelector(s);
const H=1/120;                       // one simulation step, in seconds
const TX=DATA.text,TH=DATA.theme,AS=DATA.assets,OPT=AS.options||{};
const t=(k,vals)=>tpl(TX[k],vals);   // look up a line of interface text and fill its placeholders
/* G is the whole interface state. phase: title | prep | fight | payout | trophy | victory | over. */
const G={phase:'title',run:null,S:null,speed:1,paused:false,muted:false,best:0,pay:null,demo:null,demoWait:0,assetErrors:[],touched:false,
 hold:0,          // seconds of real time the fight stays frozen (impact frames)
 statsOpen:false, // is the live stats panel in the fight card expanded
 admin:false,     // is the Admin panel shown
 liveBase:null,
 holdR:0,         // time R was pressed, or 0
 sellArm:null,sellTimer:0,sellAt:0,   // the owned augment showing "Sell for $X?", its timeout, and when it was asked
 restartArmed:false,restartTimer:0,
 peek:null,       // stage (0, 1, 2) previewed in the shop
 view:'shop'};    // shop phase: 'shop' shows the shop in the arena box, 'arena' the warm-up       // stage (0, 1, 2) of a later fight in this tier being previewed in the shop, or null for the current one
const cv=$('#cv'),ctx=cv.getContext('2d'),side=$('#side'),left=$('#left'),shopview=$('#shopview'),viewtabs=$('#viewtabs'),overlay=$('#overlay'),chips=$('#chips');
const sysReduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);   // what the device asks for
let reduce=sysReduce;   // what the game does: false once the owner picks "play effects anyway" in the Admin panel
function setMotion(){reduce=sysReduce&&!G.forceMotion;document.documentElement.classList.toggle('force-motion',!!G.forceMotion)}
let parts=[],floats=[],rings=[],zaps=[],cracks=[],trail=[],shake=0,lastN=0,liveTick=0;

/* ---------- 1. setup and theme ---------- */
const FONT_D='"'+TH.fonts.display+'","Arial Black",sans-serif',FONT_B='"'+TH.fonts.body+'",system-ui,sans-serif';
const DFS=+TH.fonts.displayScale||1;   // scale of the title font on the arena canvas (HP, damage and overtime numbers): theme.fonts.displayScale
function applyTheme(){
 const st=document.documentElement.style;
 for(const k of Object.keys(TH.page))if(k[0]!=='_')st.setProperty('--'+k,TH.page[k]);
 st.setProperty('--felt',TH.arena.floor);
 // each rarity: --c<i> is its tint, --m<i>a/b/c its metal (highlight, main tone, shadow). A rarity with no "metal" gets one mixed from its color.
 DATA.rarities.forEach((r,i)=>{st.setProperty('--c'+i,r.color);
  const m=Array.isArray(r.metal)&&r.metal.length===3?r.metal:['color-mix(in srgb,'+r.color+' 45%,#fff)',r.color,'color-mix(in srgb,'+r.color+' 55%,#000)'];
  'abc'.split('').forEach((k,j)=>st.setProperty('--m'+i+k,m[j]))});
 st.setProperty('--display',FONT_D+',system-ui');st.setProperty('--body',FONT_B);
 st.setProperty('--dfs',DFS);if(+TH.fonts.displaySize)st.setProperty('--dpx',+TH.fonts.displaySize+'px');if(+TH.fonts.bodySize)st.setProperty('--bfs',+TH.fonts.bodySize+'px');
 loadFonts();
 const url=TH.fonts.googleFontsUrl;
 if(url&&/^https:\/\/fonts\.googleapis\.com\//.test(url)){const l=document.createElement('link');l.rel='stylesheet';l.href=url;document.head.appendChild(l)}
 const logo=$('#logo');
 const name=[TX.logoFirst,TX.logoSecond].filter(Boolean).join(' ');   // logoSecond is optional: drawn in the accent colour when set
 if(AS.images.logo)logo.innerHTML='<img class="logo-img" src="'+AS.images.logo+'" alt="'+name+'">';
 else logo.innerHTML='<i></i>'+TX.logoFirst+(TX.logoSecond?' <span>'+TX.logoSecond+'</span>':'');
 document.title=name;
 if(TH.pixelPanels!==false){pixelFrames();document.documentElement.classList.add('pxui')}
}
/* Pixel-art panels (theme.pixelPanels): every card, sheet, stat cell, readout bubble and shop box gets a frame drawn here in the theme's colours:
   a 1-pixel outline with stepped corners, a light inner edge on top and left and a dark one on bottom and right (swapped for sunken cells), and
   for raised boxes a 2-pixel drop shadow. Drawn 3 screen pixels per art pixel, like the card frames, and used as CSS border images (--pf-*;
   the slices are in the "pixel-art panels" section of style.css). */
function pixFrame(o){
 const S=3,pad=o.pad==null?2:o.pad,sh=o.shadow?2:0,e=2+pad,w=e*2+2,h=e*2+2+sh,bh=h-sh;
 const cv_=document.createElement('canvas');cv_.width=w*S;cv_.height=h*S;const g=cv_.getContext('2d');
 const body=(x,y)=>{if(x<0||y<0||x>=w||y>=bh)return false;const cx=Math.min(x,w-1-x),cy=Math.min(y,bh-1-y);return cx+cy>=2};   // stepped corners: the 3 corner pixels are cut
 const line=(x,y)=>body(x,y)&&(!body(x-1,y)||!body(x+1,y)||!body(x,y-1)||!body(x,y+1));
 const px=(x,y,col)=>{g.fillStyle=col;g.fillRect(x*S,y*S,S,S)};
 if(sh)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(body(x,y-sh)&&!body(x,y))px(x,y,o.drop||o.line);
 for(let y=0;y<bh;y++)for(let x=0;x<w;x++){if(!body(x,y))continue;
  if(line(x,y)){px(x,y,o.line);continue}
  const tl=line(x-1,y)||line(x,y-1),br=line(x+1,y)||line(x,y+1);
  px(x,y,tl?(o.inset?o.lo:o.hi):br?(o.inset?o.hi:o.lo):o.fill)}
 return'url('+cv_.toDataURL()+')';
}
const PXF={};   // which per-tune-up frames exist
/* Pixel-art buy buttons (part of theme.pixelPanels): a gold coin for the augment Buy button and a gold pill for the tune-up and item Buy buttons,
   each with a pressed copy (no drop shadow, sunk by it). 3 screen pixels per art pixel. Set as --pb-coin, --pb-coin-down, --pb-pill, --pb-pill-down;
   the CSS is in the "pixel buy buttons" sections of cards.css (coin) and style.css (pill). Colour: theme.page.gold. */
function pixShape(w,bh,inside,o){
 const S=3,sh=2,h=bh+sh,out={};
 for(const down of[0,1]){
  const cv_=document.createElement('canvas');cv_.width=w*S;cv_.height=h*S;const g=cv_.getContext('2d'),oy=down?sh:0;
  const body=(x,y)=>x>=0&&y>=0&&x<w&&y<bh&&inside(x,y);
  const line=(x,y)=>body(x,y)&&(!body(x-1,y)||!body(x+1,y)||!body(x,y-1)||!body(x,y+1));
  const px=(x,y,c)=>{g.fillStyle=c;g.fillRect(x*S,(y+oy)*S,S,S)};
  if(!down)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(body(x,y-sh)&&!body(x,y))px(x,y,o.line);
  for(let y=0;y<bh;y++)for(let x=0;x<w;x++){if(!body(x,y))continue;
   if(line(x,y)){px(x,y,o.line);continue}
   const tl=line(x-1,y)||line(x,y-1),br=line(x+1,y)||line(x,y+1),tl2=line(x-2,y)||line(x,y-2)||line(x-1,y-1);
   px(x,y,tl?o.hi:br?o.lo:(tl2&&o.hi2)?o.hi2:o.fill)}
  if(o.glint)for(const[x,y]of o.glint)if(body(x,y)&&!line(x,y))px(x,y,o.shine);
  out[down?'down':'up']='url('+cv_.toDataURL()+')'}
 return out;
}
function pixelButtons(){
 const P=TH.page,st=document.documentElement.style,c=P.gold;
 const o={fill:c,line:P.drop,hi:mixHex(c,'#ffffff',.55),hi2:mixHex(c,'#ffffff',.18),lo:mixHex(c,'#000000',.32),shine:'#ffffff'};
 const D=19,R=D/2-.05,coin=pixShape(D,D,(x,y)=>(x+.5-D/2)**2+(y+.5-D/2)**2<=R*R,Object.assign({glint:[[5,4],[4,5]]},o));
 st.setProperty('--pb-coin',coin.up);st.setProperty('--pb-coin-down',coin.down);
 const W=11,H=10,r=5,pill=pixShape(W,H,(x,y)=>{const cx=Math.min(Math.max(x+.5,r),W-r),cy=Math.min(Math.max(y+.5,r),H-r);return(x+.5-cx)**2+(y+.5-cy)**2<=r*r-.2},o);
 st.setProperty('--pb-pill',pill.up);st.setProperty('--pb-pill-down',pill.down);
}
function pixelFrames(){
 const P=TH.page,st=document.documentElement.style,lt=c=>mixHex(c,'#ffffff',.1),dk=c=>mixHex(c,'#000000',.3);
 const set=(k,o)=>st.setProperty('--pf-'+k,pixFrame(Object.assign({line:P.drop,hi:lt(o.fill),lo:dk(o.fill)},o)));
 set('card',{fill:P.panel,shadow:true});
 set('boss',{fill:mixHex(P.panel,'#5a2440',.35),shadow:true});
 set('sheet',{fill:P.panel,line:P.chalk,drop:P.drop,shadow:true});
 set('cell',{fill:P.ink,pad:1,inset:true,hi:mixHex(P.ink,'#ffffff',.06),lo:'#000000'});
 set('box',{fill:P.panel2,pad:1});
 set('item',{fill:'#1e3833',pad:1});
 set('btn',{fill:P.panel2,pad:1,shadow:true});
 set('pw',{fill:P.pow,pad:1,shadow:true});set('ml',{fill:P.mult,pad:1,shadow:true});set('dm',{fill:P.chalk,pad:1,shadow:true});
 set('bar',{fill:P.ink,pad:0,inset:true,lo:'#000000',hi:mixHex(P.ink,'#ffffff',.06)});
 for(const k of Object.keys(DATA.tuneUps)){const c=k[0]!=='_'&&DATA.tuneUps[k]&&DATA.tuneUps[k].color;if(c){set('tu-'+k,{fill:mixHex(P.panel2,c,TH.tuneHue==null?.14:TH.tuneHue),pad:1});PXF['tu-'+k]=1}}   // a faint hue per stat (theme.tuneHue, default 0.14)
 pixelButtons();
}
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('ricochet-rogue')||'{}');G.muted=!!p.muted;G.speed=[1,2,4,8].includes(p.speed)?p.speed:1;G.best=p.best||0;G.admin=!!p.admin;G.statsOpen=p.statsOpen!==false;G.forceMotion=!!p.forceMotion;G.bdOpen=p.bdOpen!==false;if(p.light==='simple'||p.light==='full'){G.lightChosen=true;lightMode=p.light}}catch(e){}setMotion()}
function savePrefs(){try{localStorage.setItem('ricochet-rogue',JSON.stringify({muted:G.muted,speed:G.speed,best:G.best,admin:G.admin,statsOpen:G.statsOpen,forceMotion:!!G.forceMotion,bdOpen:G.bdOpen!==false,light:G.lightChosen?lightMode:undefined}))}catch(e){}}

/* Font files (assets.fonts.display and .body), registered under the family names in theme.fonts. Optional font descriptors per role come from
   theme.fonts.displayMetrics and bodyMetrics (ascentOverride and so on: Pixel Game needs them to sit centred in its line). A file that fails falls back to
   the next font in the stack and is listed on the title screen. */
function loadFonts(){
 const F=AS.fonts||{};if(!window.FontFace||!document.fonts)return;
 for(const role of['display','body']){const src=F[role];if(!src||typeof src!=='string')continue;
  const m=TH.fonts[role+'Metrics']||{},d={};for(const k of Object.keys(m))if(k[0]!=='_')d[k]=m[k];
  try{const ff=new FontFace(TH.fonts[role],'url("'+encodeURI(src)+'")',d);document.fonts.add(ff);ff.load().then(()=>fixTips(),()=>assetFail(src))}catch(e){assetFail(src)}}
}

/* ---------- 2. assets and sound ---------- */
/* Images: IMG['ball.<id>'], IMG['weapon.<type>'], IMG['proj.player'|'proj.enemy'], IMG.floor. A missing or broken file falls back to code drawing. */
const IMG={};
function assetFail(src){if(!G.assetErrors.includes(src)){G.assetErrors.push(src);if(G.phase==='title')render()}}
function loadImg(key,src){if(!src||typeof src!=='string')return;const im=new Image();im.onload=()=>{IMG[key]=im};im.onerror=()=>assetFail(src);im.src=src}
function loadAssets(){
 const I=AS.images;
 for(const k of Object.keys(I.balls||{}))loadImg('ball.'+k,I.balls[k]);
 for(const k of Object.keys(I.weapons||{}))loadImg('weapon.'+k,I.weapons[k]);
 for(const k of Object.keys(I.projectiles||{}))loadImg('proj.'+k,I.projectiles[k]);
 loadImg('floor',I.arenaFloor);
 for(const k of Object.keys(AS.sounds||{})){const src=AS.sounds[k];if(!src||k[0]==='_')continue;const a=new Audio();a.preload='auto';a.addEventListener('error',()=>{delete SND[k];assetFail(src)});a.src=src;SND[k]=a}
}
/* A picture on a card failed. Redrawing the side panel while pictures are still loading can cancel a download and report a false error, so the file is
   tried once more on its own before it is listed as missing. */
document.addEventListener('error',e=>{const el=e.target;if(!el||el.tagName!=='IMG'||!el.classList.contains('icon'))return;const src=el.getAttribute('src');
 const t=new Image();t.onload=()=>{};t.onerror=()=>{assetFail(src);if(el.isConnected)el.remove()};t.src=src},true);
function icon(group,id){const m=AS.images.icons&&AS.images.icons[group],src=m&&m[id];return src?'<img class="icon" src="'+src+'" alt="">':''}

/* Sound: an uploaded file in DATA.assets.sounds wins; otherwise a short synthesised tone plays. */
const SND={};
let AC=null,musicEl=null,musicSrc=null;
function audioOn(){G.touched=true;if(G.muted)return;try{AC=AC||new(window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume()}catch(e){AC=null}syncMusic()}
function tone(f,d,type,v,slide,delay){if(!AC||G.muted)return;try{const t0=AC.currentTime+(delay||0),o=AC.createOscillator(),g=AC.createGain();o.type=type||'sine';o.frequency.setValueAtTime(f,t0);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t0+d);g.gain.setValueAtTime((v||.06)*clamp(OPT.sfxVolume==null?1:OPT.sfxVolume,0,1),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+d);o.connect(g);g.connect(AC.destination);o.start(t0);o.stop(t0+d+.02)}catch(e){}}
const SFX={
 wall:()=>tone(430+Math.random()*150,.05,'triangle',.05),clack:()=>tone(840+Math.random()*220,.04,'square',.03),
 hit:()=>tone(210,.09,'square',.05,95),crit:()=>tone(520,.13,'square',.06,1040),parry:()=>tone(1500+Math.random()*500,.06,'triangle',.045),
 pop:()=>tone(620,.12,'sine',.07,150),hurt:()=>tone(140,.12,'sawtooth',.05,70),zap:()=>tone(1800,.08,'sawtooth',.035,300),
 boom:()=>tone(110,.25,'sawtooth',.07,40),shot:()=>tone(900,.05,'triangle',.03,500),
 win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,.18,'triangle',.06,0,i*.09)),lose:()=>[392,330,262,196].forEach((f,i)=>tone(f,.22,'sawtooth',.05,0,i*.12)),
 bossdie:()=>{tone(90,.5,'sawtooth',.09,30);tone(660,.3,'triangle',.05,1320,.1)},coin:()=>tone(1320,.08,'square',.035,1760),deny:()=>tone(160,.1,'square',.04),
 impact:()=>{tone(65,.4,'sawtooth',.1,28);tone(1400,.07,'square',.05,180)},
 sell:()=>SFX.pop(),
 type:()=>tone(1500+Math.random()*400,.018,'square',.016),   // the post-fight recap typing out
};
function play(k){
 if(G.muted)return;
 const a=SND[k];
 if(a){try{const c=a.cloneNode();c.volume=clamp(OPT.sfxVolume==null?1:OPT.sfxVolume,0,1);const p=c.play();if(p&&p.catch)p.catch(()=>{})}catch(e){}return}
 if(SFX[k])SFX[k]();
}
/* Music follows the screen: title, shop, fight, boss. A missing track falls back to a neighbouring one, then to silence. */
function syncMusic(){
 const M=AS.music||{};let key=G.phase==='title'?'title':G.phase==='fight'?(G.run&&G.run.enc.boss?'boss':'fight'):'shop';
 let src=M[key]||(key==='boss'?M.fight:null)||(key==='title'?M.shop:null)||null;
 if(G.muted||!G.touched)src=null;
 if(src===musicSrc)return;
 if(musicEl){try{musicEl.pause()}catch(e){}musicEl=null}
 musicSrc=src;if(!src)return;
 try{musicEl=new Audio(src);musicEl.loop=true;musicEl.volume=clamp(OPT.musicVolume==null?.5:OPT.musicVolume,0,1);musicEl.addEventListener('error',()=>assetFail(src));const p=musicEl.play();if(p&&p.catch)p.catch(()=>{})}catch(e){}
}

/* ---------- helpers ---------- */
/* Numbers on screen. fmt: whole numbers, shortened from 1000 up (1.5k, 4.56M, 1.23e15; short() in core.js). num: one decimal for small values (stats, Power, Mult), shortened from 10,000. */
const fmt=n=>short(n);
const num=n=>{if(!(Math.abs(n)<1e4))return short(n);const r=Math.round(n*10)/10;return Number.isInteger(r)?''+r:r.toFixed(1)};
const lumCache={};
function dark(col){if(col in lumCache)return lumCache[col];const h=String(col).replace('#','');const r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);return lumCache[col]=(r*.299+g*.587+b*.114)<140}
function rgba(hex,a){const h=String(hex).replace('#','');return'rgba('+parseInt(h.substr(0,2),16)+','+parseInt(h.substr(2,2),16)+','+parseInt(h.substr(4,2),16)+','+a+')'}
const RC=i=>'c'+i;
function encSummary(enc){const m={};for(const id of enc.list){if(!ENEMY[id])continue;m[ENEMY[id].name]=(m[ENEMY[id].name]||0)+1}return Object.keys(m).map(k=>m[k]>1?k+' ×'+m[k]:k).join(', ')}
/* Planning lines on the next-fight card: what each enemy type does, an elite if there is one, and the next two bosses. */
function encNotes(enc){const seen=new Set(),out=[];for(const id of enc.list){const e=ENEMY[id];if(!e||seen.has(id)||!e.about)continue;seen.add(id);out.push(`<b>${e.name}</b>: ${rich(e.about)}`)}
 let h=out.length?`<p class="with">${out.join('<br>')}</p>`:'';
 if(enc.elite&&ENEMY[enc.list[enc.elite.i]])h=`<p class="rule elite-line">${tpl(TX.eliteLine||'Elite: {mod} {name}',{mod:(TX.eliteNames||{})[enc.elite.mod]||enc.elite.mod,name:ENEMY[enc.list[enc.elite.i]].name})}</p>`+h;
 return h}
function bossNotes(b){let h='';if(b.p2)h+=`<p class="with"><b>${TX.phase2Label||'At 50%:'}</b> ${rich(b.p2)}</p>`;
 const wk=b.weak.length?`<b>${TX.weakTo||'Weak to'}</b> ${rich(b.weak.join(', '))}`:'',rs=b.resists.length?`<b>${TX.resistsLabel||'Resists'}</b> ${rich(b.resists.join(', '))}`:'';
 if(wk||rs)h+=`<p class="with">${[wk,rs].filter(Boolean).join(' · ')}</p>`;return h}
function nextBosses(run){const out=[];for(let k=1;k<=2;k++){const id=run.bosses[run.tier-1+k];const b=id&&BOSS[id];if(b)out.push(`<span data-tip="${esc(b.rule+(b.p2?' '+(TX.phase2Label||'At 50%:')+' '+b.p2:''))}">${tpl(TX.tierShort||'T{tier}',{tier:run.tier+k})} ${b.name}</span>`)}
 return out.length?`<p class="with next-bosses"><b>${TX.nextBosses||'Coming up'}</b> ${out.join(' · ')}</p>`:''}
const stageName=st=>TX.stageNames[st];
const previewSeed=run=>({rs:run.rs^0x5bd1e995});
/* Colours keywords in card text (Power, Mult, Poison...) and money, the way item cards in most games do.
   Words and colours come from theme.keywordColors; hover hints (data-tip, shown by the hint bubble code) from the keywords glossary. Turn off with text.colorKeywords = false. */
const KW=TH.keywordColors||{},KDEF=DATA.keywords||{};
const kwWords=Object.keys(KW).filter(k=>k!=='money'&&k[0]!=='_').map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const kwRe=kwWords.length?new RegExp('((?:[+×-]\\s?)?\\d[\\d.]*%?\\s)?\\b('+kwWords.join('|')+')(s?)\\b|[+−-]?\\$\\d+(?:\\.\\d+)?','g'):null;
function kwRich(s){
 if(!kwRe||TX.colorKeywords===false)return s;
 return String(s).replace(kwRe,(m,n,word)=>{
  if(!word)return KW.money?'<b class="kw" style="color:'+KW.money+'">'+m+'</b>':m;
  const W=G.run&&WEAPONS[G.run.weapon],raw=word==='Ramp'&&W?tpl(TX.rampTip||'Your {weapon}: {ramp}.',{weapon:W.name,ramp:W.ramp}):KDEF[word]?tpl(KDEF[word]):'';   // Ramp: what your weapon's ramp does
  const def=raw.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return'<b class="kw" style="color:'+KW[word]+'"'+(def?' data-tip="'+def+'"':'')+'>'+m+'</b>'})
}
/* Trigger words (On hit:, On bounce:, Fight start:, Every 3 hits:...) and the word "tag" get a dotted underline and a hint from DATA.eventHints. */
const EVH=DATA.eventHints||{},evKeys=Object.keys(EVH).filter(k=>k[0]!=='_'&&k!=='Every'&&k!=='tag'),reEsc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const evRe=new RegExp([evKeys.length?'\\b(?:'+evKeys.map(reEsc).join('|')+')(?=:)':'',EVH.Every?'\\bEvery [^:.<]{1,24}(?=:)':'',EVH.tag?'\\btags?\\b':''].filter(Boolean).join('|')||'(?!)','g');
const evTip=m=>/^Every /.test(m)?EVH.Every:/^tags?$/.test(m)?EVH.tag:EVH[m]||'';
function rich(s){
 s=String(s);let out='',last=0,m;evRe.lastIndex=0;
 while((m=evRe.exec(s))){out+=kwRich(s.slice(last,m.index))+'<span class="hint" data-tip="'+esc(evTip(m[0]))+'">'+m[0]+'</span>';last=m.index+m[0].length}
 return out+kwRich(s.slice(last));
}

/* ---------- 3. flow between screens ---------- */
function startDemo(){
 const ws=Object.keys(WEAPONS),seed=(Math.random()*1e9)|0,run=newRun(ws[seed%ws.length],seed);
 const ids=Object.keys(AUG).filter(k=>AUG[k].rar<3);   // the demo ball gets Common, Uncommon and Rare only: no Epic or Legendary
 for(let i=0;i<3&&ids.length;i++)run.augs.push({id:ids[(rnd(run)*ids.length)|0],n:0,f:{}});
 run.tier=2;run.stage=1;run.enc=genEnc(run);run.tune.hp=3;
 G.demo=run;G.S=newFight(run,{juice:true});G.S.demo=true;clearFx();
}
function toTitle(){G.phase='title';G.run=null;G.peek=null;overlay.hidden=true;startDemo();render()}
/* The warm-up ball in the shop: the current fight, or the later fight being previewed (G.peek). */
function previewFight(){
 const run=G.run,pk=G.peek!=null&&G.peek!==run.stage?G.peek:null;
 G.S=newFight(pk==null?run:Object.assign({},run,{stage:pk,enc:encAt(run,pk)}),{preview:true,rsrc:previewSeed(run)});clearFx();
}
function begin(weapon){G.run=newRun(weapon,(Math.random()*2147483647)|0);audioOn();toPrep()}
function toPrep(){
 const run=G.run;overlay.hidden=true;
 G.phase=run.pending?'trophy':'prep';G.peek=null;G.view='shop';previewFight();render();
}
function startFight(){const run=G.run;G.peek=null;G.S=newFight(run,{juice:true});G.phase='fight';G.paused=false;lastN=0;clearFx();audioOn();render()}
function endFight(){
 const S=G.S,run=G.run;G.sheetId=(G.sheetId||0)+1;   // a new recap sheet: type it out once
 if(S.done==='win'){G.pay=payout(run,S);G.wasBoss=run.stage===2;G.lastBoss=run.enc.boss;G.finalWin=G.wasBoss&&run.tier===RULES.run.tiersToWin&&!run.endless;
  if(G.wasBoss&&run.tier>G.best&&!run.admin){G.best=run.tier;savePrefs()}
  advance(run);G.phase=G.finalWin?'victory':'payout';play('coin')}
 else{G.phase='over'}
 render();
}
function clearFx(){parts=[];floats=[];rings=[];zaps=[];cracks=[];trail=[];shake=0;G.hold=0;if(typeof shapeMem!=='undefined')shapeMem.clear();if(typeof Impact!=='undefined')Impact.stop()}

/* ---------- 4. click and key handling ---------- */
/* Every button carries data-act. One listener handles them all. */
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-act]');if(!b||b.disabled)return;
 const act=b.dataset.act,i=+b.dataset.i,run=G.run;let ok=true,refocus=null;   // refocus: a selector to focus after the redraw, so keyboard users keep their place
 switch(act){
  case'weapon':begin(b.dataset.w);return;
  case'fight':if(G.phase==='prep')startFight();return;
  case'view':G.view=b.dataset.v==='arena'?'arena':'shop';render();return;
  case'peek':if(G.phase!=='prep'||!run)return;{const k=+b.dataset.i;if(k<run.stage||k>2)return;G.peek=k===run.stage?null:k;previewFight();render();
   const el=$(G.peek==null?'.next [data-act="fight"]':'.next .step.sel');if(el)el.focus({preventScroll:true})}return;
  case'buy':ok=buyOffer(run,i);break;
  case'tune':ok=buyTune(run,i);break;
  case'item':ok=buyItem(run,i);break;
  case'item-use':ok=toggleItem(run,i);break;
  case'item-sell':ok=sellItem(run,i);break;
  case'reroll':ok=reroll(run);break;
  case'sell':{if(performance.now()-G.sellAt<350)return;   // too soon after asking: a long press or a key repeat, not a decision
   const r=b.getBoundingClientRect(),kb=document.activeElement===b;ok=sellAug(run,i);disarmSell();if(ok){sellFx(r.left+r.width/2,r.top+r.height/2);if(kb&&run.augs.length)refocus='#aug'+Math.min(i,run.augs.length-1)}break}
  case'up':ok=moveAug(run,i,-1);if(ok)refocus=i-1>0?'#aug'+(i-1)+' [data-act="up"]':'#aug'+(i-1);break;
  case'down':ok=moveAug(run,i,1);if(ok)refocus=i+1<run.augs.length-1?'#aug'+(i+1)+' [data-act="down"]':'#aug'+(i+1);break;
  case'continue':toPrep();return;
  case'endless':run.endless=true;toPrep();return;
  case'trophy':pickTrophy(run,b.dataset.id);play('coin');toPrep();return;
  case'title':toTitle();return;
  case'speed':G.speed=+b.dataset.v;savePrefs();renderCtl();{const n=$('#adm-note');if(n)n.textContent=impactNote()}return;
  case'pause':G.paused=!G.paused;renderCtl();return;
  case'light':lightMode=lightMode==='full'?'simple':'full';G.lightChosen=true;flashes=[];savePrefs();renderCtl();return;
  case'mute':G.muted=!G.muted;if(!G.muted)audioOn();else syncMusic();savePrefs();renderCtl();return;
  case'stats':{G.statsOpen=!G.statsOpen;savePrefs();const f=$('#livestats');if(f)f.classList.toggle('open',G.statsOpen);b.setAttribute('aria-expanded',G.statsOpen);return}
  case'admin':G.admin=!G.admin;savePrefs();render();return;
  case'restart':if(!run)return;if(G.restartArmed){doRestart();return}
   G.restartArmed=true;renderCtl();clearTimeout(G.restartTimer);G.restartTimer=setTimeout(()=>{G.restartArmed=false;renderCtl()},2600);return;
  case'restart-now':doRestart();return;
  case'adm-motion':G.forceMotion=!G.forceMotion;savePrefs();setMotion();render();return;
  case'adm-reset':if(run){run.override=null;applyAdmin();render()}return;
  case'adm-gold':if(run){run.gold+=50;run.admin=true;render()}return;
  case'adm-win':if(G.phase==='fight'&&G.S&&!G.S.done){run.admin=true;for(const q of G.S.balls)if(q.team===1)q.alive=false;G.S.done='win'}return;
  case'adm-impact':{const l=(IMPCFG.levels||[])[i],p=G.S&&G.S.player;if(l){audioOn();Impact.trigger({level:l,x:p?p.x:AW/2,y:p?p.y:AH/2},true);const n=$('#adm-note');if(n)n.textContent=impactNote()}return}
 }
 audioOn();if(!(ok&&act==='sell'))play(ok?'coin':'deny');
 if(ok&&G.phase==='prep'&&(act==='buy'||act==='tune'||act==='sell'))refreshPreview();
 render();
 if(refocus){const el=$(refocus);if(el)el.focus({preventScroll:true})}
});
document.addEventListener('keydown',e=>{
 if(e.target.closest('input,textarea'))return;
 // a focused owned card in the shop: Delete or Backspace asks to sell, and again (or Enter on the button) confirms; Escape cancels
 const card=G.phase==='prep'&&e.target.closest('li.aug[data-drag]');
 if(card){
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(e.repeat)return;if(e.target.id==='sellq')e.target.click();else armSell(+card.dataset.drag);return}
  if(e.key==='Escape'&&G.sellArm){disarmSell();card.focus({preventScroll:true});return}
  if((e.key===' '||e.key==='Enter')&&e.target===card){e.preventDefault();return}   // not a way to start the fight by accident
 }
 if(e.key===' '||e.key==='Enter'){if(e.target.closest('button'))return;const b=document.querySelector('[data-primary]');if(b){e.preventDefault();b.click()}}
 else if('1234'.includes(e.key)){G.speed=[1,2,4,8][+e.key-1];savePrefs();renderCtl()}
 else if(e.key==='p'||e.key==='P'){G.paused=!G.paused;renderCtl()}
 else if((e.key==='r'||e.key==='R')&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&G.run&&!G.holdR)G.holdR=performance.now();
});

/* ---------- 5. side panel HTML ---------- */
function augRow(a,i,run,mode){
 const d=AUG[a.id];if(!d)return'';
 const off=G.S&&(G.S.off?G.S.off.has(a):G.S.disabled===a)&&G.phase!=='payout',warn=mode==='prep'&&i===0&&run.enc.boss&&BOSS[run.enc.boss]&&BOSS[run.enc.boss].code.disablesTopAugment;
 const shadow=a.id==='mirror'&&a.sh&&AUG[a.sh.id]?a.sh:null,idef=shadow?AUG[shadow.id]:d,info=idef.info?idef.info(shadow||a,idef.v):'';
 let copy='';if(a.id==='mirror'){const nb=run.augs[i+1];copy=nb&&nb.id!=='mirror'&&AUG[nb.id]?t('mirrorCopying',{name:AUG[nb.id].name}):TX.mirrorNothing}
 const prep=mode==='prep',price=prep?sellValue(run,a.id):0,asking=prep&&G.sellArm===a;
 return augCard({id:a.id,kind:'owned',i,tag:'li',cls:(off?' off':'')+(asking?' arming':''),
  attrs:` id="aug${i}"`+(prep?` data-drag="${i}" tabindex="0" aria-keyshortcuts="Delete"`:''),
  badge:`<span class="ord">${i+1}</span>`,
  lead:prep?`<span class="grip" data-tip="${esc(TX.dragHint||'Drag to reorder')}" aria-hidden="true"></span>`:'',
  notes:[info,copy,off?TX.nullOff:'',warn?TX.nullWarn:''].filter(Boolean).map(s=>`<em>${s}</em>`).join(''),
  tipExtra:prep?esc(tpl(TX.sellTip||'Sells for ${gold}',{gold:price})):'',
  foot:prep?`<span class="aug-a">
   <button data-act="up" data-i="${i}" ${i===0?'disabled':''} aria-label="Move ${d.name} up">▲</button>
   <button data-act="down" data-i="${i}" ${i===run.augs.length-1?'disabled':''} aria-label="Move ${d.name} down">▼</button></span>`
   +(asking?`<button class="sellq" id="sellq" data-act="sell" data-i="${i}">${tpl(TX.sellConfirm||'Sell for ${gold}?',{gold:price})}</button>`:''):''});
}
function augList(run,mode){
 let h=`<section class="card sockets">${mode==='prep'&&run.augs.length?sellBin():''}<h3>${TX.augmentsTitle} <span>${t('augmentsHint',{used:run.augs.length,slots:run.slots})}</span></h3><ol class="augs">`;
 run.augs.forEach((a,i)=>h+=augRow(a,i,run,mode));
 for(let i=run.augs.length;i<run.slots;i++)h+=`<li class="aug empty"><span class="ord">${i+1}</span> ${TX.emptySocket}</li>`;
 h+='</ol>';
 const tr=run.trophies.filter(id=>TROPHY[id]);
 if(tr.length)h+=`<div class="trophies">${tr.map(id=>`<span data-tip="${esc(TROPHY[id].desc)}">${icon('trophies',id)}${TROPHY[id].name}</span>`).join('')}</div>`;
 return h+'</section>';
}
/* Power x Mult on one row and Last hit under it, below the ball stats on the left (filled by liveDom during a fight). */
function readoutHtml(){const S=G.S,L=G.phase==='fight'&&S&&!S.preview&&S.last;
 return `<div class="readout${G.phase==='fight'?'':' idle'}" id="readout" aria-live="off"><div class="ro pw"><small>${TX.readoutPower}</small><b id="roP">${L?num(L.p):'–'}</b></div><i>×</i><div class="ro ml"><small>${TX.readoutMult}</small><b id="roM">${L?'×'+num(L.m):'–'}</b></div><div class="ro dm"><small>${TX.readoutLast}</small><b id="roD">${L?fmt(L.d)+(L.c?'!':''):'–'}</b></div></div>`}
/* A stat's cap, shown after its value ("/760", or "no cap" after a cap Legendary). */
function capTxt(run,k){const u=run.uncap&&run.uncap[k],c=capOf(run,k);return `<i class="cap">${u?(TX.noCap||'no cap'):'/'+c+(k==='armor'?'%':'')}</i>`}   // no hint (owner's call)
const NX=()=>TX.statNamesExtra||{};
/* Tag counts (shown while you own Specialist or Tag Team): how many of your augments carry each tag; the most common is highlighted. */
function tagTracker(run){if(!run.augs.some(a=>a.id==='specialist'||a.id==='tagteam'))return'';const n={};for(const a of run.augs){const d=AUG[a.id];if(d)for(const g of d.tags)n[g]=(n[g]||0)+1}
 const ks=Object.keys(n).sort((a,b)=>n[b]-n[a]);if(!ks.length)return'';const top=n[ks[0]];
 return `<p class="tracker"><b class="hint" data-tip="${esc(TX.tagTip||'')}">${TX.tagsTitle||'Tags'}</b>${ks.map(k=>`<span class="${n[k]===top?'top':''}">${k} <em>${n[k]}</em></span>`).join('')}</p>`}
/* Event counts this fight (shown while you own an augment that counts them: Singularity, Eight-Ball Rack, Kinetic Battery). */
const TRACK={singularity:['hits','bounces','crits','collisions','kills'],rack:['collisions'],battery:['bounces']};
function trackKeys(run){const s=new Set();for(const a of run.augs)for(const k of TRACK[a.id]||[])s.add(k);return['hits','bounces','crits','collisions','kills'].filter(k=>s.has(k))}
function statBlock(run){
 const P=calcPlayer(run,null),W=P.W,N=TX.statNames,X=NX();
 const row=(k,v,cap)=>`<div><dt>${k}</dt><dd>${v}${cap?capTxt(run,cap):''}</dd></div>`;
 const volley=W.type==='bow'||P.projExtra>0||run.augs.some(a=>a.id==='sidearm');
 return `<section class="card" id="yourball"><h3>${TX.yourBall} <span>${W.name}${P.blades>1&&!W.fist?' ×'+P.blades:''}</span></h3>
  <p class="ramp"><b class="hint" data-tip="${esc(tpl(TX.rampTip||'',{weapon:W.name,ramp:W.ramp}))}">${TX.rampLabel}</b> ${rich(W.ramp)}${P.rampX>1?' (×'+num(P.rampX)+')':''}. ${TX.rampResets}</p>
  <dl class="stats">${row(N.hp,P.hp)}${row(N.power,num(P.pow))}<div data-tip="${esc(TX.multTip||'')}"><dt>${N.mult}</dt><dd>×${num(shopMult(run))}</dd></div>${row(N.crit,Math.round(P.crit*100)+'%')}
  ${row(N.speed,Math.round(P.spd),'spd')}${W.fist?'':row(N.spin,num(P.spin),'spin')+row(N.reach,Math.round(P.reach))+row(X.blades||'Blades',P.blades,'blades')}${volley?row(X.volley||'Volley',1+P.projExtra,'volley'):''}${row(N.armor,num(P.armor),'armor')}${row(N.regen,num(P.regen)+'/s')}${W.fist?'':row(N.knock||'Knockback',Math.round(P.kb))}${row(N.impact||'Impact',Math.round(P.impact))}</dl>${tagTracker(run)}</section>`;
}
/* The next-fight card. Its tracker shows the tier's three fights (two circles and a diamond). In the shop, the current fight and the ones still ahead are
   buttons: pressing one previews that fight here and in the warm-up (G.peek), and the Fight button becomes "Jump to current". */
function nextCard(run,mode){
 const shop=mode==='prep',pk=shop&&G.peek!=null&&G.peek!==run.stage?G.peek:null,st=pk!=null?pk:run.stage;
 const enc=pk!=null?encAt(run,pk):run.enc,b=enc.boss&&BOSS[enc.boss];
 const steps=[0,1,2].map(i=>{
  const cls='step'+(i<run.stage?' done':i===run.stage?' now':' ahead')+(i===2?' boss':'')+(i===st?' sel':''),lbl=stageName(i);
  if(!shop||i<run.stage)return `<span class="${cls}"><i></i><span>${lbl}</span></span>`;
  const tip=i===run.stage?TX.previewCurrentTip||'Current fight':TX.previewTip||'Preview this fight';
  return `<button class="${cls}" data-act="peek" data-i="${i}" aria-pressed="${i===st}" data-tip="${esc(tip)}"><i></i><span>${lbl}</span></button>`}).join('<b class="step-line" aria-hidden="true"></b>');
 if(mode==='fight')return `<section class="card next compact${b?' is-boss':''}"><div class="head"><h2>${b?b.name:encSummary(enc)}</h2><div class="steps">${steps}</div></div>${b?`<p class="rule">${rich(b.rule)}</p>`:''}</section>`;   // fight: one thin row
 let h=`<section class="card next${b?' is-boss':''}${pk!=null?' peeking':''}"><div class="eyebrow"><span>${TX.chipTier} ${run.tier}${run.endless?' · '+TX.endless:''}</span>${pk!=null?`<span class="peek-tag">${TX.previewTag||'Preview'}</span>`:''}</div>
  <div class="steps">${steps}</div>`;
 if(b)h+=`<h2>${b.name}</h2><p class="rule">${rich(b.rule)}</p>${bossNotes(b)}${enc.list.length?`<p class="with">${TX.bossBrings} ${encSummary(enc)}.</p>`:''}`;
 else h+=`<h2>${encSummary(enc)}</h2>${encNotes(enc)}`;
 h+=nextBosses(run);
 if(shop&&(run.bag||[]).length)h+=`<div class="bag"><b>${tpl(TX.bagTitle||'Items {n}/{max}',{n:run.bag.length,max:CONS.bagSize})}</b> <span class="with">${TX.bagHint||'Switch on to use in the next fight.'}</span><div class="row">${run.bag.map((x,i)=>{const d=ITEM[x.id];return d?`<button data-act="item-use" data-i="${i}" aria-pressed="${!!x.use}" data-tip="${esc((TX.consumableTag||'Consumable')+': '+d.desc+' '+tpl(TX.itemSellTip||'Right-click: sell for ${gold}',{gold:Math.floor(d.cost/2)}))}">${icon('items',x.id)}${d.name}</button>`:''}).join('')}</div></div>`;
 if(shop)h+=pk!=null?`<button class="go back" data-act="peek" data-i="${run.stage}" data-primary>${TX.jumpToCurrent||'Jump to current'}</button>`:`<button class="go" data-act="fight" data-primary>${TX.fightButton}</button>`;
 return h+'</section>';
}
function shopCard(run){
 const sh=run.shop,full=run.augs.length>=run.slots,E=RULES.economy;
 let h=`<section class="card shop"><div class="shop-h"><h3>${TX.shopTitle} <b class="money">$${run.gold}</b></h3><button class="reroll" data-act="reroll" ${run.gold<sh.reroll?'disabled':''}>${TX.reroll} <b>$${sh.reroll}</b></button></div><div class="offers">`;   // reroll in the top right corner
 sh.offers.forEach((o,i)=>{const d=AUG[o.id];if(!d)return;const c=augCost(run,o.id);
  h+=augCard({id:o.id,kind:'offer',i,tag:'div',cls:o.sold?' sold':'',
   foot:`<button class="buy" data-act="buy" data-i="${i}" ${o.sold||full||run.gold<c?'disabled':''}>${o.sold?`<small>${TX.sold}</small>`:full?`<small>${TX.noSocket}</small>`:`<small>${TX.buy}</small><b>$${c}</b>`}</button>`})});
 h+='</div><div class="tunes">';
 sh.tunes.forEach((tu,i)=>{const d=TUNE[tu.k],c=tuneCost(run,tu.k);
  h+=`<div class="tune${tu.sold?' sold':''}${d.cap?' cap':''}" data-tilt="flat"${tuneStyle(tu.k)}><i class="tu-fx" aria-hidden="true"></i>${icon('tuneUps',tu.k)}<div><b>${d.name}</b><span>${tuneText(tu.k)}${TX.tuneUpSuffix}</span></div><button class="buy" data-act="tune" data-i="${i}" ${tu.sold||run.gold<c?'disabled':''}>${tu.sold?TX.sold:'$'+c}</button></div>`});
 h+='</div>';
 if(sh.items&&sh.items.length){const full=(run.bag||[]).length>=CONS.bagSize;h+=`<div class="tunes items">`;
  sh.items.forEach((o,i)=>{const d=ITEM[o.id];if(!d)return;h+=`<div class="tune${o.sold?' sold':''}" data-tilt="flat"><i class="tu-fx" aria-hidden="true"></i>${icon('items',o.id)}<div><b>${d.name}<em class="ctag" data-tip="${esc(TX.consumableTip||'')}">${TX.consumableTag||'Consumable'}</em></b><span>${rich(d.desc)}</span></div><button class="buy" data-act="item" data-i="${i}" ${o.sold||full||run.gold<d.cost?'disabled':''}>${o.sold?TX.sold:full?(TX.bagFull||'Bag full'):'$'+d.cost}</button></div>`});h+='</div>'}
 const int=Math.min(run.intCap,Math.floor(run.gold/E.interestPerGold));
 h+=`<div class="shop-f"><span class="interest">${t('shopInterest',{per:E.interestPerGold,cap:run.intCap,now:int})}</span></div></section>`;
 return h;
}
/* Tune-up text: the stat word gets its colour and a hover hint. Glossary keywords (Power, Crit...) already get both from rich(); the rest (Max HP,
   Speed, Spin, HP/s, the cap tune-ups' "max ..." words) use the tune-up's own "stat", "color" and "tip" in the data. */
function tuneText(k){
 const d=DATA.tuneUps[k]||{},s=TUNE[k].desc,st=d.stat;
 if(!st||KW[st])return rich(s);
 const m=new RegExp('((?:[+×-]\\s?)?\\d[\\d.]*%?\\s)?'+st.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')).exec(s);
 if(!m)return rich(s);
 return rich(s.slice(0,m.index))+`<b class="kw" style="color:${d.color||'inherit'}"${d.tip?` data-tip="${esc(d.tip)}"`:''}>${m[0]}</b>`+rich(s.slice(m.index+m[0].length));
}
/* Each tune-up box takes a faint hue of its stat's colour (data "color"): the pixel frame drawn for it by pixelFrames(), or a tinted background without pixel panels. */
function tuneStyle(k){const c=(DATA.tuneUps[k]||{}).color;return c?` style="--tu:${c}${PXF['tu-'+k]?';border-image-source:var(--pf-tu-'+k+')':''}"`:''}
/* Title screen: the rules and glossary on the left, New run and the weapons on the right. */
function titleLeft(){return `<section class="card how"><h3>${TX.howTitle}</h3><p>${rich(TX.howBody)}</p><dl class="gloss">${Object.keys(KDEF).filter(k=>k[0]!=='_').map(k=>`<div><dt${KW[k]?' style="color:'+KW[k]+'"':''}>${k}</dt><dd>${tpl(KDEF[k])}</dd></div>`).join('')}</dl></section>`}
function titlePanel(){
 let h=`<section class="card hero"><h1>${TX.heroHeadline}</h1>${TX.heroBody?`<p>${t('heroBody',{tiers:RULES.run.tiersToWin})}</p>`:''}
  ${G.best?`<p class="best">${t('bestRun',{tier:G.best})}</p>`:''}</section>`;
 if(G.assetErrors.length)h+=`<section class="card warn"><h3>Some files did not load</h3><p>The game is using its built-in look for these. Check the paths in game-data.json:</p><ul>${G.assetErrors.map(s=>`<li>${s}</li>`).join('')}</ul></section>`;
 h+=`<section class="card"><h3>${TX.pickWeapon} <span>${TX.pickWeaponHint}</span></h3><div class="weapons">`;
 for(const k of Object.keys(WEAPONS)){const w=WEAPONS[k];
  h+=`<button class="weapon" data-act="weapon" data-w="${k}">${icon('weapons',k)}<b>${w.name}</b><span class="wstat">${TX.statNames.power} ${w.pow}${w.fist?'':' · '+TX.statNames.spin+' '+w.spin}${w.kb?' · '+(TX.statNames.knock||'Knockback')+' '+w.kb:''}${w.impact?' · '+(TX.statNames.impact||'Impact')+' '+w.impact:''}</span><span>${w.blurb}</span><span class="wramp">${TX.rampLabel}: ${w.ramp}</span></button>`}
 h+=`</div></section>`;
 return h;
}
/* In a fight: your ball (HP, ramp, live stats, trackers) on the left; the fight card and augments on the right. */
function fightBall(run){
 const S=G.S,N=TX.statNames,tk=trackKeys(run),caps={speed:'spd',spin:'spin'};
 return `<section class="card ballcard"><h3>${TX.yourBall} <span>${S.P.W.name}</span>
   <button class="fold-btn" data-act="stats" aria-expanded="${G.statsOpen}" aria-controls="livestats">${TX.statsToggle||'Stats'}<i></i></button></h3>
  <div class="hpbar"><i id="hpfill"></i><b id="hptxt"></b></div><p class="ramp" id="rampline"></p>
  <div class="fold${G.statsOpen?' open':''}" id="livestats"><div><dl class="stats livegrid">${LIVE.filter(l=>!(S.P.W.fist&&(l[0]==='spin'||l[0]==='reach'))).map(l=>`<div id="ls-${l[0]}"><dt>${N[l[0]]}</dt><dd><b>–</b>${caps[l[0]]?capTxt(run,caps[l[0]]):''}<small></small></dd></div>`).join('')}</dl></div></div>
  ${tk.length?`<p class="tracker" id="evtrack"><b>${TX.eventsTitle||'This fight'}</b>${tk.map(k=>`<span data-ev="${k}">${(TX.eventNames||{})[k]||k} <em>0</em></span>`).join('')}</p>`:''}${tagTracker(run)}</section>`;
}
function fightPanel(run){return nextCard(run,'fight')+adminCard(run)+augList(run,'fight')}
function renderCtl(){
 $('#speed').innerHTML=[1,2,4,8].map(v=>`<button data-act="speed" data-v="${v}" aria-pressed="${G.speed===v}">${v}×</button>`).join('');
 $('#pause').textContent=G.paused?TX.resume:TX.pause;$('#pause').setAttribute('aria-pressed',G.paused);
 $('#mute').textContent=G.muted?TX.soundOff:TX.soundOn;
 {const lb=$('#light');if(lb){lb.textContent=lightMode==='full'?(TX.lightFull||'Lighting: Full'):(TX.lightSimple||'Lighting: Simple');lb.setAttribute('aria-pressed',lightMode==='full')}}$('#mute').setAttribute('aria-pressed',!G.muted);
 const rb=$('#restart');if(rb){rb.hidden=!G.run;rb.classList.toggle('armed',!!G.restartArmed);rb.setAttribute('data-tip',TX.restartHint||'Hold R to restart');$('#restart-label').textContent=G.restartArmed?(TX.restartConfirm||'Restart run?'):(TX.restart||'Restart')}
 const ab=$('#admin');if(ab){ab.hidden=!!(DATA.admin&&DATA.admin.showToggle===false);ab.textContent=TX.adminButton||'Admin';ab.setAttribute('aria-pressed',G.admin)}
}
function renderChips(){
 const run=G.run;
 chips.innerHTML=run?`<span>${TX.chipTier} <b>${run.tier}</b></span><span>${stageName(run.stage)}</span><span class="gold">$<b id="goldchip">${run.gold}</b></span>`:`<span>${TX.chipDemo}</span>`;
}
function renderOverlay(){
 const run=G.run;let h='';
 if(G.phase==='payout'||G.phase==='victory'){
  const p=G.pay,bn=G.lastBoss&&BOSS[G.lastBoss]?BOSS[G.lastBoss].name:'';
  h=`<div class="sheet"><div class="eyebrow">${G.phase==='victory'?TX.victoryEyebrow:G.wasBoss?TX.payBossBeaten:TX.payFightWon}</div>
   <h2>${G.phase==='victory'?t('victoryTitle',{boss:bn}):TX.payoutTitle}</h2>
   <ul class="pay">${p.lines.map(l=>`<li><span>${l[0]}</span><b>+$${l[1]}</b></li>`).join('')}<li class="tot"><span>${TX.payoutTotal}</span><b>+$${p.total}</b></li></ul>`;
  h+=breakdown(G.S,run);
  if(G.phase==='victory')h+=runStats(run)+`<div class="row"><button class="go" data-act="endless" data-primary>${TX.keepGoing}</button><button data-act="title">${TX.newRun}</button></div>`;
  else h+=`<button class="go" data-act="continue" data-primary>${run.pending?TX.pickTrophyButton:TX.toShop}</button>`;
  h+='</div>';
 }else if(G.phase==='trophy'){
  h=`<div class="sheet"><div class="eyebrow">${t('trophyEyebrow',{hp:RULES.player.hpPerBossBeaten})}</div><h2>${TX.trophyTitle}</h2><div class="trophy-pick">${run.pending.map(id=>`<button data-act="trophy" data-id="${id}">${icon('trophies',id)}<b>${TROPHY[id].name}</b><span>${rich(TROPHY[id].desc)}</span></button>`).join('')}</div></div>`;
 }else if(G.phase==='over'){
  const b=run.enc.boss&&BOSS[run.enc.boss];
  h=`<div class="sheet"><div class="eyebrow">${TX.overEyebrow}</div><h2>${b?t('overTitleBoss',{tier:run.tier,boss:b.name}):t('overTitle',{tier:run.tier})}</h2>${runStats(run,G.S)}${breakdown(G.S,run)}<div class="row"><button class="go" data-act="restart-now" data-primary>${TX.restart||'Restart'}</button><button data-act="title">${TX.newRun}</button></div></div>`;
 }
 if(typer)typer.cancel();
 overlay.innerHTML=h;overlay.hidden=!h;
 if(h&&G.sheetId&&G.sheetId!==G.typedId){G.typedId=G.sheetId;typeSheet()}
}
/* Damage breakdown after a fight (payout, victory and game over). core.js records, for every point of damage, who dealt it (S.dmgBy 'src:' and 'aug:')
   and how much each boost added to the hits it touched ('boost:'), plus how often each augment triggered (S.trig). Boosts overlap, so the
   "Added by" column can add up to more than the total. Owned augments that neither dealt nor added damage are listed at the end. */
function breakdown(S,run){
 if(!S||!S.dmgBy||!(S.dmg>0))return'';
 const N=TX.sourceNames||{},W=WEAPONS[run.weapon],B=S.dmgBy,T=S.trig||{},total=S.dmg;
 const name=k=>{const [g,id]=k.split(':');if(g==='aug'||g==='boost'){const d=AUG[id]||TROPHY[id]||ITEM[id];if(d)return d.name}
  if(id==='weapon'||(id==='body'&&W.fist)||(id==='proj'&&W.type==='bow'))return W.name;return N[id]||id};
 const idOf=k=>k.split(':')[1],trig=k=>{const n=T[idOf(k)];return n?' · '+tpl(TX.breakdownTriggered||'{n}×',{n}):''};
 const rows=(keys,plus)=>keys.map(k=>{const v=B[k],w=Math.min(100,v/total*100);
  return`<li style="--w:${w.toFixed(1)}%"><span>${name(k)}<small>${trig(k)}</small></span><b>${plus?'+':''}${fmt(v)}${plus?'':`<small> ${Math.round(w)}%</small>`}</b></li>`}).join('');
 const keys=Object.keys(B).filter(k=>B[k]>=.5),dealt=keys.filter(k=>!k.startsWith('boost:')).sort((a,b)=>B[b]-B[a]),added=keys.filter(k=>k.startsWith('boost:')).sort((a,b)=>B[b]-B[a]);
 const LG=(S.P&&S.P.log)||{},X=NX(),SN=TX.statNames;
 const statName={hp:SN.hp,pow:SN.power,mult:SN.mult,crit:SN.crit,critMult:X.critMult||'Crit multiplier',spd:SN.speed,spin:SN.spin,reach:SN.reach,armor:SN.armor,regen:SN.regen,kb:SN.knock||'Knockback',impact:SN.impact||'Impact',blades:X.blades||'Blades',size:X.size||'Size',projExtra:X.volley||'Volley',projBounce:X.projBounce||'Projectile bounces',bounceX:X.bounceX||'Bounce count',rampX:SN.ramp||TX.rampLabel||'Ramp',poisonX:X.poisonX||'Poison damage',burnX:X.burnX||'Burn damage',frozenX:X.frozenX||'Damage to Frozen'};
 const sv=(k,v)=>k==='crit'?(v>0?'+':'')+Math.round(v*100)+'%':k==='regen'?(v>0?'+':'')+num(v)+'/s':(v>0?'+':'')+num(v);
 const statLines=Object.keys(LG).map(id=>{const L=LG[id],parts=[];for(const k in L){const v=L[k];if(k.startsWith('inc.')){const s=k.slice(4);parts.push((v>0?'+':'')+Math.round(v*100)+'% '+(statName[s]||s))}else if(k.startsWith('more.')){const s=k.slice(5);parts.push('×'+num(v)+' '+(statName[s]||s))}else parts.push(sv(k,v)+' '+(statName[k]||k))}
  const d=AUG[id]||TROPHY[id]||ITEM[id];return parts.length?`<li><span>${d?d.name:id}</span><b class="st">${parts.join(', ')}</b></li>`:''}).join('');   // what each source added to your stats this fight
 const seen=new Set(keys.map(idOf).concat(Object.keys(LG))),rest=[...new Set(run.augs.map(a=>a.id))].filter(id=>AUG[id]&&!seen.has(id)).map(id=>AUG[id].name+(T[id]?' ('+tpl(TX.breakdownTriggered||'{n}×',{n:T[id]})+')':''));
 return`<details class="bd" id="bd"${G.bdOpen!==false?' open':''}><summary>${TX.breakdownTitle||'Damage breakdown'} <b>${fmt(total)}</b></summary>
  <h4>${TX.breakdownDealt||'Dealt by'}</h4><ul class="pay">${rows(dealt,false)}</ul>
  ${added.length?`<h4 data-tip="${esc(TX.breakdownAddedTip||'')}">${TX.breakdownAdded||'Added by'}</h4><ul class="pay">${rows(added,true)}</ul>`:''}
  ${statLines?`<h4>${TX.statsAdded||'Stats added'}</h4><ul class="pay statlist">${statLines}</ul>`:''}
  ${rest.length?`<p class="bd-rest">${TX.breakdownOther||'No damage counted'}: ${rest.join(', ')}</p>`:''}</details>`;
}
document.addEventListener('toggle',e=>{if(e.target&&e.target.id==='bd'){G.bdOpen=e.target.open;savePrefs()}},true);
/* The recap sheet types itself out (payout, victory, game over): lines appear one by one, letters tick in with a soft click, gold amounts chime
   when they finish, and the breakdown bars grow as their row appears. Any mouse click (except on a button) shows everything at once. Typing speeds up with the game speed (1x to 8x). Settings:
   rules.feel.typewriter (enabled, charsPerSecond, soundEvery). Off for reduced motion. The title, buttons and a closed breakdown are not typed. */
const TW=Object.assign({enabled:true,charsPerSecond:140,soundEvery:3},RULES.feel.typewriter||{});
let typer=null;
function typeSheet(){
 const sh=overlay.querySelector('.sheet');if(!sh||reduce||TW.enabled===false)return;
 const nodes=[],walk=document.createTreeWalker(sh,NodeFilter.SHOW_TEXT,{acceptNode:n=>{const el=n.parentElement;if(!n.nodeValue.trim()||el.closest('button,h2,.eyebrow'))return NodeFilter.FILTER_REJECT;
  const d=el.closest('details');return d&&!d.open&&!el.closest('summary')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});
 for(let n;n=walk.nextNode();)nodes.push({n,t:n.nodeValue,row:n.parentElement.closest('li,dl>div,summary,p,h4')});
 if(!nodes.length)return;
 const rows=new Set(nodes.map(x=>x.row).filter(Boolean));rows.forEach(r=>r.classList.add('tw-hide'));nodes.forEach(x=>x.n.nodeValue='');
 let i=0,c=0,acc=0,count=0,last=performance.now(),raf=0;
 const stop=()=>{cancelAnimationFrame(raf);document.removeEventListener('pointerdown',skip,true);typer=null};
 const finish=()=>{stop();nodes.forEach(x=>x.n.nodeValue=x.t);rows.forEach(r=>r.classList.remove('tw-hide'))};
 const skip=e=>{if(!(e.target.closest&&e.target.closest('button,summary')))finish()};   // any click except a button shows it all
 const tick=now=>{acc+=Math.min(.1,(now-last)/1000)*TW.charsPerSecond*(TW.scaleWithSpeed===false?1:G.speed);last=now;   // faster at 2x, 4x, 8x game speed
  while(acc>=1&&i<nodes.length){const x=nodes[i];if(x.row)x.row.classList.remove('tw-hide');c++;x.n.nodeValue=x.t.slice(0,c);acc--;
   if(++count%TW.soundEvery===0&&x.t[c-1]!==' ')play('type');
   if(c>=x.t.length){if(/^\+\$/.test(x.t.trim()))play('coin');i++;c=0}}
  if(i>=nodes.length){finish();return}raf=requestAnimationFrame(tick)};
 document.addEventListener('pointerdown',skip,true);raf=requestAnimationFrame(tick);typer={finish,cancel:stop};
}
function runStats(run,S){
 const s=run.stats,best=Math.max(s.bestHit,S?S.bestHit:0),kills=s.kills+(S?S.kills:0);
 return `<dl class="stats wide"><div><dt>${TX.statFights}</dt><dd>${s.fights}</dd></div><div><dt>${TX.statKills}</dt><dd>${kills}</dd></div><div><dt>${TX.statBestHit}</dt><dd>${fmt(best)}</dd></div><div><dt>${TX.statWeapon}</dt><dd>${WEAPONS[run.weapon].name}</dd></div></dl>`;
}
/* Rebuilds the side panel, header chips and overlay for the current phase. Call after any state change. */
function render(){
 const run=G.run,keep=side.scrollTop,keepL=left.scrollTop,keepV=shopview.scrollTop,ph=G.phase;
 document.body.dataset.phase=ph;
 let L='',R='';
 if(ph==='title'){L=titleLeft();R=titlePanel()}
 else if(ph==='prep'){L=statBlock(run)+readoutHtml();R=nextCard(run,'prep')+adminCard(run)+augList(run,'prep')}
 else if(ph==='trophy'){L=statBlock(run)+readoutHtml();R=nextCard(run,'x')+augList(run,'x')}
 else{L=fightBall(run)+readoutHtml();R=fightPanel(run)}
 left.innerHTML=L;side.innerHTML=R;
 /* Shop phase: the shop and the warm-up share the arena box, switched with the tabs above it (G.view); the shop comes first. */
 const prep=ph==='prep';viewtabs.hidden=!prep;shopview.innerHTML=prep?shopCard(run):'';shopview.hidden=!prep||G.view==='arena';
 if(prep)viewtabs.innerHTML=[['shop',TX.viewShop||'Shop'],['arena',TX.viewArena||'Warm-up']].map(([v,l])=>`<button data-act="view" data-v="${v}" aria-pressed="${(G.view==='arena'?'arena':'shop')===v}">${l}</button>`).join('');
 side.scrollTop=keep;left.scrollTop=keepL;shopview.scrollTop=keepV;fit();
 renderChips();renderCtl();renderOverlay();syncMusic();fixTips();
}

/* ---------- augment cards, hint bubbles and card tilt ---------- */
/* THE ONE PLACE that builds an augment card. Shop offers and owned sockets both come from augCard(); the look is in cards.css.
   To restyle, edit cards.css. To change the layout, edit the markup here. These hooks must survive any redesign, because features attach to them:
     .acard and data-tilt        hover lift, 3D tilt and the pointer shine (below)
     .c0 to .c4                  rarity; cards.css reads its tint as --rc and its metal as --ma --mb --mc
     id="aug<i>"                 an owned socket; gets class "on" for a moment when the augment triggers in a fight
     id="lv<i>"                  the live counter shown during fights
     data-drag="<i>" and .grip   drag to reorder or to sell in the shop; tabindex makes the card focusable for the Delete key
     buttons with data-act       buy, up, down, and sell (the "Sell for $X?" confirm)
     .ac-clip                    text that may be cut short; fixTips() gives it the full wording as a hint
   o = {id, kind:'owned'|'offer', i, tag, cls, attrs, badge, lead, notes, foot, tipExtra}:
   badge sits on the art circle, lead goes at the left of the plate, notes (each an <em>) follow the tags and are never the part that gets cut short, foot is the button area, tipExtra is added to the card's hint. */
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
/* Measurements of the frame pictures (assets.cardFrameLayout, in picture pixels), handed to cards.css in screen pixels.
   96 is the card height in cards.css. --fsln and --fsrn stay in picture pixels because border-image-slice needs them that way. */
const FRAME_VARS=(()=>{
 const L=AS.cardFrameLayout||{},k=96/(L.pictureHeight||192),px=n=>+(L[n]*k).toFixed(2)+'px',v=[];
 const map={sliceLeft:'fsl',sliceRight:'fsr',artX:'fax',artY:'fay',artSize:'fas',plateLeft:'fpl',plateTop:'fpt',endCenter:'fec'};
 for(const n in map)if(typeof L[n]==='number'){v.push('--'+map[n]+':'+px(n));if(n==='sliceLeft'||n==='sliceRight')v.push('--'+map[n]+'n:'+L[n])}
 return v.join(';');
})();
function augCard(o){
 const d=AUG[o.id];if(!d)return'';
 const rn=RAR[d.rar],frame=(AS.images.cardFrames||{})[rn],owned=o.kind==='owned',x=o.tipExtra||'';
 return `<${o.tag} class="acard ${owned?'aug':'offer'} ${RC(d.rar)}${frame?' framed':''}${o.cls||''}" data-tilt${o.attrs||''}${frame?` style="--card-frame:url('${esc(frame)}');${FRAME_VARS}"`:''}>
  ${frame?'<span class="ac-frame" aria-hidden="true"></span>':''}<span class="ac-fx" aria-hidden="true"></span>
  <div class="ac-art"${x?` data-tip="${x}"`:''}><i class="ac-glyph" aria-hidden="true">${esc(d.name.charAt(0))}</i>${icon('augments',o.id)}${o.badge||''}</div>
  <div class="ac-plate">${o.lead||''}<div class="ac-body">
   <div class="aug-h"><b class="ac-name">${d.name}</b>${owned?`<span class="live" id="lv${o.i}"></span>`:''}</div>
   <p class="ac-text ac-clip"${x?` data-tip-extra="${x}"`:''}>${rich(d.desc)}</p>
   <div class="tags ac-clip"><span class="tg" data-tip="${esc(TX.tagTip||'')}">${rn} · ${d.tags.join(' · ')}</span>${o.notes||''}</div>
  </div>${o.foot||''}</div></${o.tag}>`;
}
/* Text that did not fit on a card (class ac-clip) gets its full wording as a hint, followed by data-tip-extra. Runs after the side panel is rebuilt or resized. */
function fixTips(){
 for(const el of document.querySelectorAll('#side .ac-clip,#shopview .ac-clip,#left .ac-clip')){
  const cut=el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1,extra=el.getAttribute('data-tip-extra')||'';
  const tip=(cut?el.textContent.trim().replace(/\s+/g,' ')+(extra?' ':''):'')+extra;
  if(tip)el.setAttribute('data-tip',tip);else el.removeAttribute('data-tip')}
}
window.addEventListener('resize',fixTips);
/* The needle that owned augments are dragged onto to sell them. Art slots: assets.images.sellBin.idle and .armed; the drawn needle is the fallback. */
const NEEDLE='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M35.2 10.2 37.8 12.8 8 41.6 6 42 6.4 40z" fill="currentColor"/><ellipse cx="39.2" cy="8.8" rx="5" ry="3" transform="rotate(-45 39.2 8.8)" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M43.5 5.5c2.5 6-1 11.500-6.500 13.500" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".55"/></svg>';
function sellBin(){
 const B=AS.images.sellBin||{},img=(src,cls)=>src?`<img class="icon ${cls}" src="${esc(src)}" alt="">`:'';
 return `<div class="sellbin" id="sellbin" data-tip="${esc(TX.sellBinTip||'Drag an augment here to sell')}">${img(B.armed,'bin-armed')}${img(B.idle,'bin-idle')}${NEEDLE}<b id="sellbin-price"></b></div>`;
}

/* Hint bubble: any element with data-tip shows that text on hover or tap. Used for keyword definitions and trophies. */
const tipEl=$('#tip');let tipOn=null;
function hideTip(){if(tipOn){tipOn=null;if(tipEl)tipEl.hidden=true}}
function showTip(el){
 const txt=el.getAttribute('data-tip');if(!txt||!tipEl){hideTip();return}
 tipEl.textContent=txt;tipEl.hidden=false;tipOn=el;
 const r=el.getBoundingClientRect(),w=tipEl.offsetWidth,h=tipEl.offsetHeight;
 let y=r.top-h-8;if(y<6)y=r.bottom+8;
 tipEl.style.left=clamp(r.left+r.width/2-w/2,6,Math.max(6,window.innerWidth-w-6))+'px';tipEl.style.top=y+'px';
}
document.addEventListener('pointerover',e=>{if((drag&&drag.on)||G.sellArm){hideTip();return}const el=e.target.closest?e.target.closest('[data-tip]'):null;if(el){if(el!==tipOn)showTip(el)}else hideTip()});
document.addEventListener('pointerdown',e=>{if(!(e.target.closest&&e.target.closest('[data-tip]')))hideTip()});
document.addEventListener('scroll',hideTip,true);
setInterval(()=>{if(tipOn&&!tipOn.isConnected)hideTip()},300);   // the hinted element was redrawn away

/* Card hover. Any element with data-tilt gets class "tilting" and the pointer position as --mx/--my (in px, on a 3 px grid) (cards.css uses them for the shine) while the pointer is on it.
   It also lifts a little and leans away under the pointer, as if pressed there, unless tilt is off or the device asks for reduced motion. Numbers: rules.feel.cardTilt. */
const TILT=Object.assign({enabled:true,maxDegrees:6,lift:4,scale:1.02},RULES.feel.cardTilt||{});
let tiltEl=null;
function tiltOff(keepTransform){if(tiltEl){tiltEl.classList.remove('tilting');if(!keepTransform)tiltEl.style.transform='';tiltEl=null}}
document.addEventListener('pointermove',e=>{
 if(tiltEl&&!tiltEl.isConnected)tiltEl=null;   // the screen was redrawn under the pointer
 if(drag&&drag.on){tiltOff(tiltEl===drag.row);return}   // a card being dragged keeps the transform the drag code gave it
 if(e.pointerType==='touch'){tiltOff();return}
 // stay on the current card while the pointer is inside its resting box, so the lift cannot push the card out from under the pointer
 const b=tiltEl&&tiltEl._box,inside=b&&e.clientX>=b.left&&e.clientX<=b.right&&e.clientY>=b.top&&e.clientY<=b.bottom;
 const el=inside?tiltEl:(e.target.closest?e.target.closest('[data-tilt]'):null);
 if(el!==tiltEl){tiltOff();tiltEl=el;if(el){el.style.transform='';el._box=el.getBoundingClientRect();el.classList.add('tilting')}}
 if(!el)return;
 const r=el._box,fx=clamp((e.clientX-r.left)/r.width,0,1),fy=clamp((e.clientY-r.top)/r.height,0,1),px=fx-.5,py=fy-.5,m=TILT.maxDegrees*2;
 el.style.setProperty('--mx',Math.round(fx*r.width/3)*3+'px');el.style.setProperty('--my',Math.round(fy*r.height/3)*3+'px');   // snapped to the 3 px grid of the pixel-art frames
 if(el.dataset.tilt==='flat'){el.style.transform=reduce?'':'translateY(-'+(TILT.flatLift||3)+'px)';return}   // shop tune-up and item boxes: lift by whole pixels only, no lean or scale, so pixel text stays sharp
 if(TILT.enabled&&!reduce)el.style.transform='perspective(800px) translateY(-'+TILT.lift+'px) rotateX('+(-py*m).toFixed(2)+'deg) rotateY('+(px*m*Math.min(1,r.height/r.width*2.5)).toFixed(2)+'deg) scale('+TILT.scale+')';
});
document.documentElement.addEventListener('pointerleave',()=>tiltOff());
window.addEventListener('blur',()=>tiltOff());
document.addEventListener('scroll',()=>tiltOff(),true);

/* ---------- restart and drag to reorder ---------- */
/* Restart: ends the run and goes back to the character select screen. The header button asks once more before it acts; holding R does it without asking. */
const HOLD_R=(RULES.feel.restartHoldSeconds||.7)*1000;
function doRestart(){
 if(!G.run)return;
 G.restartArmed=false;G.holdR=0;clearTimeout(G.restartTimer);
 toTitle();   // back to the character select screen
}
/* Called every frame: fills the Restart button while R is held and restarts when the hold completes. */
function holdTick(now){
 const fill=$('#restart-fill');if(!fill)return;
 let p=0;
 if(G.holdR){if(!G.run){G.holdR=0}else{p=clamp((now-G.holdR)/HOLD_R,0,1);if(p>=1){doRestart();p=0}}}
 const w=(p*100).toFixed(0)+'%';if(fill.style.width!==w)fill.style.width=w;
}
document.addEventListener('keyup',e=>{if(e.key==='r'||e.key==='R')G.holdR=0});
window.addEventListener('blur',()=>{G.holdR=0});

/* Dragging owned augments in the shop: to another socket to reorder, or onto the needle to sell. With a mouse, drag a card anywhere. On touch, drag the grip.
   The arrow buttons stay for keyboards. */
let drag=null,press=null;
const HOLD_SELL=(RULES.feel.sellHoldSeconds||.5)*1000,SELL_MS=(RULES.feel.sellConfirmSeconds||2.6)*1000;
const dragRows=()=>[...document.querySelectorAll('li.aug[data-drag]')];
const refreshPreview=()=>previewFight();   // a changed loadout changes the warm-up ball too
function endPress(){if(press){clearTimeout(press.t);press=null}}
document.addEventListener('pointerdown',e=>{
 if(G.sellArm&&!(e.target.closest&&e.target.closest('#sellq')))disarmSell();
 if(G.phase!=='prep'||e.button>0)return;
 const row=e.target.closest('li.aug[data-drag]');if(!row||e.target.closest('button'))return;
 if(e.pointerType!=='mouse'&&!e.target.closest('.grip')){   // touch away from the grip: a long press asks to sell
  endPress();const i=+row.dataset.drag;press={id:e.pointerId,x:e.clientX,y:e.clientY,t:setTimeout(()=>{press=null;armSell(i)},HOLD_SELL)};return}
 drag={i:+row.dataset.drag,row,x0:e.clientX,y0:e.clientY,on:false,id:e.pointerId,to:null,sell:false};
});
document.addEventListener('pointermove',e=>{
 if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)endPress();
 if(!drag||e.pointerId!==drag.id)return;
 const dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;
 if(!drag.on){if(Math.hypot(dx,dy)<6)return;drag.on=true;drag.row.classList.add('dragging');document.body.classList.add('drag-active');hideTip()}
 e.preventDefault();
 // over the needle (with a little slack): armed to sell
 const bin=$('#sellbin');let over=false;
 if(bin){const b=bin.getBoundingClientRect(),m=16;over=e.clientX>=b.left-m&&e.clientX<=b.right+m&&e.clientY>=b.top-m&&e.clientY<=b.bottom+m}
 if(over!==drag.sell){drag.sell=over;bin.classList.toggle('armed',over);drag.row.classList.toggle('selling',over);
  const a=G.run.augs[drag.i],p=$('#sellbin-price');if(p&&a)p.textContent='+$'+sellValue(G.run,a.id)}
 drag.row.style.transform='translate('+dx+'px,'+dy+'px)'+(over?' rotate(-5deg) scale(.86)':'');
 // otherwise the new socket is the number of other rows whose middle is above the pointer
 const others=dragRows().filter(r=>r!==drag.row);let to=0;
 for(const r of others){const b=r.getBoundingClientRect();if(e.clientY>b.top+b.height/2)to++}
 drag.to=over?null:to;
 for(const r of others)r.classList.remove('drop-above','drop-below');
 if(!over&&to!==drag.i&&others.length){if(to<others.length)others[to].classList.add('drop-above');else others[others.length-1].classList.add('drop-below')}
},{passive:false});
function endDrag(e,cancel){
 endPress();
 if(!drag||(e&&e.pointerId!==drag.id))return;
 const d=drag,bin=$('#sellbin');drag=null;document.body.classList.remove('drag-active');
 if(d.on&&!cancel&&d.sell){const r=(bin||d.row).getBoundingClientRect();
  if(sellAug(G.run,d.i)){sellFx(r.left+r.width/2,r.top+r.height/2);refreshPreview();render();return}}
 if(d.on&&!cancel&&d.to!=null&&moveAugTo(G.run,d.i,d.to)){audioOn();play('coin');render();return}
 d.row.classList.remove('dragging','selling');d.row.style.transform='';if(bin)bin.classList.remove('armed');for(const r of dragRows())r.classList.remove('drop-above','drop-below');
}
document.addEventListener('pointerup',e=>endDrag(e,false));
document.addEventListener('pointercancel',e=>endDrag(e,true));

/* Selling without dragging: right-click, long press (touch) or Delete on an owned card asks "Sell for $X?" on the card. Pressing that button within a few
   seconds sells; anything else cancels. Same two-step idea as the Restart button. G.sellArm is the augment being asked about. */
function armSell(i){
 const run=G.run;if(G.phase!=='prep'||!run||!run.augs[i]||(drag&&drag.on))return;
 G.sellArm=run.augs[i];G.sellAt=performance.now();clearTimeout(G.sellTimer);
 G.sellTimer=setTimeout(()=>{const q=$('#sellq'),c=q&&q.closest('.acard'),had=q&&document.activeElement===q;disarmSell();if(had&&c)c.focus({preventScroll:true})},SELL_MS);
 hideTip();render();const q=$('#sellq');if(q)q.focus({preventScroll:true});
}
function disarmSell(){
 G.sellArm=null;clearTimeout(G.sellTimer);
 const q=$('#sellq');if(q){const c=q.closest('.acard');q.remove();if(c)c.classList.remove('arming')}   // no redraw here: a click may be in progress
}
document.addEventListener('contextmenu',e=>{   // right-click an item in the bag: sell it for half
 const it=e.target.closest&&e.target.closest('[data-act="item-use"]');if(it&&G.phase==='prep'&&G.run){e.preventDefault();if(sellItem(G.run,+it.dataset.i)){const r=it.getBoundingClientRect();sellFx(r.left+r.width/2,r.top+r.height/2);render()}return}
});
document.addEventListener('contextmenu',e=>{
 const row=e.target.closest&&e.target.closest('li.aug[data-drag]');if(!row||G.phase!=='prep')return;
 e.preventDefault();endPress();armSell(+row.dataset.drag);
});
/* The pop when an augment is sold: sound (assets.sounds.sell, else the pop) and a small burst at x,y on the page. */
function sellFx(x,y){
 audioOn();play('sell');
 if(reduce||!document.body.animate)return;
 for(let i=0;i<12;i++){const s=document.createElement('i'),a=Math.random()*TAU,d=24+Math.random()*36;
  s.className='popbit';s.style.left=x+'px';s.style.top=y+'px';s.style.background=i%3?TH.page.gold:TH.page.chalk;document.body.appendChild(s);
  s.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:'translate(calc(-50% + '+(Math.cos(a)*d).toFixed(1)+'px),calc(-50% + '+(Math.sin(a)*d).toFixed(1)+'px)) scale(.2)',opacity:0}],{duration:430,easing:'cubic-bezier(.1,.7,.3,1)'}).onfinish=()=>s.remove()}
}

/* ---------- impact frames ---------- */
/* A big hit freezes the fight for a moment and plays a short visual "style" on the arena.
   core.js only reports the hit as an event {k:'impact', pct, x, y, dmg, crit}. Everything about how it looks is here and in DATA.impact.
   Real hits are skipped on devices that ask for reduced motion (unless impact.respectReducedMotion is false), above impact.maxSpeed, and when too close together.
   Levels and styles are data. A style names a renderer; 'frames' is the built-in one and covers CSS filters, an overlay colour, zoom and shake.
   For a more stylised look later (speed lines, an image, a custom drawing), add a renderer to Impact.renderers with
     update(a, ms) -> true while still running,  end(a),  and optionally draw(ctx, a) to paint on the canvas each frame,
   then set "renderer" on a style in the data. a = {ev, lvl, style, t0}. Nothing else needs to change. */
const IMPCFG=DATA.impact||{enabled:false},fxLayer=$('#impactfx');
const Impact={
 active:null,lastAt:-1e9,last:null,
 renderers:{
  frames:{
   update(a,ms){let t=ms;for(const f of a.style.frames||[]){if(t<f.ms){
     cv.style.filter=f.filter||'';
     cv.style.transformOrigin=(a.ev.x/AW*100)+'% '+(a.ev.y/AH*100)+'%';cv.style.transform=f.zoom&&f.zoom!==1?'scale('+f.zoom+')':'';
     if(fxLayer){fxLayer.style.background=f.overlay||'transparent';fxLayer.style.opacity=f.overlay?(f.overlayOpacity==null?1:f.overlayOpacity):0}
     if(f.shake)shake=Math.max(shake,f.shake);return true}t-=f.ms}return false},
   end(){cv.style.filter='';cv.style.transform='';if(fxLayer)fxLayer.style.opacity=0}
  }
 },
 /* The highest level whose threshold the hit reaches, or null. */
 levelFor(pct){let best=null;for(const l of IMPCFG.levels||[])if(pct>=l.minPercentOfMaxHp&&(!best||l.minPercentOfMaxHp>best.minPercentOfMaxHp))best=l;return best},
 /* Starts an impact frame. Returns false when it is skipped, and records why in Impact.last. force (Admin test buttons) skips the reduced-motion, speed and spacing checks. */
 trigger(ev,force){
  const pc=ev.pct!=null?' ('+Math.round(ev.pct)+'% of the strongest enemy)':'';
  const skip=why=>{this.last={ok:false,why:why+pc};return false};   // Impact.last feeds the status line in the Admin panel
  if(IMPCFG.enabled===false)return skip('impact frames are switched off in game-data.json');
  const lvl=ev.level||this.levelFor(ev.pct);if(!lvl)return skip('the hit was below every level');
  const now=performance.now();
  if(!force){
   if(reduce&&IMPCFG.respectReducedMotion!==false)return skip('this device asks for reduced motion');
   if(G.speed>(IMPCFG.maxSpeed||4))return skip('speed is above '+(IMPCFG.maxSpeed||4)+'×');
   if(now-this.lastAt<(IMPCFG.minSecondsBetween||0)*1000)return skip('too soon after the last one')}
  const style=(IMPCFG.styles||{})[lvl.style];if(!style)return skip('style "'+lvl.style+'" is missing');
  this.stop();
  this.lastAt=now;this.active={ev,lvl,style,t0:now,r:this.renderers[style.renderer||'frames']||this.renderers.frames};
  G.hold=Math.max(G.hold,lvl.freeze||0);if(lvl.shake)shake=Math.max(shake,lvl.shake);if(lvl.sound)play(lvl.sound);
  this.last={ok:true,why:(lvl.name||lvl.style)+(force?' (test)':pc)};
  this.tick(now);return true},
 tick(now){const a=this.active;if(a&&!a.r.update(a,now-a.t0))this.stop()},
 stop(){const a=this.active;if(a){a.r.end(a);this.active=null}},
 draw(){const a=this.active;if(a&&a.r.draw)a.r.draw(ctx,a)}
};

/* ---------- live stats and admin tools ---------- */
/* Rows of the expandable stats panel in the fight card: [key in text.statNames, read the current value from the fight, format it, format a change]. */
const r2=v=>Math.abs(v)<1e4?''+Math.round(v*100)/100:short(v);
const LIVE=[
 ['hp',S=>S.player.maxhp,v=>''+Math.round(v),v=>''+Math.round(v)],
 ['power',S=>S.P.pow+S.ramp.pow,num,num],
 ['mult',S=>shownMult(S),v=>'×'+r2(v),r2],   // every always-on ×Mult and +Mult, in socket order (shownMult in core.js)
 ['crit',S=>(S.P.crit+S.ramp.crit)*100,v=>Math.round(v)+'%',v=>Math.round(v)+'%'],
 ['speed',S=>S.player.spd,v=>''+Math.round(v),v=>''+Math.round(v)],
 ['spin',S=>S.player.ws[0]?S.player.ws[0].spin:0,num,num],
 ['reach',S=>S.player.ws[0]?S.player.ws[0].len:0,v=>''+Math.round(v),v=>''+Math.round(v)],
 ['armor',S=>S.player.armor,num,num],
 ['regen',S=>S.P.regen,v=>num(v)+'/s',num],
];
/* Updates the live stats. Each value shows its change since the fight began and ticks when it moves. */
function liveStats(S){
 if(!G.liveBase||G.liveBase.S!==S)G.liveBase={S,v:LIVE.map(l=>l[1](S)),last:[]};
 const B=G.liveBase;
 LIVE.forEach((l,i)=>{const el=document.getElementById('ls-'+l[0]);if(!el)return;
  const v=l[1](S),txt=l[2](v),b=el.querySelector('b'),sm=el.querySelector('small');
  if(b.textContent!==txt){b.textContent=txt;const d=v-B.v[i],dt=l[3](Math.abs(d));
   sm.textContent=Math.abs(d)>1e-6&&dt!=='0'&&dt!=='0%'?(d>0?'+':'−')+dt:'';sm.className=d>0?'up':d<0?'down':'';
   const prev=B.last[i];if(prev!=null&&Math.abs(v-prev)>1e-6&&!reduce){el.classList.remove('tick-up','tick-down');void el.offsetWidth;el.classList.add(v>prev?'tick-up':'tick-down')}}
  B.last[i]=v});
}
/* Admin panel: test tools for the owner, shown when the Admin button is on. Players never see it, so its labels are plain English in code.
   Each row: [stat key on P, label, multiplier between what is typed and what is stored]. An override replaces the computed stat (see calcPlayer in core.js). */
const ADM=[['hp','Max HP',1],['pow','Power',1],['mult','Mult',1],['crit','Crit %',100],['critMult','Crit mult',1],['spd','Speed',1],['spin','Spin',1],['reach','Reach',1],['armor','Armor',1],['regen','Regen /s',1],['kb','Knockback',1],['impact','Impact',1]];
function adminCard(run){
 if(!G.admin||!run)return'';
 const base=calcPlayer(Object.assign({},run,{override:null}),null),o=run.override||{};
 let h=`<section class="card admin"><h3>Admin <span>a value here replaces that stat · best run is not recorded</span></h3><div class="adm-grid">`;
 for(const[k,label,m]of ADM)h+=`<label for="adm-${k}">${label}<input id="adm-${k}" data-adm="${k}" type="number" step="any" inputmode="decimal" placeholder="${r2(base[k]*m)}" value="${o[k]!=null?r2(o[k]*m):''}"></label>`;
 h+=`</div><div class="adm-row"><button data-act="adm-reset">Clear</button><button data-act="adm-gold">+$50</button>${G.phase==='fight'?'<button data-act="adm-win">Win fight</button>':''}</div>`;
 const lv=IMPCFG.levels||[];
 if(lv.length)h+=`<div class="adm-row"><span>Impact frame</span>${lv.map((l,i)=>`<button data-act="adm-impact" data-i="${i}">${l.name||'Level '+(i+1)}</button>`).join('')}</div>`;
 if(sysReduce)h+=`<div class="adm-row"><span>Reduced motion is on for this device</span><button data-act="adm-motion" aria-pressed="${!!G.forceMotion}">${G.forceMotion?'Playing effects anyway':'Play effects anyway'}</button></div>`;
 h+=`<p class="adm-note" id="adm-note">${impactNote()}</p>`;
 return h+'</section>';
}
/* One line for the Admin panel saying whether impact frames can play right now, and what happened to the last one. */
function impactNote(){
 const bits=[],max=IMPCFG.maxSpeed||4;
 if(IMPCFG.enabled===false)bits.push('Impact frames are switched off in game-data.json.');
 else{
  if(sysReduce)bits.push(G.forceMotion?'This device asks for reduced motion, but you chose to play effects anyway.':IMPCFG.respectReducedMotion===false?'This device asks for reduced motion; impact frames are set to play anyway, other motion effects are off.':'This device asks for reduced motion, so impact frames, squash and stretch, card tilt and other animations are off here. The test buttons still play. Press "Play effects anyway" to switch them all on for this device.');
  if(G.speed>max)bits.push('Real hits do not flash at '+G.speed+'× speed (limit '+max+'×).');
 }
 const L=Impact.last;if(L)bits.push(L.ok?'Last: played '+L.why+'.':'Last: skipped, '+L.why+'.');
 return bits.join(' ')||'Ready. Real hits flash at 50% or more of the strongest enemy.'.replace('50',''+Math.min.apply(null,(IMPCFG.levels||[{minPercentOfMaxHp:50}]).map(l=>l.minPercentOfMaxHp)));
}
/* Applies changed overrides to whatever is on screen: the running fight, or the warm-up preview. */
function applyAdmin(){
 const run=G.run,S=G.S;if(!run||!S)return;run.admin=true;
 if(G.phase==='fight'&&!S.done){const P=calcPlayer(run,S),pl=S.player,grew=P.hp!==pl.maxhp;S.P=P;pl.maxhp=P.hp;pl.hp=grew?P.hp:Math.min(pl.hp,P.hp);pl.armor=P.armor;pl.r=P.size;pl.m=pl.r*pl.r/324}
 else if(G.phase==='prep')previewFight();
}
document.addEventListener('change',e=>{
 const el=e.target;if(!el||!el.dataset||!el.dataset.adm||!G.run)return;
 const k=el.dataset.adm,m=(ADM.find(a=>a[0]===k)||[])[2]||1,run=G.run;
 run.override=run.override||{};
 if(el.value===''||isNaN(+el.value))delete run.override[k];else run.override[k]=+el.value/m;
 applyAdmin();render();
});

/* ---------- 6. canvas drawing ---------- */
/* The canvas is drawn in arena units (0..AW); one transform scales it to the screen. */
const DT=TH.damageText,TXT={weapon:DT.hit,proj:DT.hit,body:DT.hit,mini:DT.mini,aoe:DT.area,crit:DT.crit,poison:DT.poison,burn:DT.burn,shock:DT.shock,hurt:DT.hurt,heal:DT.heal};
const INK=TH.arena.outline;
/* Turns the events the simulation queued this frame into particles, floating numbers and sounds. */
function drain(S){
 for(const e of S.fx){
  if(e.k==='burst'){for(let i=0;i<e.n;i++){const a=Math.random()*TAU,v=40+Math.random()*160;parts.push({x:e.x,y:e.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:.5,m:.5,c:e.col,r:1.5+Math.random()*2.5})}}
  else if(e.k==='ring'){rings.push({x:e.x,y:e.y,r:e.r,c:e.col,l:.35,m:.35});if(e.r>=70)addFlash('blast',e.x,e.y,Math.min(2,e.r/120),e.col);else addFlash('glint',e.x,e.y,1,e.col)}
  else if(e.k==='zap'){zaps.push({x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,l:.16});addFlash(e.y1===0?'lightning':'spark',e.x2,e.y2)}   // a strike from the sky dims the room
  else if(e.k==='impact'){if(!S.demo&&!S.preview){Impact.trigger(e)}}   // impact frames stay as they were: no light flash
  else if(e.k==='quake'){addFlash('quake',e.x,e.y);   // Earthquake: two ripples and a few cracks running in from the wall that was hit, plus a shake in real fights
   const col=TH.effects.quake||TH.effects.spark,base=Math.atan2(AH/2-e.y,AW/2-e.x);
   rings.push({x:e.x,y:e.y,r:AW*.95,c:col,l:.55,m:.55},{x:e.x,y:e.y,r:AW*.5,c:col,l:.38,m:.38});
   for(let i=0;i<5;i++){let a=base+(i-2)*.45+(Math.random()-.5)*.25,x=e.x,y=e.y;const pts=[[x,y]],n=4+(Math.random()*3|0);
    for(let k=0;k<n;k++){a+=(Math.random()-.5)*.9;const d=14+Math.random()*24;x+=Math.cos(a)*d;y+=Math.sin(a)*d;pts.push([x,y])}cracks.push({pts,c:col,l:.65,m:.65})}
   if(!reduce&&!S.demo&&!S.preview)shake=Math.max(shake,e.shake||RULES.feel.maxShake)}
  else if(e.k==='streak')floats.push({x:e.x,y:e.y-26,s:tpl(TX.chainStreak||'Chain ×{n}',{n:e.n}),c:TH.page.gold,l:.9,m:.9,z:Math.min(22,11+e.n)});   // Newton's Cradle chains
  else if(e.k==='eat')floats.push({x:AW/2,y:AH*.2,s:tpl(TX.ateText||'{by} ate {name}',{by:e.by,name:e.name})+'  +×'+num(e.gain),c:TH.page.gold,l:2.2,m:2.2,z:13.333,body:true,still:true});   // Maw
  else if(e.k==='spark'){for(let i=0;i<5;i++){const a=Math.random()*TAU,v=60+Math.random()*120;parts.push({x:e.x,y:e.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:.22,m:.22,c:TH.effects.spark,r:1.2})}}
 }
 S.fx.length=0;
 for(const f of S.texts){
  if(f.v<.5)continue;
  const big=f.kind==='crit';
  floats.push({x:f.x+(Math.random()-.5)*14,y:f.y-2,s:(f.kind==='heal'?'+':'')+fmt(f.v)+(big?'!':''),c:TXT[f.kind]||DT.hit,l:.7,m:.7,z:big?15:f.kind==='poison'||f.kind==='burn'?8.5:11});
  if(f.kind==='hurt'&&!reduce)shake=Math.min(RULES.feel.maxShake,shake+RULES.feel.shakePerHitTaken);
 }
 S.texts.length=0;if(floats.length>70)floats.splice(0,floats.length-70);
 if(S.snd.length){if(!S.demo&&!S.preview){const seen={};let n=0;for(const k of S.snd){if(seen[k])continue;seen[k]=1;play(k);if(++n>=5)break}}S.snd.length=0}
}
/* Draws one weapon. Sprite art (if set) points right with the grip at the left edge. */
/* Boss and enemy rules drawn on the floor: The Eight Ball's pockets, The Furnace's glowing walls, The Glacier's ice. */
function drawArenaRules(S){
 if(S.pockets){const r=S.pockets.r;for(const[cx,cy]of[[0,0],[AW,0],[0,AH],[AW,AH]]){ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fillStyle=INK;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=rgba(TH.page.chalk,.35);ctx.stroke()}}
 if(S.hotWalls){const a=.35+.2*Math.sin(S.t*8);ctx.fillStyle=rgba(TH.damageText.burn,a);for(const w of S.hotWalls){if(w===0)ctx.fillRect(0,0,6,AH);else if(w===1)ctx.fillRect(AW-6,0,6,AH);else if(w===2)ctx.fillRect(0,0,AW,6);else ctx.fillRect(0,AH-6,AW,6)}}
 for(const z of S.ice){const q=Math.min(1,z.t/Math.min(1,z.t0));ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,TAU);ctx.fillStyle=rgba(TH.effects.freeze||'#d9f4ff',.22*q);ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=rgba(TH.effects.freeze||'#d9f4ff',.6*q);ctx.stroke()}
}
/* Rings over a ball that warn of an enemy's move or show its state: wind-up flash, fuse, a Stabber ready to dodge, an elite, The Bulwark's shield. */
/* Mini Hut: a stepped pixel roof sitting on top of its ball (drawn by code until assets.images.balls.hut is set). */
function drawHutRoof(b){const u=PXL||1.5,w=Math.round(b.r*1.25/u),top=b.y-b.r-u*Math.ceil(w/2)+u*2;
 ctx.fillStyle=INK;for(let i=0;i<=Math.ceil(w/2);i++){const half=i+1;ctx.fillRect(b.x-half*u-u,top+i*u-u,(half*2+2)*u,u*2)}
 ctx.fillStyle=dark(b.col)?'#e3a36b':'#8a5a35';for(let i=0;i<Math.ceil(w/2);i++){const half=i+1;ctx.fillRect(b.x-half*u,top+i*u,half*2*u,u)}}
function drawBallMarks(b,S){
 if(b.tele>0){ctx.lineWidth=2.5;ctx.strokeStyle=rgba('#ffffff',.5+.5*Math.sin(S.t*40));ctx.beginPath();ctx.arc(b.x,b.y,b.r+5,0,TAU);ctx.stroke()}
 if(b.fuse!=null){ctx.lineWidth=2.5;ctx.strokeStyle=rgba(TH.damageText.burn,.6+.4*Math.sin(S.t*30));ctx.beginPath();ctx.arc(b.x,b.y,b.r+4+(1-b.fuse)*6,0,TAU);ctx.stroke()}
 if(b.kind==='stabber'&&b.ready){ctx.lineWidth=1.2;ctx.strokeStyle=rgba(TH.page.chalk,.7);ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(b.x,b.y,b.r+3,0,TAU);ctx.stroke();ctx.setLineDash([])}
 if(b.hut&&!IMG['ball.hut'])drawHutRoof(b);
 if(b.elite){ctx.lineWidth=1.2;ctx.strokeStyle=TH.page.gold;ctx.beginPath();ctx.arc(b.x,b.y,b.r+3.5,0,TAU);ctx.stroke()}
 if(b.shieldOn){const a=Math.atan2(b.vy,b.vx),w=(S.bossDef&&S.bossDef.v.shieldArc)||1.1;ctx.lineCap='round';ctx.lineWidth=8;ctx.strokeStyle=INK;ctx.beginPath();ctx.arc(b.x,b.y,b.r+7,a-w,a+w);ctx.stroke();ctx.lineWidth=5;ctx.strokeStyle=TH.weapons.shield;ctx.beginPath();ctx.arc(b.x,b.y,b.r+7,a-w,a+w);ctx.stroke();ctx.lineCap='butt'}
}
function drawWeapon(b,w){
 ctx.save();
 if(w.mult>1){ctx.shadowColor=TH.page.gold;ctx.shadowBlur=10}   // a braced Lancer's spear glows
 else if(BL.weaponShadow&&BL.shadow){const L=sampleLight(b).dir,k=cv.width/AW,o=(BL.weaponShadowOffset||5)*k;ctx.shadowColor=rgba('#000000',BL.shadowOpacity);ctx.shadowBlur=0;ctx.shadowOffsetX=-L.x*o;ctx.shadowOffsetY=-L.y*o}   // the weapon's shadow on the floor, away from the light
 if(BL.weaponLight&&CAN_FILTER){const L=sampleLight(b).dir,f=1+(BL.weaponLight||0)*(Math.cos(w.ang)*L.x+Math.sin(w.ang)*L.y);if(Math.abs(f-1)>.01)ctx.filter='brightness('+f.toFixed(3)+')'}   // brighter when it points toward the light
 ctx.translate(b.x,b.y);ctx.rotate(w.ang);
 const r=b.r,e=r+w.len,im=IMG['weapon.'+w.type],C=TH.weapons;
 if(im){
  if(w.type==='bow'){const h=34,wd=h*im.width/im.height;ctx.drawImage(im,r+6-wd/2,-h/2,wd,h)}
  else if(w.type==='shield'){const h=w.len,wd=h*im.width/im.height;ctx.drawImage(im,r+7-wd/2,-h/2,wd,h)}
  else{const L=e-(r-2),h=L*im.height/im.width;ctx.drawImage(im,r-2,-h/2,L,h)}
  ctx.restore();return;
 }
 ctx.lineJoin='round';ctx.strokeStyle=INK;ctx.lineWidth=1.6;
 if(w.type==='sword'){ctx.fillStyle=C.blade;ctx.beginPath();ctx.moveTo(r-1,-3.6);ctx.lineTo(e-6,-3.6);ctx.lineTo(e,0);ctx.lineTo(e-6,3.6);ctx.lineTo(r-1,3.6);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle=C.guard;ctx.fillRect(r,-8,4,16);ctx.strokeRect(r,-8,4,16)}
 else if(w.type==='dagger'){ctx.fillStyle=C.blade;ctx.beginPath();ctx.moveTo(r-1,-3.4);ctx.lineTo(e,0);ctx.lineTo(r-1,3.4);ctx.closePath();ctx.fill();ctx.stroke()}
 else if(w.type==='spear'){ctx.fillStyle=C.shaft;ctx.fillRect(r-2,-1.8,w.len-9,3.6);ctx.strokeRect(r-2,-1.8,w.len-9,3.6);
  ctx.fillStyle=C.blade;ctx.beginPath();ctx.moveTo(e-13,-5);ctx.lineTo(e,0);ctx.lineTo(e-13,5);ctx.closePath();ctx.fill();ctx.stroke()}
 else if(w.type==='hammer'){ctx.fillStyle=C.shaft;ctx.fillRect(r-2,-2.4,w.len-12,4.8);ctx.strokeRect(r-2,-2.4,w.len-12,4.8);
  ctx.fillStyle=C.hammerHead;ctx.fillRect(e-16,-12,16,24);ctx.strokeRect(e-16,-12,16,24)}
 else if(w.type==='bow'){ctx.lineWidth=5;ctx.strokeStyle=INK;ctx.beginPath();ctx.arc(r-6,0,16,-1.15,1.15);ctx.stroke();ctx.lineWidth=2.6;ctx.strokeStyle=C.bow;ctx.beginPath();ctx.arc(r-6,0,16,-1.15,1.15);ctx.stroke();
  ctx.lineWidth=1;ctx.strokeStyle=TH.page.chalk;ctx.beginPath();ctx.moveTo(r-6+16*Math.cos(1.15),-16*Math.sin(1.15));ctx.lineTo(r-6+16*Math.cos(1.15),16*Math.sin(1.15));ctx.stroke()}
 else if(w.type==='shield'){const h=(w.len/2)/(r+7);ctx.lineCap='round';ctx.lineWidth=9;ctx.strokeStyle=INK;ctx.beginPath();ctx.arc(0,0,r+7,-h,h);ctx.stroke();ctx.lineWidth=6;ctx.strokeStyle=C.shield;ctx.beginPath();ctx.arc(0,0,r+7,-h,h);ctx.stroke()}
 ctx.restore();
}
/* Squash and stretch (drawing only; the physics never sees it). Settings: rules.feel.stretch.
   A fast ball stretches along its path. A sharp change of direction at speed (a bounce or a knock) squashes it for a moment along the direction of the change.
   Returns null for a round ball, or {a, sx, sy}: scale by sx along angle a and by sy across it. Area is kept, so the ball does not look bigger. */
const SQ=Object.assign({enabled:true,startSpeed:150,fullSpeed:650,maxStretch:.22,bounceSquash:.2,bounceSeconds:.12},RULES.feel.stretch||{});
const shapeMem=new Map();   // ball id -> last velocity and any squash still playing
function ballShape(b,dt){
 if(!SQ.enabled||reduce)return null;
 const sp=Math.hypot(b.vx,b.vy),span=Math.max(1,SQ.fullSpeed-SQ.startSpeed);
 let m=shapeMem.get(b.id);if(!m){m={vx:b.vx,vy:b.vy,t:0,a:0,amt:0};shapeMem.set(b.id,m)}
 const osp=Math.hypot(m.vx,m.vy);
 if(sp>1&&osp>1&&(b.vx*m.vx+b.vy*m.vy)/(sp*osp)<.5){const k=clamp((Math.max(sp,osp)-SQ.startSpeed)/span,0,1);
  if(k>0){m.t=SQ.bounceSeconds;m.a=Math.atan2(b.vy-m.vy,b.vx-m.vx);m.amt=SQ.bounceSquash*(.3+.7*k)}}
 m.vx=b.vx;m.vy=b.vy;
 if(m.t>0){const s=1-m.amt*(m.t/SQ.bounceSeconds);m.t-=dt;return{a:m.a,sx:s,sy:1/s}}
 if(b.stun>0)return null;
 const k=clamp((sp-SQ.startSpeed)/span,0,1);if(k<=0)return null;
 const s=1+SQ.maxStretch*k;return{a:Math.atan2(b.vy,b.vx),sx:s,sy:1/s};
}
/* Draws one ball: sprite or coloured circle (squashed or stretched when it is fast), status rings, then the HP number. */
/* ---------- ball look: stepped shading, floor shadows, a rolling stripe, and a light that follows the mouse ----------
   Settings: theme.ballLook. The light sits wherever the mouse is on the page (the same pointer that lights the augment cards), so every ball is
   lit from the side the mouse is on and casts its shadow the other way. With no mouse (touch, or before it moves) the light is top left.
   A ball with its own sprite (assets.images.balls) keeps the sprite and only gets the floor shadow. */
const BL=Object.assign({shading:true,shadow:true,stripe:true,mouseLight:true,shadowOpacity:.42,stripeOpacity:.55,highlight:true},TH.ballLook||{});
const SHADES={},CAN_FILTER='filter' in ctx;
/* Pixel layer: shadows, ball bodies and light pools are drawn on a small canvas (one pixel = PXL arena units) and scaled up without smoothing,
   so shading steps, the highlight, the outline and the mouse light come out as chunky pixels like the card frames. 0 = off (smooth). */
const PXL=BL.pixelArt===false?0:(+BL.pixel||1.5);
let pix=null,pg=null,lpix=null,lpg=null;
function pixLayer(){if(!pix){pix=document.createElement('canvas');pix.width=Math.ceil(AW/PXL);pix.height=Math.ceil(AH/PXL);pg=pix.getContext('2d')}
 pg.setTransform(1,0,0,1,0,0);pg.clearRect(0,0,pix.width,pix.height);pg.setTransform(1/PXL,0,0,1/PXL,0,0);pg.imageSmoothingEnabled=false;return pg}
/* Pixel pass: shadows and ball bodies are worked out pixel by pixel on the small layer, so every edge is hard: no blended in-between colours.
   Same rules as the smooth drawing: tones stepped toward the light, a highlight, a coloured tint from the strongest nearby light, a 1 or 2 pixel
   outline (2 for your ball and bosses), the hit flash, and squash and stretch. Balls with their own sprite are left to drawTop(). */
const RGB={};
function rgbOf(c){if(RGB[c])return RGB[c];let m=/^#?([0-9a-f]{6})$/i.exec(c);let v;if(m)v=[0,2,4].map(i=>parseInt(m[1].substr(i,2),16));else{m=/rgba?\(([^)]+)\)/.exec(c);v=m?m[1].split(',').slice(0,3).map(Number):[255,255,255]}return RGB[c]=v}
let pbuf=null,p32=null,pimg=null;
function pixelPass(S,dt){
 const L_=pixLayer(),W=pix.width,H=pix.height,P=PXL;
 if(!pimg||pimg.width!==W){pimg=L_.createImageData(W,H);pbuf=pimg.data;p32=new Uint32Array(pbuf.buffer)}
 p32.fill(0);
 const put=(i,r,g,b)=>{p32[i]=(255<<24)|(b<<16)|(g<<8)|r};
 // shadows (alpha only, black); the strongest wins where two overlap
 if(BL.shadow)for(const b of S.balls){if(!b.alive)continue;const sh=shadowsFor(b);
  for(const[cx,cy,ra,rb,an,al]of sh){const A=Math.round(al*255);if(A<4)continue;const ca=Math.cos(an),sa=Math.sin(an),R_=Math.max(ra,rb);
   const x0=Math.max(0,Math.floor((cx-R_)/P)),x1=Math.min(W-1,Math.ceil((cx+R_)/P)),y0=Math.max(0,Math.floor((cy-R_)/P)),y1=Math.min(H-1,Math.ceil((cy+R_)/P));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const dx=(x+.5)*P-cx,dy=(y+.5)*P-cy,u=(dx*ca+dy*sa)/ra,v=(-dx*sa+dy*ca)/rb;if(u*u+v*v>1)continue;const i=y*W+x,cur=p32[i]>>>24;if(A>cur)p32[i]=A<<24}}}
 // ball bodies
 const A_=TH.arena;
 for(const b of S.balls){if(!b.alive||IMG['ball.'+b.kind])continue;
  const C=shades(b.col),D=rgbOf(C.dark),M=rgbOf(C.mid),B=rgbOf(C.base),Lt=rgbOf(C.lit),ls=sampleLight(b),L=ls.dir,r=b.r,sh=b._sh;
  const OC=rgbOf(b.player||b.twin?A_.playerOutline:b.boss?A_.bossOutline:A_.outline),ow=P;   // one pixel for every ball
  const mx=b.x+L.x*r*.16,my=b.y+L.y*r*.16,bx=b.x+L.x*r*.3,by=b.y+L.y*r*.3,hx=b.x+L.x*r*.45,hy=b.y+L.y*r*.45,wx=hx+L.x*r*.04,wy=hy+L.y*r*.04,hr=Math.max(r*.2,P*.9),wr=Math.max(r*.08,P*.55);
  const T=ls.top,tA=T&&T.w>.05?Math.min(.32,T.w*.16):0,TC=tA?rgbOf(T.col):null,tx=T?b.x+T.x*r*.55:0,ty=T?b.y+T.y*r*.55:0,fl=b.flash>0;
  const ca=sh?Math.cos(sh.a):1,sa=sh?Math.sin(sh.a):0,sx=sh?sh.sx:1,sy=sh?sh.sy:1,ext=r*Math.max(sx,sy)+P;
  const x0=Math.max(0,Math.floor((b.x-ext)/P)),x1=Math.min(W-1,Math.ceil((b.x+ext)/P)),y0=Math.max(0,Math.floor((b.y-ext)/P)),y1=Math.min(H-1,Math.ceil((b.y+ext)/P));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   let dx=(x+.5)*P-b.x,dy=(y+.5)*P-b.y;
   if(sh){const u=(dx*ca+dy*sa)/sx,v=(-dx*sa+dy*ca)/sy;dx=u*ca-v*sa;dy=u*sa+v*ca}   // back into the ball's round shape
   const d=Math.hypot(dx,dy);if(d>r)continue;
   const px=b.x+dx,py=b.y+dy,i=y*W+x;
   if(d>r-ow){put(i,OC[0],OC[1],OC[2]);continue}
   let c=D;if(BL.shading){if(Math.hypot(px-mx,py-my)<r*.96)c=M;if(Math.hypot(px-bx,py-by)<r*.76)c=B;
    if(BL.highlight){if(Math.hypot(px-hx,py-hy)<hr)c=Lt;if(Math.hypot(px-wx,py-wy)<wr)c=[255,255,255]}}else c=rgbOf(b.col);
   let R0=c[0],G0=c[1],B0=c[2];
   if(tA&&Math.hypot(px-tx,py-ty)<r*.85){R0=Math.min(255,R0+TC[0]*tA);G0=Math.min(255,G0+TC[1]*tA);B0=Math.min(255,B0+TC[2]*tA)}
   if(fl){R0+=(255-R0)*.8;G0+=(255-G0)*.8;B0+=(255-B0)*.8}
   put(i,R0|0,G0|0,B0|0)}}
 pg.putImageData(pimg,0,0);ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(pix,0,0,AW,AH);ctx.restore();
}
/* Pixel effects: particles, rings, lightning, cracks and the speed trail are drawn as squares on the same grid as the pixel layer (PXL),
   each grid square at most once per shape, so they read as pixel art and fade evenly. */
const pxSnap=v=>Math.floor(v/PXL)*PXL;
function pxFill(keys,w,col){ctx.fillStyle=col;const s=w*PXL;for(const k of keys){const i=k.indexOf(',');ctx.fillRect(+k.slice(0,i)*PXL,+k.slice(i+1)*PXL,s,s)}}
function pxDotKey(set,x,y){set.add(Math.floor(x/PXL)+','+Math.floor(y/PXL))}
function pxLine(set,x1,y1,x2,y2){const n=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)/(PXL*.7)));for(let i=0;i<=n;i++){const q=i/n;pxDotKey(set,x1+(x2-x1)*q,y1+(y2-y1)*q)}}
function pxRing(set,x,y,r){const n=Math.max(8,Math.ceil(TAU*r/(PXL*.7)));for(let i=0;i<n;i++){const a=i/n*TAU;pxDotKey(set,x+Math.cos(a)*r,y+Math.sin(a)*r)}}
function pxDisc(set,x,y,r){const R_=Math.max(r,PXL*.5);for(let gy=Math.floor((y-R_)/PXL);gy<=Math.floor((y+R_)/PXL);gy++)for(let gx=Math.floor((x-R_)/PXL);gx<=Math.floor((x+R_)/PXL);gx++)if(Math.hypot((gx+.5)*PXL-x,(gy+.5)*PXL-y)<=R_)set.add(gx+','+gy)}
function lightLayer(){if(!lpix){lpix=document.createElement('canvas');lpix.width=Math.ceil(AW/PXL);lpix.height=Math.ceil(AH/PXL);lpg=lpix.getContext('2d')}
 lpg.setTransform(1,0,0,1,0,0);lpg.clearRect(0,0,lpix.width,lpix.height);lpg.setTransform(1/PXL,0,0,1/PXL,0,0);return lpg}
function mixHex(a,b,t){const h=x=>{x=String(x);const r=/rgba?\(([^)]+)\)/.exec(x);if(r)return r[1].split(',').slice(0,3).map(Number);x=x.replace('#','');return[0,2,4].map(i=>parseInt(x.substr(i,2),16))},A=h(a),B=h(b);return'rgb('+A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(',')+')'}
function shades(col){return SHADES[col]||(SHADES[col]={dark:mixHex(col,'#140a1e',.45),mid:mixHex(col,'#140a1e',.18),base:col,lit:mixHex(col,'#ffffff',.3),band:mixHex(col,'#ffffff',.55)})}
let lightPt=null,lightAt={x:-AW*.4,y:-AH*.6};   // lightPt: where the mouse is, in arena units; lightAt eases toward it
document.addEventListener('pointermove',e=>{if(e.pointerType==='touch'||!BL.mouseLight)return;const r=cv.getBoundingClientRect();if(!r.width)return;lightPt={x:(e.clientX-r.left)/r.width*AW,y:(e.clientY-r.top)/r.height*AH}});
document.documentElement.addEventListener('pointerleave',()=>{lightPt=null});
function stepLight(dt){const t=lightPt||{x:-AW*.4,y:-AH*.6},k=1-Math.exp(-dt*(BL.lightEase||3));lightAt.x+=(t.x-lightAt.x)*k;lightAt.y+=(t.y-lightAt.y)*k}   // eases toward the mouse
/* The light hangs lightHeight above the table, so a ball right under the mouse is lit from straight above (centred highlight, shadow underneath)
   and the lighting turns smoothly as the mouse passes over a ball instead of flipping. Returns the sideways part of the light direction (length 0 to 1). */
function lightDir(b){const dx=lightAt.x-b.x,dy=lightAt.y-b.y,h=BL.lightHeight||120,d=Math.hypot(dx,dy,h);return{x:dx/d,y:dy/d}}
/* ---------- lighting (theme.lighting) ----------
   Two modes. 'simple' is one light: the mouse (or top left). 'full' adds lights from the fight: short flashes (lightning, blasts, Earthquake, impact
   frames) and glows that follow things (burning or frozen balls, some bosses, warning marks). Lightning briefly dims the whole arena so its light and
   the shadows it throws stand out. Every ball, shadow and weapon reads the same per-ball sample (b._ls), so anything drawn later can join in.
   The mode is a header button and is remembered; if full lighting makes frames slow, the game drops to simple once and says so. */
const LT=Object.assign({mode:'full',ambient:0,maxDim:.6,autoSimpleMs:14,flashes:{},glows:{},bossGlow:{}},TH.lighting||{});
let lightMode=LT.mode==='simple'?'simple':'full',flashes=[],frameL=[],dimNow=0,frameNo=0;
/* A short light from something that happened: kind is a key of theme.lighting.flashes; col overrides its colour, scale its strength. */
function addFlash(kind,x,y,scale,col){const f=LT.flashes[kind];if(!f||lightMode!=='full'||flashes.length>24)return;const k=scale||1;
 flashes.push({x,y,h:f.height||60,col:col||f.color,i:f.intensity*k,r:f.radius*Math.sqrt(k),l:f.life,m:f.life,dim:(f.dim||0)*(reduce?.35:1)})}
/* Builds this frame's lights: live flashes (fading) and glows from balls, the boss and warning marks. Sets dimNow. */
function frameLights(S,dt){
 frameNo++;frameL=[];dimNow=0;if(lightMode!=='full')return;
 for(let i=flashes.length-1;i>=0;i--){const f=flashes[i];f.l-=dt;if(f.l<=0){flashes.splice(i,1);continue}const q=f.l/f.m,e=q*q;frameL.push({x:f.x,y:f.y,h:f.h,col:f.col,i:f.i*e,r:f.r,flash:1});dimNow=Math.max(dimNow,f.dim*e)}
 dimNow=Math.min(LT.maxDim,dimNow);
 const G_=LT.glows;
 for(const b of S.balls){if(!b.alive)continue;
  if(b.burn>0&&G_.burn)frameL.push({x:b.x,y:b.y,h:G_.burn.height||30,col:G_.burn.color,i:Math.min(G_.burn.max||1,G_.burn.intensity+(G_.burn.perStack||0)*b.burn),r:G_.burn.radius+b.r,src:b});
  if(b.frozen>0&&G_.frozen)frameL.push({x:b.x,y:b.y,h:G_.frozen.height||30,col:G_.frozen.color,i:G_.frozen.intensity,r:G_.frozen.radius+b.r,src:b});
  const bg=b.boss&&LT.bossGlow[b.kind];if(bg)frameL.push({x:b.x,y:b.y,h:bg.height||40,col:bg.color,i:bg.intensity,r:bg.radius+b.r,src:b})}
 if(G_.mark)for(const m of S.marks){const q=1-m.t/(m.t0||1);frameL.push({x:m.x,y:m.y,h:G_.mark.height||40,col:m.src&&m.src.col||G_.mark.color,i:G_.mark.intensity*q,r:G_.mark.radius+m.r})}
}
/* How one ball is lit this frame: dir (sideways light direction, length 0 to 1) for shading and the key shadow, key (how strong the mouse light still
   is, lower while lightning dims the room), and the strongest other light (top) for a second shadow and a coloured tint. Cached per frame. */
function sampleLight(b){
 if(b._lf===frameNo&&b._ls)return b._ls;
 const K=lightDir(b),kw=1-dimNow*.85;let vx=K.x*kw,vy=K.y*kw,W=kw,top=null,tw=0;
 for(const L of frameL){if(L.src===b)continue;const dx=L.x-b.x,dy=L.y-b.y,dd=Math.hypot(dx,dy),f=1-dd/L.r;if(f<=0)continue;const w=L.i*f*f;if(w<.02)continue;
  const n=Math.hypot(dx,dy,L.h);vx+=dx/n*w;vy+=dy/n*w;W+=w;if(w>tw){tw=w;top={x:dx/n,y:dy/n,w,col:L.col,h:L.h,lx:L.x,ly:L.y}}}
 const ls={dir:{x:vx/Math.max(W,1e-6),y:vy/Math.max(W,1e-6)},key:kw,top};b._ls=ls;b._lf=frameNo;return ls}
/* After balls and projectiles: the dimmed room, then each light added on top as a soft pool of its colour. Effects drawn after this stay bright. */
function drawLightPass(){
 if(lightMode!=='full'||Impact.active)return;   // an impact frame shows the plain scene, as before the lighting
 const a=Math.min(.85,(LT.ambient||0)+dimNow);
 if(a>.01){ctx.fillStyle=rgba('#05030a',a);ctx.fillRect(0,0,AW,AH)}
 if(!frameL.length)return;const c=PXL?lightLayer():ctx;c.save();c.globalCompositeOperation='lighter';
 for(const L of frameL){const al=Math.min(.55,L.i*(L.flash?.22:.14));if(al<.01)continue;const g=c.createRadialGradient(L.x,L.y,0,L.x,L.y,L.r);g.addColorStop(0,rgba(L.col,al));g.addColorStop(.35,rgba(L.col,al*.55));g.addColorStop(1,rgba(L.col,0));c.fillStyle=g;c.fillRect(L.x-L.r,L.y-L.r,L.r*2,L.r*2)}
 c.restore();if(PXL){ctx.save();ctx.globalCompositeOperation='lighter';ctx.imageSmoothingEnabled=false;ctx.drawImage(lpix,0,0,AW,AH);ctx.restore()}}
let drawMs=0,slowFor=0;
function watchFrame(ms,dt){drawMs+=(ms-drawMs)*.05;if(lightMode!=='full'||G.lightChosen||G.phase!=='fight')return;slowFor=drawMs>LT.autoSimpleMs?slowFor+dt:0;
 if(slowFor>3){lightMode='simple';G.lightAuto=true;flashes=[];renderCtl();const n=$('#notice');if(n){n.hidden=false;n.textContent=TX.lightAutoSimple||'Frames were slow, so lighting switched to Simple. Change it with the Lighting button.';setTimeout(()=>{n.hidden=true},6000)}}}
/* Floor shadows go under every ball before any ball is drawn, so a shadow never covers a neighbour. */
/* The shadows one ball casts this frame: [centreX, centreY, long radius, short radius, angle, opacity]. A ball's shadow starts under it and stretches
   away from each light: the further the light is to the side (compared with its height), the longer and fainter the shadow; with the light right
   above, it is a round dark patch under the ball. The strongest nearby light (flash or glow)
   adds a second shadow the same way. */
function shadowsFor(b){
 const ls=sampleLight(b),out=[],k=(BL.shadowLength||.5)*2;
 const cast=(lx,ly,h,al)=>{const dx=b.x-lx,dy=b.y-ly,hd=Math.hypot(dx,dy),ux=hd>.01?dx/hd:.6,uy=hd>.01?dy/hd:.8;
  const len=b.r*Math.min(2.8,Math.max(.12,hd/h))*k,ang=Math.atan2(uy,ux),fade=1/(1+hd/(h*4)),a=al*(.55+.45*fade);
  const cx=b.x+ux*len*.5,cy=b.y+uy*len*.5;
  out.push([cx,cy,b.r*.95+len*.46,b.r*.86,ang,a*.85])};
 if(ls.key>.02)cast(lightAt.x,lightAt.y,BL.lightHeight||120,BL.shadowOpacity*ls.key);
 const T=ls.top;if(T&&T.w>.12)cast(T.lx,T.ly,Math.max(15,T.h),Math.min(.6,T.w*.45));
 return out}
function drawShadows(S,g){
 if(!BL.shadow)return;
 for(const b of S.balls){if(!b.alive)continue;for(const[cx,cy,ra,rb,an,al]of shadowsFor(b)){g.fillStyle=rgba('#000000',Math.min(.85,al));g.beginPath();g.ellipse(cx,cy,ra,rb,an,0,TAU);g.fill()}}
}
/* The ball itself: three flat tones stepped toward the light, a stripe that rolls with the distance travelled, and a hard highlight. */
function shadeBall(b,dt,g){
 const C=shades(b.col),ls=sampleLight(b),L=ls.dir,r=b.r;
 if(dt>0){const sp=Math.hypot(b.vx,b.vy);if(sp>1){b.roll=(b.roll||0)+sp*dt/r;b.rollA=Math.atan2(b.vy,b.vx)}}
 g.save();g.beginPath();g.arc(b.x,b.y,r,0,TAU);g.clip();
 g.fillStyle=C.dark;g.fillRect(b.x-r,b.y-r,r*2,r*2);
 g.fillStyle=C.mid;g.beginPath();g.arc(b.x+L.x*r*.16,b.y+L.y*r*.16,r*.96,0,TAU);g.fill();
 g.fillStyle=C.base;g.beginPath();g.arc(b.x+L.x*r*.3,b.y+L.y*r*.3,r*.76,0,TAU);g.fill();
 if(BL.stripe){const ph=b.roll||0,front=Math.cos(ph);   // the band is on the near side of the ball half the time
  if(front>0){const a=b.rollA||0,off=Math.sin(ph)*r,w=r*.3*Math.max(.35,front);g.save();g.translate(b.x+Math.cos(a)*off,b.y+Math.sin(a)*off);g.rotate(a);
   g.globalAlpha=BL.stripeOpacity;g.fillStyle=C.band;g.fillRect(-w,-r*1.2,w*2,r*2.4);g.restore()}}
 if(BL.highlight){const hx=b.x+L.x*r*.45,hy=b.y+L.y*r*.45;g.fillStyle=C.lit;g.beginPath();g.arc(hx,hy,r*.2,0,TAU);g.fill();
  g.fillStyle='#ffffff';g.beginPath();g.arc(hx+L.x*r*.04,hy+L.y*r*.04,r*.08,0,TAU);g.fill()}
 const T=ls.top;if(T&&T.w>.05){g.globalCompositeOperation='lighter';g.fillStyle=rgba(T.col,Math.min(.32,T.w*.16));g.beginPath();g.arc(b.x+T.x*r*.55,b.y+T.y*r*.55,r*.85,0,TAU);g.fill();g.globalCompositeOperation='source-over'}   // coloured light on the side facing a flash or glow
 g.restore();
}
/* A ball is drawn in two passes. The body (shading, highlight, flash, outline) can go to the pixel layer (theme.ballLook.pixelArt), so it comes out
   as chunky pixels; the top (status rings, wind-up marks, HP number) and the weapons always go straight to the arena, sharp. */
function drawBody(b,dt,g,sh){
 const A=TH.arena;
 if(sh){g.save();g.translate(b.x,b.y);g.rotate(sh.a);g.scale(sh.sx,sh.sy);g.rotate(-sh.a);g.translate(-b.x,-b.y)}
 if(BL.shading)shadeBall(b,dt,g);else{g.beginPath();g.arc(b.x,b.y,b.r,0,TAU);g.fillStyle=b.col;g.fill()}
 if(b.flash>0){g.beginPath();g.arc(b.x,b.y,b.r,0,TAU);g.fillStyle=BL.shading?rgba('#ffffff',.8):'#fff';g.fill()}
 const ow=1.8;g.beginPath();g.arc(b.x,b.y,b.r-(PXL?ow/2:0),0,TAU);g.lineWidth=PXL?Math.max(ow,PXL):ow;g.strokeStyle=b.player||b.twin?A.playerOutline:b.boss?A.bossOutline:A.outline;g.stroke();
 if(sh)g.restore();
}
function drawTop(b,S){
 const im=IMG['ball.'+b.kind],A=TH.arena,sh=b._sh;
 if(im){
  if(sh){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(sh.a);ctx.scale(sh.sx,sh.sy);ctx.rotate(-sh.a);ctx.translate(-b.x,-b.y)}
  ctx.drawImage(im,b.x-b.r,b.y-b.r,b.r*2,b.r*2);
  if(b.flash>0){ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fillStyle='#fff';ctx.fill();ctx.globalAlpha=1}
  if(OPT.ballOutlineOnSprites){ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.lineWidth=b.player||b.twin||b.boss?2.6:1.8;ctx.strokeStyle=b.player||b.twin?A.playerOutline:b.boss?A.bossOutline:A.outline;ctx.stroke()}
  if(sh)ctx.restore();
 }
 if(b.poison>0){ctx.lineWidth=2;ctx.strokeStyle=TH.effects.poisonRing;ctx.beginPath();ctx.arc(b.x,b.y,b.r+3.2,S.t*2,S.t*2+Math.min(TAU,.6+b.poison*.12));ctx.stroke()}
 if(b.burn>0){ctx.lineWidth=2;ctx.strokeStyle=TH.effects.burnRing;ctx.beginPath();ctx.arc(b.x,b.y,b.r+5.8,-S.t*3,-S.t*3+Math.min(TAU,.6+b.burn*.25));ctx.stroke()}
 if(b.chill>0){const CM=(RULES.status&&RULES.status.chillMax)||10;ctx.lineWidth=2;ctx.strokeStyle=TH.effects.chill||'#a8e6ff';ctx.beginPath();ctx.arc(b.x,b.y,b.r+8.4,-Math.PI/2,-Math.PI/2+TAU*Math.min(1,b.chill/CM));ctx.stroke()}   // Chill: fills toward Freeze
 if(b.frozen>0){ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fillStyle=rgba(TH.effects.freeze||'#d9f4ff',.5);ctx.fill();ctx.lineWidth=2.2;ctx.strokeStyle=TH.effects.freeze||'#d9f4ff';ctx.stroke()}   // Frozen: an icy shell
 drawBallMarks(b,S);
 if(b.inv>0){ctx.lineWidth=2;ctx.strokeStyle=rgba(TH.page.gold,.8);ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(b.x,b.y,b.r+4,0,TAU);ctx.stroke();ctx.setLineDash([])}
 if(OPT.showHpOnBalls===false||b.r<8)return;
 let fs=Math.max(7,b.r*.84)*DFS,tc=dark(b.col)?TH.page.chalk:TH.page.ink;
 if(b.kind==='eight'&&!im){ctx.beginPath();ctx.arc(b.x,b.y,b.r*.58,0,TAU);ctx.fillStyle=TH.page.chalk;ctx.fill();tc=b.col;fs=b.r*.5*DFS}
 const s=fmt(b.hp);if(s.length>3)fs*=.72;
 ctx.font=fs+'px '+FONT_D;ctx.textAlign='center';ctx.textBaseline='middle';
 if(im){ctx.lineJoin='round';ctx.lineWidth=fs*.22;ctx.strokeStyle=INK;ctx.strokeText(s,b.x,b.y+fs*.07);ctx.fillStyle='#fff'}
 else ctx.fillStyle=b.flash>0?TH.page.ink:tc;
 ctx.fillText(s,b.x,b.y+fs*.07);
}
function draw(dt){
 const S=G.S,k=cv.width/AW,A=TH.arena;
 ctx.setTransform(k,0,0,k,0,0);ctx.imageSmoothingEnabled=OPT.smoothImages!==false;
 ctx.fillStyle=A.floor;ctx.fillRect(0,0,AW,AH);
 if(!S)return;
 if(shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake=Math.max(0,shake-dt*22)}
 if(IMG.floor)ctx.drawImage(IMG.floor,0,0,AW,AH);
 else if(A.dotsOpacity>0){ctx.fillStyle=rgba(A.dots,A.dotsOpacity);for(let x=30;x<AW;x+=30)for(let y=30;y<AH;y+=30)ctx.fillRect(x-1,y-1,2,2)}
 for(const m of S.marks){const c=m.src.col;ctx.beginPath();ctx.arc(m.x,m.y,m.r,0,TAU);ctx.fillStyle=rgba(c,.1+.2*(1-m.t/(m.t0||1)));ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=c;ctx.setLineDash([5,5]);ctx.stroke();ctx.setLineDash([])}
 for(let i=cracks.length-1;i>=0;i--){const c=cracks[i];c.l-=dt;if(c.l<=0){cracks.splice(i,1);continue}ctx.globalAlpha=Math.min(1,c.l/c.m*1.6);ctx.lineJoin='round';ctx.lineCap='round';
  if(PXL){const k=new Set();for(let j=1;j<c.pts.length;j++)pxLine(k,c.pts[j-1][0],c.pts[j-1][1],c.pts[j][0],c.pts[j][1]);const o=new Set();for(const q of k){const[a,b]=q.split(',').map(Number);for(const[u,v]of[[1,0],[-1,0],[0,1],[0,-1]])o.add((a+u)+','+(b+v))}pxFill(o,1,INK);pxFill(k,1,c.c)}
  else{ctx.beginPath();ctx.moveTo(c.pts[0][0],c.pts[0][1]);for(let k=1;k<c.pts.length;k++)ctx.lineTo(c.pts[k][0],c.pts[k][1]);ctx.lineWidth=4.5;ctx.strokeStyle=INK;ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle=c.c;ctx.stroke()}ctx.globalAlpha=1;ctx.lineCap='butt'}
 const pl=S.player;
 if(pl.alive&&pl.spd>330){trail.push({x:pl.x,y:pl.y});if(trail.length>12)trail.shift();trail.forEach((q,i)=>{if(PXL){const k=new Set();pxDisc(k,q.x,q.y,pl.r*(i/12));pxFill(k,1,rgba(pl.col,i/12*.25))}else{ctx.beginPath();ctx.arc(q.x,q.y,pl.r*(i/12),0,TAU);ctx.fillStyle=rgba(pl.col,i/12*.25);ctx.fill()}})}else if(trail.length)trail.shift();
 for(const b of S.balls)if(b.alive&&b.healT&&b.healT.alive){ctx.lineWidth=2;ctx.strokeStyle=rgba(DT.heal,.6);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.healT.x,b.healT.y);ctx.stroke()}
 drawArenaRules(S);stepLight(dt);frameLights(S,dt);
 for(const b of S.balls)if(b.alive)b._sh=ballShape(b,dt);
 if(PXL)pixelPass(S,dt);   // shadows and ball bodies as hard-edged pixel art
 else{drawShadows(S,ctx);for(const b of S.balls)if(b.alive&&!IMG['ball.'+b.kind])drawBody(b,dt,ctx,b._sh)}
 for(const b of S.balls){if(!b.alive)continue;drawTop(b,S);for(const w of b.ws)drawWeapon(b,w)}
 for(const p of S.projs){const im=IMG[p.team===0?'proj.player':'proj.enemy'];ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.ang||0);
  if(im){const L=14,h=L*im.height/im.width;ctx.drawImage(im,-L/2,-h/2,L,h)}
  else{ctx.fillStyle=p.team===0?TH.projectiles.player:TH.projectiles.enemy;ctx.strokeStyle=INK;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-5,-3);ctx.lineTo(-5,3);ctx.closePath();ctx.fill();ctx.stroke()}
  ctx.restore()}
 drawLightPass();
 for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.l-=dt;if(r.l<=0){rings.splice(i,1);continue}const q=1-r.l/r.m;ctx.globalAlpha=1-q;
  if(PXL){const k=new Set();pxRing(k,r.x,r.y,r.r*q);pxRing(k,r.x,r.y,r.r*q-PXL);pxFill(k,1,r.c)}else{ctx.lineWidth=3;ctx.strokeStyle=r.c;ctx.beginPath();ctx.arc(r.x,r.y,r.r*q,0,TAU);ctx.stroke()}ctx.globalAlpha=1}
 for(let i=zaps.length-1;i>=0;i--){const z=zaps[i];z.l-=dt;if(z.l<=0){zaps.splice(i,1);continue}
  const pts=[[z.x1,z.y1]];for(let s=1;s<5;s++){const q=s/5;pts.push([z.x1+(z.x2-z.x1)*q+(Math.random()-.5)*14,z.y1+(z.y2-z.y1)*q+(Math.random()-.5)*14])}pts.push([z.x2,z.y2]);
  if(PXL){const k=new Set();for(let s=1;s<pts.length;s++)pxLine(k,pts[s-1][0],pts[s-1][1],pts[s][0],pts[s][1]);pxFill(k,1,TH.effects.lightning)}
  else{ctx.lineWidth=2;ctx.strokeStyle=TH.effects.lightning;ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let s=1;s<pts.length;s++)ctx.lineTo(pts[s][0],pts[s][1]);ctx.stroke()}}
 for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.l-=dt;if(p.l<=0){parts.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.94;p.vy*=.94;ctx.globalAlpha=p.l/p.m;
  if(PXL){const n=p.r>2.6?2:1;ctx.fillStyle=p.c;ctx.fillRect(pxSnap(p.x),pxSnap(p.y),n*PXL,n*PXL)}else{ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.fill()}ctx.globalAlpha=1}   // pixel squares, 1 or 2 pixels
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
 for(let i=floats.length-1;i>=0;i--){const f=floats[i];f.l-=dt;if(f.l<=0){floats.splice(i,1);continue}if(!f.still)f.y-=26*dt;const q=f.l/f.m;ctx.globalAlpha=Math.min(1,q*2.2);ctx.font=f.body?f.z+'px '+FONT_B:f.z*DFS+'px '+FONT_D;ctx.lineWidth=2.6;ctx.strokeStyle=INK;ctx.strokeText(f.s,clampX(f.x),f.y);ctx.fillStyle=f.c;ctx.fillText(f.s,clampX(f.x),f.y);ctx.globalAlpha=1}
 ctx.setTransform(k,0,0,k,0,0);
 if(S.boss&&!S.preview){let hp=0;for(const b of S.balls)if(b.alive&&b.boss)hp+=b.hp;const q=clamp(hp/S.boss.maxhp,0,1);
  ctx.fillStyle=rgba(INK,.7);ctx.fillRect(60,8,AW-120,9);ctx.fillStyle=TH.page.mult;ctx.fillRect(61,9,(AW-122)*q,7);
  ctx.font='8px '+FONT_B;ctx.fillStyle=TH.page.chalk;ctx.textAlign='center';ctx.fillText(S.bossDef.name.toUpperCase(),AW/2,24);
  if(S.bossNote){ctx.fillStyle=TH.page.gold;ctx.fillText(S.bossNote,AW/2,34)}}   // boss state: armor left, socket switched off, what it resists...
 if(S.overtime>1&&!S.done){ctx.font=10*DFS+'px '+FONT_D;ctx.fillStyle=TH.page.accent;ctx.textAlign='center';ctx.fillText(t('overtime',{mult:S.overtime.toFixed(1)}),AW/2,AH-12)}
 if(S.preview||S.demo){ctx.font='9px '+FONT_B;ctx.fillStyle=rgba(TH.page.chalk,.55);ctx.textAlign='center';ctx.fillText(S.preview?TX.warmup:TX.demo,AW/2,AH-10)}
}
const clampX=x=>clamp(x,14,AW-14);

/* Updates the few HTML bits that change during a fight: the Power × Mult readout, HP bar, ramp line, augment flashes. */
function liveDom(){
 const S=G.S;if(!S||S.preview||!['fight','payout','over','victory'].includes(G.phase))return;
 if(G.phase==='fight'&&S.last&&S.last.n!==lastN){lastN=S.last.n;const L=S.last;const rp=$('#roP'),rm=$('#roM'),d=$('#roD');if(rp)rp.textContent=num(L.p);if(rm)rm.textContent='×'+num(L.m);if(d){d.textContent=fmt(L.d)+(L.c?'!':'')}
  if(d&&!reduce){d.classList.remove('bump');void d.offsetWidth;d.classList.add('bump')}}
 if(++liveTick%4)return;
 const run=G.run,p=S.player,hf=$('#hpfill');
 if(G.admin){const n=$('#adm-note');if(n){const s=impactNote();if(n.textContent!==s)n.textContent=s}}
 if(hf){liveStats(S);hf.style.width=clamp(p.hp/p.maxhp*100,0,100)+'%';$('#hptxt').textContent=fmt(Math.max(0,p.hp))+' / '+fmt(p.maxhp);
  const R=S.ramp,N=TX.statNames,bits=[];if(R.pow)bits.push('+'+num(R.pow)+' '+N.power);if(R.mult)bits.push('+'+num(R.mult)+' '+N.mult);if(R.spin>1)bits.push('+'+Math.round((R.spin-1)*100)+'% '+N.spin);if(R.reach)bits.push('+'+Math.round(R.reach)+' '+N.reach);if(R.arrows>=1)bits.push('+'+Math.floor(R.arrows)+' '+TX.arrows);if(R.spd>0)bits.push('+'+Math.round(R.spd*100)+'% '+N.speed);if(R.crit>0)bits.push('+'+Math.round(R.crit*100)+'% '+N.crit);
  $('#rampline').innerHTML='<b>'+TX.rampLabel+'</b> '+(bits.length?rich(bits.join(', ')):TX.rampNothing)+(S.chill<1?' · '+t('chilled',{percent:Math.round(S.chill*100)}):'')}
 {const ev=$('#evtrack');if(ev){const C=S.count||{},v={hits:C.hits||0,bounces:C.bounces||0,crits:C.crits||0,collisions:(C.collisions||0)+(C.enemyCollisions||0),kills:C.kills||0},top=Math.max(...Object.values(v));
  for(const sp of ev.querySelectorAll('[data-ev]')){const k=sp.dataset.ev,em=sp.querySelector('em');if(em.textContent!==''+v[k])em.textContent=v[k];sp.classList.toggle('top',v[k]===top&&top>0)}}}   // event counts for Singularity, Eight-Ball Rack, Kinetic Battery
 if(G.phase!=='fight')return;
 run.augs.forEach((a,i)=>{const el=document.getElementById('aug'+i);if(!el)return;if(S.off)el.classList.toggle('off',S.off.has(a));el.classList.toggle('on',S.pulses[i]!=null&&S.t-S.pulses[i]<.3);
  const sh=a.id==='mirror'&&a.sh&&AUG[a.sh.id]?a.sh:null,d=AUG[sh?sh.id:a.id],lv=document.getElementById('lv'+i);if(lv&&d&&d.live){const s=d.live(sh||a,S,d.v)||'';if(lv.textContent!==s)lv.textContent=s}});
}

/* ---------- 7. main loop ---------- */
/* Each animation frame: run as many fixed 1/120s steps as the speed setting asks for, then draw once. */
let last=0,acc=0;
function frame(ts){
 const dt=Math.min(.05,(ts-last)/1000||0);last=ts;
 const S=G.S;
 if(S&&!(G.paused&&G.phase==='fight')){
  const sp=G.phase==='fight'?G.speed:1;
  if(G.hold>0)G.hold-=dt;   // impact frame: the fight stands still in real time, whatever the speed setting
  else{acc+=dt*sp;let n=0;
   while(acc>=H&&n<480){acc-=H;n++;if(S.freeze>0&&sp<=2&&!reduce){S.freeze-=H;continue}S.freeze=0;step(S,H);if(S.done)break;if(S.hold){S.hold=false;acc=0;break}}
   if(n>=480)acc=0}
  drain(S);
  if(G.phase==='fight'&&S.done&&G.hold<=0){acc=0;endFight()}
  if(G.phase==='title'&&S.done){G.demoWait+=dt;if(G.demoWait>1.6){G.demoWait=0;startDemo()}}
 }
 Impact.tick(performance.now());holdTick(performance.now());
 {const t0=performance.now();draw(G.hold>0?0:dt);watchFrame(performance.now()-t0,dt)}Impact.draw();liveDom();
 requestAnimationFrame(frame);
}
function fit(){
 const stage=$('.stage'),arena=$('#arena'),wide=window.matchMedia('(min-width: 900px)').matches;
 const avail=wide?Math.max(240,stage.clientHeight-(viewtabs.hidden?0:viewtabs.offsetHeight+12)):9999;   // the Shop / Warm-up tabs sit above the arena
 arena.style.width=Math.min(stage.clientWidth,avail)+'px';
 const px=Math.round(arena.clientWidth*Math.min(2,window.devicePixelRatio||1));
 if(px>0&&cv.width!==px){cv.width=px;cv.height=px}
}
window.addEventListener('resize',fit);
/* Clicking your own ball in the arena opens or closes the live stats during a fight, and brings the Your ball card into view in the shop. */
function onBall(e){
 const S=G.S,p=S&&S.player;if(!p||!p.alive||G.phase==='title'||S.demo)return false;
 const r=cv.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*AW,y=(e.clientY-r.top)/r.height*AH;
 return Math.hypot(x-p.x,y-p.y)<=p.r+8;   // a little slack: the ball is moving
}
cv.addEventListener('pointermove',e=>{const on=onBall(e);if(cv.style.cursor!==(on?'pointer':''))cv.style.cursor=on?'pointer':''});
cv.addEventListener('click',e=>{
 if(!onBall(e))return;
 const how={block:'nearest',behavior:reduce?'auto':'smooth'};
 if(G.phase==='fight'){G.statsOpen=!G.statsOpen;savePrefs();const f=$('#livestats'),bt=$('[data-act="stats"]');
  if(f)f.classList.toggle('open',G.statsOpen);if(bt)bt.setAttribute('aria-expanded',G.statsOpen);const c=$('.ballcard');if(c&&G.statsOpen)c.scrollIntoView(how)}
 else{const c=$('#yourball');if(c){c.scrollIntoView(how);c.classList.remove('flash');void c.offsetWidth;c.classList.add('flash')}}
});
if(window.ResizeObserver)new ResizeObserver(fit).observe($('.stage'));

/* data is the last snapshot when the page is hot-swapped to a new version, or {} on a fresh load. */
function start(data){
 loadPrefs();applyTheme();loadAssets();
 const r=data&&data.run,usable=r&&r.enc&&r.shop&&WEAPONS[r.weapon]&&r.augs.every(a=>AUG[a.id])&&r.trophies.every(id=>TROPHY[id]);
 if(usable){G.run=r;try{if(r.pending){r.pending=r.pending.filter(id=>TROPHY[id]);if(!r.pending.length)r.pending=null}if(r.plan&&r.planTier===r.tier&&r.plan[r.stage])r.enc=r.plan[r.stage];else planTier(r);rollShop(r);fit();toPrep()}catch(e){fit();toTitle()}}else{fit();toTitle()}
 window.GAME_STARTED=true;
 requestAnimationFrame(frame);
}
const hot=window.claude&&window.claude.hot;
if(hot&&hot.snapshot)hot.snapshot(()=>({run:G.run&&G.phase!=='over'?JSON.parse(JSON.stringify(G.run)):null}));
if(hot&&hot.ready)hot.ready(start);else start((hot&&hot.data)||{});
})();
