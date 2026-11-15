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
 peek:null};       // stage (0, 1, 2) of a later fight in this tier being previewed in the shop, or null for the current one
const cv=$('#cv'),ctx=cv.getContext('2d'),side=$('#side'),overlay=$('#overlay'),chips=$('#chips');
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
 $('#lblP').textContent=TX.readoutPower;$('#lblM').textContent=TX.readoutMult;$('#lblD').textContent=TX.readoutLast;
}
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('ricochet-rogue')||'{}');G.muted=!!p.muted;G.speed=[1,2,4,8].includes(p.speed)?p.speed:1;G.best=p.best||0;G.admin=!!p.admin;G.statsOpen=!!p.statsOpen;G.forceMotion=!!p.forceMotion;G.bdOpen=p.bdOpen!==false}catch(e){}setMotion()}
function savePrefs(){try{localStorage.setItem('ricochet-rogue',JSON.stringify({muted:G.muted,speed:G.speed,best:G.best,admin:G.admin,statsOpen:G.statsOpen,forceMotion:!!G.forceMotion,bdOpen:G.bdOpen!==false}))}catch(e){}}

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
document.addEventListener('error',e=>{const el=e.target;if(el&&el.tagName==='IMG'&&el.classList.contains('icon')){assetFail(el.getAttribute('src'));el.remove()}},true);
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
function rich(s){
 if(!kwRe||TX.colorKeywords===false)return s;
 return String(s).replace(kwRe,(m,n,word)=>{
  if(!word)return KW.money?'<b class="kw" style="color:'+KW.money+'">'+m+'</b>':m;
  const def=KDEF[word]?tpl(KDEF[word]).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'):'';
  return'<b class="kw" style="color:'+KW[word]+'"'+(def?' data-tip="'+def+'"':'')+'>'+m+'</b>'})
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
 G.phase=run.pending?'trophy':'prep';G.peek=null;previewFight();render();
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
function statBlock(run){
 const P=calcPlayer(run,null),W=P.W,N=TX.statNames;
 const row=(k,v)=>`<div><dt>${k}</dt><dd>${v}</dd></div>`;
 return `<section class="card" id="yourball"><h3>${TX.yourBall} <span>${W.name}${P.blades>1&&!W.fist?' ×'+P.blades:''}</span></h3>
  <p class="ramp"><b>${TX.rampLabel}</b> ${rich(W.ramp)}${P.rampX>1?' (×'+num(P.rampX)+')':''}. ${TX.rampResets}</p>
  <dl class="stats">${row(N.hp,P.hp)}${row(N.power,num(P.pow))}${row(N.mult,'×'+num(P.mult))}${row(N.crit,Math.round(P.crit*100)+'%')}
  ${row(N.speed,Math.round(P.spd))}${row(N.spin,num(P.spin))}${row(N.reach,Math.round(P.reach))}${row(N.armor,num(P.armor))}${row(N.regen,num(P.regen)+'/s')}${row(N.knock||'Knockback',Math.round(P.kb))}${row(N.impact||'Impact',Math.round(P.impact))}</dl></section>`;
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
 let h=`<section class="card next${b?' is-boss':''}${pk!=null?' peeking':''}"><div class="eyebrow"><span>${TX.chipTier} ${run.tier}${run.endless?' · '+TX.endless:''}</span>${pk!=null?`<span class="peek-tag">${TX.previewTag||'Preview'}</span>`:''}</div>
  <div class="steps">${steps}</div>`;
 if(b)h+=`<h2>${b.name}</h2><p class="rule">${rich(b.rule)}</p>${bossNotes(b)}${enc.list.length?`<p class="with">${TX.bossBrings} ${encSummary(enc)}.</p>`:''}`;
 else h+=`<h2>${encSummary(enc)}</h2>${encNotes(enc)}`;
 h+=nextBosses(run);
 if(shop&&(run.bag||[]).length)h+=`<div class="bag"><b>${tpl(TX.bagTitle||'Items {n}/{max}',{n:run.bag.length,max:CONS.bagSize})}</b> <span class="with">${TX.bagHint||'Switch on to use in the next fight.'}</span><div class="row">${run.bag.map((x,i)=>{const d=ITEM[x.id];return d?`<button data-act="item-use" data-i="${i}" aria-pressed="${!!x.use}" data-tip="${esc(d.desc+' '+tpl(TX.itemSellTip||'Right-click: sell for ${gold}',{gold:Math.floor(d.cost/2)}))}">${icon('items',x.id)}${d.name}</button>`:''}).join('')}</div></div>`;
 if(shop)h+=pk!=null?`<button class="go back" data-act="peek" data-i="${run.stage}" data-primary>${TX.jumpToCurrent||'Jump to current'}</button>`:`<button class="go" data-act="fight" data-primary>${TX.fightButton}</button>`;
 return h+'</section>';
}
function shopCard(run){
 const sh=run.shop,full=run.augs.length>=run.slots,E=RULES.economy;
 let h=`<section class="card shop"><h3>${TX.shopTitle} <span>${TX.shopYouHave} <b class="gold">$${run.gold}</b></span></h3><div class="offers">`;
 sh.offers.forEach((o,i)=>{const d=AUG[o.id];if(!d)return;const c=augCost(run,o.id);
  h+=augCard({id:o.id,kind:'offer',i,tag:'div',cls:o.sold?' sold':'',
   foot:`<button class="buy" data-act="buy" data-i="${i}" ${o.sold||full||run.gold<c?'disabled':''}>${o.sold?`<small>${TX.sold}</small>`:full?`<small>${TX.noSocket}</small>`:`<small>${TX.buy}</small><b>$${c}</b>`}</button>`})});
 h+='</div><div class="tunes">';
 sh.tunes.forEach((tu,i)=>{const d=TUNE[tu.k],c=tuneCost(run,tu.k);
  h+=`<div class="tune${tu.sold?' sold':''}">${icon('tuneUps',tu.k)}<div><b>${d.name}</b><span>${rich(d.desc)}${TX.tuneUpSuffix}</span></div><button class="buy" data-act="tune" data-i="${i}" ${tu.sold||run.gold<c?'disabled':''}>${tu.sold?TX.sold:'$'+c}</button></div>`});
 h+='</div>';
 if(sh.items&&sh.items.length){const full=(run.bag||[]).length>=CONS.bagSize;h+=`<div class="tunes items">`;
  sh.items.forEach((o,i)=>{const d=ITEM[o.id];if(!d)return;h+=`<div class="tune${o.sold?' sold':''}">${icon('items',o.id)}<div><b>${d.name}</b><span>${rich(d.desc)}</span></div><button class="buy" data-act="item" data-i="${i}" ${o.sold||full||run.gold<d.cost?'disabled':''}>${o.sold?TX.sold:full?(TX.bagFull||'Bag full'):'$'+d.cost}</button></div>`});h+='</div>'}
 const int=Math.min(run.intCap,Math.floor(run.gold/E.interestPerGold));
 h+=`<div class="shop-f"><button data-act="reroll" ${run.gold<sh.reroll?'disabled':''}>${TX.reroll} $${sh.reroll}</button><span>${t('shopInterest',{per:E.interestPerGold,cap:run.intCap,now:int})}</span></div></section>`;
 return h;
}
function titlePanel(){
 let h=`<section class="card hero"><h1>${TX.heroHeadline}</h1>${TX.heroBody?`<p>${t('heroBody',{tiers:RULES.run.tiersToWin})}</p>`:''}
  ${G.best?`<p class="best">${t('bestRun',{tier:G.best})}</p>`:''}</section>`;
 if(G.assetErrors.length)h+=`<section class="card warn"><h3>Some files did not load</h3><p>The game is using its built-in look for these. Check the paths in game-data.json:</p><ul>${G.assetErrors.map(s=>`<li>${s}</li>`).join('')}</ul></section>`;
 h+=`<section class="card"><h3>${TX.pickWeapon} <span>${TX.pickWeaponHint}</span></h3><div class="weapons">`;
 for(const k of Object.keys(WEAPONS)){const w=WEAPONS[k];
  h+=`<button class="weapon" data-act="weapon" data-w="${k}">${icon('weapons',k)}<b>${w.name}</b><span class="wstat">${TX.statNames.power} ${w.pow}${w.fist?'':' · '+TX.statNames.spin+' '+w.spin}${w.kb?' · '+(TX.statNames.knock||'Knockback')+' '+w.kb:''}${w.impact?' · '+(TX.statNames.impact||'Impact')+' '+w.impact:''}</span><span>${w.blurb}</span><span class="wramp">${TX.rampLabel}: ${w.ramp}</span></button>`}
 h+=`</div></section><section class="card how"><h3>${TX.howTitle}</h3><p>${rich(TX.howBody)}</p><dl class="gloss">${Object.keys(KDEF).filter(k=>k[0]!=='_').map(k=>`<div><dt${KW[k]?' style="color:'+KW[k]+'"':''}>${k}</dt><dd>${tpl(KDEF[k])}</dd></div>`).join('')}</dl></section>`;
 return h;
}
function fightPanel(run){
 const S=G.S,N=TX.statNames;
 return nextCard(run,'fight')+adminCard(run)+`<section class="card ballcard"><h3>${TX.yourBall} <span>${S.P.W.name}</span>
   <button class="fold-btn" data-act="stats" aria-expanded="${G.statsOpen}" aria-controls="livestats">${TX.statsToggle||'Stats'}<i></i></button></h3>
  <div class="hpbar"><i id="hpfill"></i><b id="hptxt"></b></div><p class="ramp" id="rampline"></p>
  <div class="fold${G.statsOpen?' open':''}" id="livestats"><div><dl class="stats livegrid">${LIVE.map(l=>`<div id="ls-${l[0]}"><dt>${N[l[0]]}</dt><dd><b>–</b><small></small></dd></div>`).join('')}</dl></div></div></section>`+augList(run,'fight');
}
function renderCtl(){
 $('#speed').innerHTML=[1,2,4,8].map(v=>`<button data-act="speed" data-v="${v}" aria-pressed="${G.speed===v}">${v}×</button>`).join('');
 $('#pause').textContent=G.paused?TX.resume:TX.pause;$('#pause').setAttribute('aria-pressed',G.paused);
 $('#mute').textContent=G.muted?TX.soundOff:TX.soundOn;$('#mute').setAttribute('aria-pressed',!G.muted);
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
 const seen=new Set(keys.map(idOf)),rest=[...new Set(run.augs.map(a=>a.id))].filter(id=>AUG[id]&&!seen.has(id)).map(id=>AUG[id].name+(T[id]?' ('+tpl(TX.breakdownTriggered||'{n}×',{n:T[id]})+')':''));
 return`<details class="bd" id="bd"${G.bdOpen!==false?' open':''}><summary>${TX.breakdownTitle||'Damage breakdown'} <b>${fmt(total)}</b></summary>
  <h4>${TX.breakdownDealt||'Dealt by'}</h4><ul class="pay">${rows(dealt,false)}</ul>
  ${added.length?`<h4 data-tip="${esc(TX.breakdownAddedTip||'')}">${TX.breakdownAdded||'Added by'}</h4><ul class="pay">${rows(added,true)}</ul>`:''}
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
 const run=G.run,keep=side.scrollTop;
 document.body.dataset.phase=G.phase;
 if(G.phase==='title')side.innerHTML=titlePanel();
 else if(G.phase==='prep')side.innerHTML=nextCard(run,'prep')+adminCard(run)+shopCard(run)+augList(run,'prep')+statBlock(run);
 else if(G.phase==='trophy')side.innerHTML=nextCard(run,'x')+augList(run,'x')+statBlock(run);
 else side.innerHTML=fightPanel(run);
 side.scrollTop=keep;
 renderChips();renderCtl();renderOverlay();syncMusic();fixTips();
 $('#readout').classList.toggle('idle',G.phase!=='fight');
 if(G.phase!=='fight'){$('#roP').textContent='–';$('#roM').textContent='–';$('#roD').textContent='–'}
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
   <div class="tags ac-clip"><span class="tg">${rn} · ${d.tags.join(' · ')}</span>${o.notes||''}</div>
  </div>${o.foot||''}</div></${o.tag}>`;
}
/* Text that did not fit on a card (class ac-clip) gets its full wording as a hint, followed by data-tip-extra. Runs after the side panel is rebuilt or resized. */
function fixTips(){
 for(const el of side.querySelectorAll('.ac-clip')){
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
 ['mult',S=>S.P.mult+S.ramp.mult,v=>'×'+r2(v),r2],
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
  else if(e.k==='ring')rings.push({x:e.x,y:e.y,r:e.r,c:e.col,l:.35,m:.35});
  else if(e.k==='zap')zaps.push({x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,l:.16});
  else if(e.k==='impact'){if(!S.demo&&!S.preview)Impact.trigger(e)}
  else if(e.k==='quake'){   // Earthquake: two ripples and a few cracks running in from the wall that was hit, plus a shake in real fights
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
function drawBallMarks(b,S){
 if(b.tele>0){ctx.lineWidth=2.5;ctx.strokeStyle=rgba('#ffffff',.5+.5*Math.sin(S.t*40));ctx.beginPath();ctx.arc(b.x,b.y,b.r+5,0,TAU);ctx.stroke()}
 if(b.fuse!=null){ctx.lineWidth=2.5;ctx.strokeStyle=rgba(TH.damageText.burn,.6+.4*Math.sin(S.t*30));ctx.beginPath();ctx.arc(b.x,b.y,b.r+4+(1-b.fuse)*6,0,TAU);ctx.stroke()}
 if(b.kind==='stabber'&&b.ready){ctx.lineWidth=1.2;ctx.strokeStyle=rgba(TH.page.chalk,.7);ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(b.x,b.y,b.r+3,0,TAU);ctx.stroke();ctx.setLineDash([])}
 if(b.elite){ctx.lineWidth=2;ctx.strokeStyle=TH.page.gold;ctx.beginPath();ctx.arc(b.x,b.y,b.r+3.5,0,TAU);ctx.stroke()}
 if(b.shieldOn){const a=Math.atan2(b.vy,b.vx),w=(S.bossDef&&S.bossDef.v.shieldArc)||1.1;ctx.lineCap='round';ctx.lineWidth=8;ctx.strokeStyle=INK;ctx.beginPath();ctx.arc(b.x,b.y,b.r+7,a-w,a+w);ctx.stroke();ctx.lineWidth=5;ctx.strokeStyle=TH.weapons.shield;ctx.beginPath();ctx.arc(b.x,b.y,b.r+7,a-w,a+w);ctx.stroke();ctx.lineCap='butt'}
}
function drawWeapon(b,w){
 ctx.save();ctx.translate(b.x,b.y);ctx.rotate(w.ang);if(w.mult>1){ctx.shadowColor=TH.page.gold;ctx.shadowBlur=10}   // a braced Lancer's spear glows
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
function drawBall(b,S,dt){
 const im=IMG['ball.'+b.kind],A=TH.arena,sh=ballShape(b,dt||0);
 if(sh){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(sh.a);ctx.scale(sh.sx,sh.sy);ctx.rotate(-sh.a);ctx.translate(-b.x,-b.y)}
 if(im){
  ctx.drawImage(im,b.x-b.r,b.y-b.r,b.r*2,b.r*2);
  if(b.flash>0){ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fillStyle='#fff';ctx.fill();ctx.globalAlpha=1}
  if(OPT.ballOutlineOnSprites){ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.lineWidth=b.player||b.boss?2.6:1.8;ctx.strokeStyle=b.player?A.playerOutline:b.boss?A.bossOutline:A.outline;ctx.stroke()}
 }else{
  ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fillStyle=b.flash>0?'#fff':b.col;ctx.fill();
  ctx.lineWidth=b.player||b.boss?2.6:1.8;ctx.strokeStyle=b.player?A.playerOutline:b.boss?A.bossOutline:A.outline;ctx.stroke();
 }
 if(sh)ctx.restore();
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
  ctx.beginPath();ctx.moveTo(c.pts[0][0],c.pts[0][1]);for(let k=1;k<c.pts.length;k++)ctx.lineTo(c.pts[k][0],c.pts[k][1]);ctx.lineWidth=4.5;ctx.strokeStyle=INK;ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle=c.c;ctx.stroke();ctx.globalAlpha=1;ctx.lineCap='butt'}
 const pl=S.player;
 if(pl.alive&&pl.spd>330){trail.push({x:pl.x,y:pl.y});if(trail.length>12)trail.shift();trail.forEach((q,i)=>{ctx.beginPath();ctx.arc(q.x,q.y,pl.r*(i/12),0,TAU);ctx.fillStyle=rgba(pl.col,i/12*.25);ctx.fill()})}else if(trail.length)trail.shift();
 for(const b of S.balls)if(b.alive&&b.healT&&b.healT.alive){ctx.lineWidth=2;ctx.strokeStyle=rgba(DT.heal,.6);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.healT.x,b.healT.y);ctx.stroke()}
 drawArenaRules(S);
 for(const b of S.balls){if(!b.alive)continue;drawBall(b,S,dt);for(const w of b.ws)drawWeapon(b,w)}
 for(const p of S.projs){const im=IMG[p.team===0?'proj.player':'proj.enemy'];ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.ang||0);
  if(im){const L=14,h=L*im.height/im.width;ctx.drawImage(im,-L/2,-h/2,L,h)}
  else{ctx.fillStyle=p.team===0?TH.projectiles.player:TH.projectiles.enemy;ctx.strokeStyle=INK;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-5,-3);ctx.lineTo(-5,3);ctx.closePath();ctx.fill();ctx.stroke()}
  ctx.restore()}
 for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.l-=dt;if(r.l<=0){rings.splice(i,1);continue}const q=1-r.l/r.m;ctx.globalAlpha=1-q;ctx.lineWidth=3;ctx.strokeStyle=r.c;ctx.beginPath();ctx.arc(r.x,r.y,r.r*q,0,TAU);ctx.stroke();ctx.globalAlpha=1}
 for(let i=zaps.length-1;i>=0;i--){const z=zaps[i];z.l-=dt;if(z.l<=0){zaps.splice(i,1);continue}ctx.lineWidth=2;ctx.strokeStyle=TH.effects.lightning;ctx.beginPath();ctx.moveTo(z.x1,z.y1);for(let s=1;s<5;s++){const q=s/5;ctx.lineTo(z.x1+(z.x2-z.x1)*q+(Math.random()-.5)*14,z.y1+(z.y2-z.y1)*q+(Math.random()-.5)*14)}ctx.lineTo(z.x2,z.y2);ctx.stroke()}
 for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.l-=dt;if(p.l<=0){parts.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.94;p.vy*=.94;ctx.globalAlpha=p.l/p.m;ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.fill();ctx.globalAlpha=1}
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
 if(G.phase==='fight'&&S.last&&S.last.n!==lastN){lastN=S.last.n;const L=S.last;$('#roP').textContent=num(L.p);$('#roM').textContent='×'+num(L.m);const d=$('#roD');d.textContent=fmt(L.d)+(L.c?'!':'');
  if(!reduce){d.classList.remove('bump');void d.offsetWidth;d.classList.add('bump')}}
 if(++liveTick%4)return;
 const run=G.run,p=S.player,hf=$('#hpfill');
 if(G.admin){const n=$('#adm-note');if(n){const s=impactNote();if(n.textContent!==s)n.textContent=s}}
 if(hf){liveStats(S);hf.style.width=clamp(p.hp/p.maxhp*100,0,100)+'%';$('#hptxt').textContent=fmt(Math.max(0,p.hp))+' / '+fmt(p.maxhp);
  const R=S.ramp,N=TX.statNames,bits=[];if(R.pow)bits.push('+'+num(R.pow)+' '+N.power);if(R.mult)bits.push('+'+num(R.mult)+' '+N.mult);if(R.spin>1)bits.push('+'+Math.round((R.spin-1)*100)+'% '+N.spin);if(R.reach)bits.push('+'+Math.round(R.reach)+' '+N.reach);if(R.arrows>=1)bits.push('+'+Math.floor(R.arrows)+' '+TX.arrows);if(R.spd>0)bits.push('+'+Math.round(R.spd*100)+'% '+N.speed);if(R.crit>0)bits.push('+'+Math.round(R.crit*100)+'% '+N.crit);
  $('#rampline').innerHTML='<b>'+TX.rampLabel+'</b> '+(bits.length?rich(bits.join(', ')):TX.rampNothing)+(S.chill<1?' · '+t('chilled',{percent:Math.round(S.chill*100)}):'')}
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
 draw(G.hold>0?0:dt);Impact.draw();liveDom();
 requestAnimationFrame(frame);
}
function fit(){
 const stage=$('.stage'),arena=$('#arena'),wide=window.matchMedia('(min-width: 900px)').matches;
 const avail=wide?Math.max(240,stage.clientHeight-$('#readout').offsetHeight-14):9999;
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
