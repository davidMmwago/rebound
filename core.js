'use strict';
/* Rebound: simulation and run logic. No DOM in this file.
   Every number and player-facing sentence comes from game-data.json (GAME_DATA).
   This file holds only behaviour: physics, the hit pipeline, and what each augment and boss does.
   Sections: 1 data tables, 2 enemies and bosses, 3 augments, 4 hook dispatch, 5 fight simulation, 6 run and shop. */
const DATA=(typeof module!=='undefined'&&typeof window==='undefined')?require('./game-data.json'):window.GAME_DATA;
const RULES=DATA.rules,AW=RULES.arena.size,AH=AW,TAU=Math.PI*2;
const HS=RULES.scaling.enemyHpPerTier,DS=RULES.scaling.enemyDamagePerTier,BHS=RULES.scaling.bossHpPerTier,BH0=RULES.scaling.bossHpFactor;
/* Endless mode: every tier after the last normal one multiplies enemy HP (bosses too) and damage once more, on top of the usual per-tier growth.
   That extra multiplier itself grows by endlessAcceleration each tier, so difficulty climbs faster and faster.
   Endless tier k (1 = the first after the final boss) gets HP x endlessHpPerTier^k x (1+endlessAcceleration)^(k(k-1)/2); damage the same with endlessDamagePerTier. */
function endlessScale(T){
 const SC=RULES.scaling,k=T-RULES.run.tiersToWin;if(k<=0)return{hp:1,dmg:1};
 const acc=Math.pow(1+(SC.endlessAcceleration||0),k*(k-1)/2);
 return{hp:Math.pow(SC.endlessHpPerTier||1,k)*acc,dmg:Math.pow(SC.endlessDamagePerTier||1,k)*acc};
}
/* Late-game push: from tier lateFromTier on, every tier multiplies enemy and boss HP by lateHpPerTier and damage by lateDamagePerTier once more,
   on top of the usual growth, so a build that has come online still meets resistance in the last tiers. All optional (missing means none). */
function lateScale(T){const SC=RULES.scaling,k=Math.max(0,T-(SC.lateFromTier||Infinity)+1);return{hp:Math.pow(SC.lateHpPerTier||1,k),dmg:Math.pow(SC.lateDamagePerTier||1,k)}}
/* All tier scaling in one place: hs (enemy HP), bhs (boss HP before bossHpFactor) and ds (damage) for tier T. With endlessReplacesGrowth, endless tiers keep
   the usual growth, the late push and the spike where they were at the last normal tier, and only the endless multiplier grows on top.
   The spike (spikeFromTier on) multiplies HP by spikeHpPercent and damage by spikeDamagePercent. */
function tierScale(T){const SC=RULES.scaling,G=RULES.run.tiersToWin,Tb=SC.endlessReplacesGrowth&&T>G?G:T,E=endlessScale(T),L=lateScale(Tb),sp=Tb>=(SC.spikeFromTier||Infinity),
 sh=sp?(SC.spikeHpPercent||100)/100:1,sd=sp?(SC.spikeDamagePercent||100)/100:1,sb=sp?(SC.spikeBossHpPercent||100)/100:1;   // spikeBossHpPercent: bosses only, on top
 return{hs:Math.pow(HS,Tb-1)*E.hp*L.hp*sh,bhs:Math.pow(BHS,Tb-1)*E.hp*L.hp*sh*sb,ds:Math.pow(DS,Tb-1)*E.dmg*L.dmg*sd}}
const CORE_PROBLEMS=[];
/* Caps on the player's side: Speed, Spin, blades, projectiles per volley and the share of a hit Armor can block. A cap Legendary (Escape Velocity,
   Cyclone, Arsenal, Barrage, Adamant) removes one while you own it (uncapped()). Without a cap, rules.uncapped still keeps the physics sane. */
const CAP_KEYS=['spd','spin','blades','volley','armor'];
function baseCap(k){const CB=RULES.combat;return k==='spd'?CB.maxPlayerSpeed:k==='spin'?CB.maxSpin:k==='blades'?4:k==='volley'?RULES.projectiles.maxPerVolley:CB.armorMaxReductionPercent}
/* Is this cap removed? Only while a cap Legendary for it sits in your sockets (selling it brings the cap back). */
function uncapped(run,k){return!!(run&&run.augs&&run.augs.some(a=>AUG[a.id]&&AUG[a.id].uncap===k))}
function capOf(run,k){if(uncapped(run,k)){const U=RULES.uncapped||{};return k==='spd'?(U.speed||1600):k==='spin'?(U.spin||120):k==='blades'?(U.blades||16):k==='volley'?(U.volley||40):100}return baseCap(k)+capRaise(run,k)}
/* Cap tune-ups (tuneUps entries with "cap"): each purchase raises that cap by its amount for the rest of the run. Armor's cap never goes past 95%. */
function capRaise(run,k){if(!run||!run.tune)return 0;let r=0;for(const id in TUNE)if(TUNE[id].cap===k)r+=TUNE[id].amount*(run.tune[id]||0);return k==='armor'?Math.min(r,95-baseCap(k)):r}
/* Impact frames (DATA.impact). The simulation only reports big hits; ui.js decides what to show. */
const IMP=DATA.impact&&DATA.impact.enabled!==false&&Array.isArray(DATA.impact.levels)&&DATA.impact.levels.length?DATA.impact:null;
const IMP_MIN=IMP?Math.min.apply(null,IMP.levels.map(l=>l.minPercentOfMaxHp)):Infinity;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const dkeys=o=>Object.keys(o).filter(k=>k[0]!=='_');
let UID=0;
/* Seeded random. o is any object with a numeric .rs field (a run, or a throwaway {rs}). */
function rnd(o){let a=o.rs=(o.rs+0x6D2B79F5)|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
const pick=(o,arr)=>arr[rnd(o)*arr.length|0];
/* Short form of any number the player sees: 950, 1.5k, 12.3k, 456k, 4.56M, 7.89B, 1.23T, then 1.23e15. Infinity shows as INF, a broken number as ?.
   Below 1000 it rounds up, so an enemy on 0.3 HP shows 1. Used by ui.js for every number on screen. */
const SUFFIX=['','k','M','B','T'];
function short(n){
 if(n!==n)return'?';if(n===Infinity)return'INF';if(n===-Infinity)return'-INF';
 const sg=n<0?'-':'',a=Math.abs(n);
 if(a<1000)return sg+Math.ceil(a);
 if(a>=1e15)return sg+a.toExponential(2).replace('e+','e').replace(/\.?0+e/,'e');
 let e=Math.floor(Math.log10(a)/3),v=a/Math.pow(1000,e);
 let r=v<10?Math.round(v*100)/100:v<100?Math.round(v*10)/10:Math.round(v);
 if(r>=1000){e++;r=1}
 return e>=SUFFIX.length?sg+a.toExponential(2).replace('e+','e'):sg+r+SUFFIX[e];
}
const f1=n=>Math.abs(n)>=1e4?short(n):(Math.round(n*100)/100).toString();

/* ---------- 1. data tables ---------- */
/* Chill and Freeze (rules.status): an enemy status. Each Chill stack slows the enemy's movement and blades; at chillMax stacks it is Frozen
   (cannot move, swing, shoot or ram) for freezeSeconds (bosses half as long) and the Chill resets. Chill fades over time. */
const ST=Object.assign({chillSlowPercent:5,chillMax:10,chillFadePerSecond:1,freezeSeconds:1,bossFreezePercent:50,shockPercent:4,shockMax:10,shockFadePerSecond:1},RULES.status||{});
/* Lightning (rules.lightning): hits from shock augments and Shock damage. Each adds a Shock stack; a Lightning kill jumps to the nearest enemy
   within range for percent% more damage than the last link, up to max links, with "Chain ×n" from showAt and impact frames at heavyAt and massiveAt. */
const LTN=Object.assign({percent:50,max:8,range:220,showAt:2,heavyAt:4,massiveAt:6},RULES.lightning||{});
/* Placeholders any text may use, on top of its own values. */
const GLOBALS={miniPower:RULES.minis.powerPercent,miniMax:RULES.minis.safetyLimit||60,poisonDps:RULES.combat.poisonDamagePerStackPerSecond,burnDps:RULES.combat.burnDamagePerStackPerSecond,critMult:RULES.player.critMult,armorCap:RULES.combat.armorMaxReductionPercent,chillSlow:ST.chillSlowPercent,shockPct:ST.shockPercent,shockMax:ST.shockMax,lightningPct:LTN.percent,lightningMax:LTN.max,chillMax:ST.chillMax,freezeSeconds:ST.freezeSeconds,burnPower:RULES.combat.burnPowerPercentPerStack||0};
function tpl(s,vals){return String(s==null?'':s).replace(/\{(\w+)\}/g,(m,k)=>vals&&k in vals?f1v(vals[k]):k in GLOBALS?f1v(GLOBALS[k]):m)}
function f1v(v){return typeof v==='number'?f1(v):String(v)}

const WEAPONS={};
for(const k of dkeys(DATA.weapons)){const w=DATA.weapons[k];
 WEAPONS[k]={id:k,name:w.name,blurb:w.blurb,type:w.fists?null:w.type,pow:w.power,reach:w.reach,spin:w.spin,spd:w.speed,blades:w.blades,fist:!!w.fists,fireEvery:w.fireEvery||1.1,kb:w.knockback!=null?w.knockback:(!w.fists&&DATA.weaponTypes[w.type]?DATA.weaponTypes[w.type].knockback:0),impact:w.impact||0,rampDef:w.ramp||{},ramp:tpl(w.rampText,w.ramp)}}
const WDEF={};
for(const k of dkeys(DATA.weaponTypes)){const d=DATA.weaponTypes[k];WDEF[k]={cd:d.hitCooldown,kb:d.knockback,th:d.thickness,stun:d.stun}}
/* Your bows (one per weapon you carry) fire together on every shot and aim a little apart so each can be seen; other weapons are spread around the ball. */
function wOpt(W,i,n,ft0){return W.type==='bow'?{ang:0,side:(i-(n-1)/2)*11,ft:ft0}:{ang:i*TAU/n,ft:ft0+i*.35}}   // side: a bow's offset across its aim, in arena units (drawing and where its arrows start)
function mkW(type,pow,len,spin,o){const d=WDEF[type];return Object.assign({type,pow,len,spin,dir:1,ang:0,cd:0,cdMax:d.cd,kb:d.kb,th:d.th,stun:d.stun||0,pcd:0,every:1.9,ft:1},o)}
function mkBall(o){const b=Object.assign({id:++UID,x:AW/2,y:AH/2,vx:0,vy:0,r:18,team:1,hp:10,spd:200,body:0,armor:0,ws:[],poison:0,burn:0,inv:0,stun:0,bcd:0,flash:0,aim:RULES.combat.homing,col:'#888899',alive:true},o);b.hp=Math.max(1,Math.round(b.hp));b.maxhp=b.hp;b.m=b.r*b.r/324;return b}
function launch(S,b){const a=rnd(S.rsrc)*TAU;b.vx=Math.cos(a)*b.spd;b.vy=Math.sin(a)*b.spd}

/* ---------- 2. enemies and bosses ---------- */
function unitFromData(d){return{about:d.about||'',aboutEndless:d.aboutEndless||'',name:d.name,cost:d.cost,min:d.minTier,minT:d.minTier||1,pack:!!d.pack,hp:d.hp,r:d.radius,spd:d.speed,body:d.bodyDamage||0,armor:d.armor||0,col:d.color,
 w:(d.weapons||[]).map(w=>[w.type,w.power,w.reach,w.spin,w.fireEvery,w.thickness]),ramp:d.ramp||null,bomb:d.bombDamage||0,bombR:d.bombRadius||85,split:d.splitsInto||null,splitN:d.splitCount||2,heal:d.healPerSecond||0,spawns:d.spawns||null,v:d.values||{}}}
const ENEMY={};
for(const k of dkeys(DATA.enemies))ENEMY[k]=unitFromData(DATA.enemies[k]);
/* Enemy behaviours, by enemy id (added with boss and enemy draft 1). tick(S,b,dt,v) every step, onWall(S,b,v) when it hits a wall. v is the enemy's
   "values" in the data. Every attack has a visible wind-up: b.tele (seconds of a flash, drawn by ui.js) and b.pause (stands still). */
const towards=(b,t,spd)=>{const dx=t.x-b.x,dy=t.y-b.y,d=Math.hypot(dx,dy)||1;b.vx=dx/d*spd;b.vy=dy/d*spd};
/* Rams (pool balls in The Eight Ball's rack, and Grunts in endless mode). Numbers: enemies.pool.values. A ram winds up (standing still, flashing)
   while its path shows: a straight line toward you that bounces off walls ramBounces times (b.ramPts). Then it charges along it at ramSpeed with no
   wall jitter, so it follows the line unless something gets in the way. Hitting your side while ramming deals ×ramDamageMult body damage and
   knocks hard (ramKnock), which marks your ball as knocked (pockets). The ram ends at the last bounce, on a hit, or after ramMaxSeconds. */
const RAMV=()=>ENEMY.pool?ENEMY.pool.v:null;
function ramTrace(b,dx,dy,n){let x=b.x,y=b.y;const r=b.r,pts=[[x,y]];
 for(let k=0;k<n;k++){let t=Infinity;if(dx>1e-6)t=Math.min(t,(AW-r-x)/dx);if(dx<-1e-6)t=Math.min(t,(r-x)/dx);if(dy>1e-6)t=Math.min(t,(AH-r-y)/dy);if(dy<-1e-6)t=Math.min(t,(r-y)/dy);
  if(!isFinite(t))break;t=Math.max(0,t);x+=dx*t;y+=dy*t;pts.push([x,y]);if(x<=r+.01||x>=AW-r-.01)dx=-dx;if(y<=r+.01||y>=AH-r-.01)dy=-dy}
 return pts}
/* A ball stalled by a pocket: 0 for PK.stall seconds, then climbs back to 1 over PK.climb seconds. */
function stallF(S,b){if(b.stall==null)return 1;const P=S.pockets||{},st=b.stallS!=null?b.stallS:(P.stall||0),cl=b.stallC!=null?b.stallC:(P.climb||1),k=S.t-b.stall;   // b.stallS/stallC: this stall's own lengths (The Samurai's cut)
 if(k<st)return 0;const f=(k-st)/cl;if(f>=1){b.stall=null;b.stallS=b.stallC=null;return 1}return f}
function endRam(b){b.ram=null;b.wind=0;b.ramPts=null;b.dashT=0}
function ramTick(S,b,dt,v,freq){
 if(b.frozen>0||b.stun>0){if(b.ram||b.wind)endRam(b);return}
 if(b.ram){b.ram.t+=dt;if(b.ram.t>v.ramMaxSeconds)endRam(b);return}
 if(b.wind){if(b.pause>0)return;b.wind=0;b.ramPts=ramTrace(b,b.ramDir[0],b.ramDir[1],v.ramBounces);   // released: retrace from where it stands now
  const sp=v.ramSpeed*(b.angry?v.angrySpeedPercent/100:1);b.vx=b.ramDir[0]*sp;b.vy=b.ramDir[1]*sp;b.dashT=99;b.dashX=sp/Math.max(1,b.spd);b.ram={n:0,t:0};return}
 b.ait=(b.ait==null?(.5-rnd(S.rsrc))*v.ramEvery:b.ait)+dt*(freq||1);   // first ram after 0.5 to 1.5 times ramEvery, so the rack doesn't all charge at once
 if(b.ait>=v.ramEvery&&S.player.alive){b.ait=0;const p=S.player,dx=p.x-b.x,dy=p.y-b.y,d=Math.hypot(dx,dy)||1;b.ramDir=[dx/d,dy/d];b.ramPts=ramTrace(b,dx/d,dy/d,v.ramBounces);
  b.wind=1;b.pause=v.ramWindup;b.tele=v.ramWindup}}
/* One of The Eight Ball's pool balls: n 1 to 7 solid, 9 to 15 striped. All the same size and HP; big ones (bigRadiusX, bigHpX) ram along
   marked paths. Bumping your ball shoves it with solidImpact or stripeImpact (and marks it as knocked, for the pockets). */
function poolBall(S,n,x,y,big){const P=ENEMY.pool,pv=P.v,cols=DATA.theme.poolBalls||['#f2c230','#2457d6','#d83a3a','#7b3fb0','#f08a24','#22984a','#8a2a2a'];
 const e=spawnEnemy(S,'pool',x,y,{hp:P.hp*S.hs*(big?pv.bigHpX:1)*(n>8?(pv.stripeHpX||1):1),r:P.r*(big?pv.bigRadiusX:1)});e.num=n;e.stripe=n>8;if(e.stripe)e.armor+=(pv.stripeArmor||0)*S.ds;e.col=cols[(n>8?n-9:n-1)%cols.length];
 e.impact=e.stripe?pv.stripeImpact:pv.solidImpact;e.big=!!big;e.vx=e.vy=0;e.pause=pv.rackPause;if(big)e.m=e.r*e.r/324;return e}
function ramWall(S,b,v){if(b.ram&&++b.ram.n>=v.ramBounces)endRam(b)}
const ENEMY_CODE={
 pool:{tick(S,b,dt,v){if(b.big)ramTick(S,b,dt,v,1)},onWall(S,b,v){ramWall(S,b,v)}},
 grunt:{tick(S,b,dt){const v=RAMV();if(S.endlessFight&&v)ramTick(S,b,dt,v,v.ramEvery/(v.gruntRamEvery||v.ramEvery))},onWall(S,b){if(RAMV())ramWall(S,b,RAMV())}},   // endless mode: Grunts ram along marked paths
 swarm:{tick(S,b,dt,v){let x=0,y=0,n=0;for(const o of S.balls)if(o!==b&&o.alive&&o.kind==='swarm'&&Math.abs(o.x-b.x)<v.flockRange&&Math.abs(o.y-b.y)<v.flockRange){x+=o.x;y+=o.y;n++}
  if(n){b.vx+=(x/n-b.x)*v.flock*dt;b.vy+=(y/n-b.y)*v.flock*dt}}},
 slasher:{tick(S,b,dt,v){if(b.pause>0||b.frozen>0||b.stun>0)return;b.ait=(b.ait||0)+dt;
  if(!b.wind&&b.ait>=v.every){b.ait=0;b.wind=1;b.pause=v.windup;b.tele=v.windup;return}
  if(b.wind){b.wind=0;towards(b,S.player,b.spd*v.dashMult);b.dashT=v.dashSeconds;b.dashX=v.dashMult}}},
 stabber:{tick(S,b,dt,v){b.ready=S.t>=(b.dodgeT||0);if(!b.ready||b.frozen>0||b.stun>0)return;const p=S.player;
  for(const w of p.ws){if(w.type==='bow'||w.type==='shield')continue;if(dSegPt(seg(p,w),b.x,b.y)<b.r+v.dodgeRange){const dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy)||1,side=rnd(S.rsrc)<.5?1:-1;
   b.vx=(-dy/d*side+dx/d*.4)*b.spd*v.dodgeMult;b.vy=(dx/d*side+dy/d*.4)*b.spd*v.dodgeMult;b.dashT=v.dodgeSeconds;b.dashX=v.dodgeMult;b.dodgeT=S.t+v.cooldown;b.tele=.15;count(S,'dodges');return}}}},
 lancer:{tick(S,b,dt,v){const w=b.ws[0];if(!w)return;const p=S.player;let d=Math.atan2(p.y-b.y,p.x-b.x)-w.ang;d=Math.atan2(Math.sin(d),Math.cos(d));w.mult=Math.abs(d)<v.braceArc?v.braceMult:1}},
 brute:{tick(S,b,dt,v){if(b.frozen>0||b.stun>0||b.pause>0)return;if(b.charging){if(b.dashT<=0)b.charging=0;return}b.ait=(b.ait||0)+dt;
  if(!b.wind&&b.ait>=v.every){b.ait=0;b.wind=1;b.pause=v.windup;b.tele=v.windup;return}
  if(b.wind){b.wind=0;b.charging=1;towards(b,S.player,b.spd*v.chargeMult);b.dashT=v.chargeSeconds;b.dashX=v.chargeMult}},
  onWall(S,b,v){if(!b.charging)return;b.charging=0;b.dashT=0;b.stun=v.stunSeconds;fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+16,col:DATA.theme.effects.spark});snd(S,'impact');count(S,'bruteStuns')}},
 archer:{tick(S,b,dt,v){const p=S.player,dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy)||1;if(d<v.keepAway){b.noAim=1;b.vx+=dx/d*v.flee*dt;b.vy+=dy/d*v.flee*dt}else b.noAim=0}},
 bomber:{tick(S,b,dt,v){if(b.fuse!=null){b.fuse-=dt;b.tele=.1;if(b.fuse<=0&&b.alive){b.fuse=null;b.hp=0;kill(S,b)}return}
  for(const o of S.balls)if(o.alive&&o.team===0&&Math.hypot(o.x-b.x,o.y-b.y)<v.triggerRange+o.r+b.r){b.fuse=v.fuseSeconds;snd(S,'zap');return}}},
 medic:{tick(S,b,dt,v){const m=b.healT;if(!m||!m.alive||b.cutT>S.t)return;
  for(const o of S.balls){if(!o.alive||o.team!==0)continue;for(const w of o.ws){if(w.type==='bow')continue;if(segX(seg(o,w),[b.x,b.y,m.x,m.y])){b.cutT=S.t+v.cutSeconds;b.healT=null;fx(S,{k:'spark',x:(b.x+m.x)/2,y:(b.y+m.y)/2});snd(S,'parry');count(S,'tethersCut');return}}}}},
 guard:{tick(S,b,dt,v){const p=S.player;let m=null;for(const o of S.balls)if(o.alive&&o.team===1&&o!==b&&o.kind!=='guard'&&o.hp<o.maxhp*v.hurtPercent/100&&(!m||o.hp/o.maxhp<m.hp/m.maxhp))m=o;   // only guards allies that are hurt
  for(const w of b.ws){if(w.spin0==null)w.spin0=w.spin;w.spin=m?0:w.spin0;   // alone: the shield spins as normal, so it can always be hit
   if(m){let d=Math.atan2(p.y-b.y,p.x-b.x)-w.ang;d=Math.atan2(Math.sin(d),Math.cos(d));const mx=v.turn*dt;w.ang+=clamp(d,-mx,mx)}}   // guarding: turns its shield toward you, not instantly
  if(!m||b.frozen>0||b.stun>0){b.noAim=0;return}b.noAim=1;const dx=p.x-m.x,dy=p.y-m.y,d=Math.hypot(dx,dy)||1,tx=m.x+dx/d*(m.r+b.r+v.gap),ty=m.y+dy/d*(m.r+b.r+v.gap);
  const ex=tx-b.x,ey=ty-b.y,ed=Math.hypot(ex,ey);if(ed>4){b.vx+=ex/ed*v.steer*dt;b.vy+=ey/ed*v.steer*dt}}},
 crusher:{tick(S,b,dt,v){if(b.frozen>0||b.stun>0)return;b.ait=(b.ait||0)+dt;if(b.ait<v.every)return;b.ait=0;b.pause=v.warning;b.tele=v.warning;
  S.marks.push({x:b.x,y:b.y,r:v.slamRadius,t:v.warning,t0:v.warning,pow:v.slamDamage*S.ds,src:b})}},
};
/* Elite enemies (rules.elites): from fromTier on, a normal fight may give one enemy a modifier, shown on the fight preview. */
const ELITE=Object.assign({fromTier:3,chancePercent:35,gold:2,armor:3,swiftPercent:40,vampiricPercent:20,volatileDamage:12,volatileRadius:70,wardSeconds:5},RULES.elites||{});
const ELITE_MODS=['armored','swift','vampiric','volatile','warded'];
function makeElite(S,b,mod){b.elite=mod;if(mod==='armored')b.armor+=ELITE.armor*S.ds;else if(mod==='swift')b.spd*=1+ELITE.swiftPercent/100;else if(mod==='vampiric')b.vamp=ELITE.vampiricPercent/100;else if(mod==='volatile')b.volatile=1;else if(mod==='warded')b.ward=S.t+ELITE.wardSeconds}
/* Special behaviour for bosses, by id. A boss in the data with no entry here is a plain big enemy.
   Hooks: onSpawn(S,b,v) once; tick(S,b,dt,v) every step; onDeath(S,b,v); onPlayerBounce(S,playerBall,v). v is the boss's "values". */
const crackArmor=(S,b,v)=>{if(!(b.armor>0))return;b.armor=Math.max(0,b.armor-v.crack*S.ds);fx(S,{k:'burst',x:b.x,y:b.y,col:'#c9bfdc',n:10});snd(S,'parry');count(S,'cracks');S.bossNote=tpl(DATA.text.armorLeft||'Armor {n}',{n:Math.round(b.armor/S.ds*10)/10})};
/* Boss weapon ramp (rules.scaling.bossRampPercent): a boss weapon that hits one of your balls ramps like the player's weapon of the same type.
   Power steps are a share of the boss weapon's own Power (the player weapon's step over its base Power), so they keep pace with tier scaling.
   A boss with no weapons ramps like Bare Fists: +Speed and body damage per wall bounce. A boss's data "ramp" can name another weapon or "none". */
const RAMP_OF={katana:'sword'},BRAMP={};
for(const k of dkeys(DATA.weapons)){const w=DATA.weapons[k],key=w.fists?'fists':w.type;if(!BRAMP[key])BRAMP[key]=Object.assign({base:w.power},w.ramp||{})}
const bossRampX=()=>{const p=RULES.scaling.bossRampPercent;return(p==null?100:p)/100};
function bossRampOn(S,b){return!!(b&&b.boss&&S.bossDef&&S.bossDef.ramp!=='none'&&bossRampX()>0)}
function bossRamp(S,b,w){if(!bossRampOn(S,b))return;const D=BRAMP[RAMP_OF[w.type]||w.type];if(!D)return;const x=bossRampX();
 if(w.pow0==null){w.pow0=w.pow;w.spin0b=w.spin}
 if(D.power)w.pow+=w.pow0*D.power/Math.max(1,D.base)*x;
 if(D.mult)w.rmult=(w.rmult||0)+D.mult*x;
 if(D.spinPercent)w.spin=Math.min(w.spin0b*(D.maxSpinMultiplier||4),w.spin+w.spin0b*D.spinPercent/100*x);
 if(D.reach)w.len=Math.min(D.maxReach||220,w.len+D.reach*x);
 if(D.hitsPerArrow)w.arr=(w.arr||0)+x/D.hitsPerArrow;
 count(S,'bossRamp')}
function bossFistRamp(S,b){if(!bossRampOn(S,b)||b.ws.length||(S.bossDef.ramp&&S.bossDef.ramp!=='fists'))return;const D=BRAMP.fists;if(!D||!D.speedPercentPerBounce)return;
 const f0=1+(b.rspd||0),f1=Math.min(1+(D.maxSpeedBonusPercent||180)/100,f0+D.speedPercentPerBounce/100*bossRampX());if(f1<=f0)return;b.rspd=f1-1;b.spd*=f1/f0;b.body*=f1/f0}
/* Shock on your side (The Storm's lightning arrow): each stack cuts the damage of your hits by shockPercent, up to shockMax. The Talisman blocks it. */
function addPlayerShock(S,t,n){if(!t.alive||t.team!==0||S.talisman||n<=0)return;t.shock=Math.min(ST.shockMax,(t.shock||0)+n);count(S,'shockTaken',n)}
/* Random spots spread over the table for The Eight Ball's balls: away from your ball, the pockets, each other and the other enemies. */
function spreadSpots(S,n,r,skip){const out=[],p=S.player,pk=(S.pockets&&S.pockets.r)||40;
 for(let i=0;i<n;i++){let best=null,bs=-1e9;
  for(let k=0;k<40;k++){const x=r+8+rnd(S.rsrc)*(AW-2*r-16),y=r+8+rnd(S.rsrc)*(AH-2*r-16);let m=Math.hypot(x-p.x,y-p.y)-p.r-r-50;
   for(const c of[[0,0],[AW,0],[0,AH],[AW,AH]])m=Math.min(m,Math.hypot(x-c[0],y-c[1])-pk-r-14);
   for(const o of out)m=Math.min(m,Math.hypot(x-o[0],y-o[1])-2*r-12);
   for(const o of S.balls)if(o.alive&&o.team===1&&o!==skip)m=Math.min(m,Math.hypot(x-o.x,y-o.y)-o.r-r-12);
   if(m>bs){bs=m;best=[x,y]}}
  out.push(best)}
 return out}
const nearestWall=b=>{const d=[b.x,AW-b.x,b.y,AH-b.y];return d.indexOf(Math.min.apply(null,d))};   // 0 left, 1 right, 2 top, 3 bottom
const BOSS_CODE={
 /* Hooks a boss can have (all optional): onSpawn, tick, phase2 (once, at half HP), onDeath, onPlayerBounce(S,p,v), onWall(S,b,v) when it hits a wall,
    taken(S,b,amt,kind,type,v) -> the damage it really takes, hitTaken(S,b,hit,v) after one of your hits, blocks(S,b,attacker,v) -> true to stop a blade,
    onEnemyCollide(S,a,b,v), noChill (immune to Chill and Freeze), offAtStart(run,v) -> augments switched off at the start. */
 bulwark:{onSpawn(S,b,v){S.bossNote=tpl(DATA.text.armorLeft||'Armor {n}',{n:Math.round(b.armor/S.ds*10)/10})},
  hitTaken(S,b,c,v){if(c.crit)crackArmor(S,b,v)},onWall(S,b,v){if(b.knockT!=null&&S.t-b.knockT<v.slamWindow){b.knockT=null;crackArmor(S,b,v)}},
  phase2(S,b,v){b.sc=0},tick(S,b,dt,v){if(!b.p2)return;b.sc+=dt;b.shieldOn=(b.sc%v.shieldEvery)<v.shieldSeconds},
  blocks(S,b,att,v){if(!b.shieldOn)return false;let d=Math.atan2(att.y-b.y,att.x-b.x)-Math.atan2(b.vy,b.vx);d=Math.atan2(Math.sin(d),Math.cos(d));return Math.abs(d)<v.shieldArc}},
 hydra:{onDeath(S,b,v){const g=b.gen||0;if(g<v.generations)for(let i=0;i<v.children;i++){const c=spawnEnemy(S,b.kind,b.x+(i%2?14:-14),b.y+(i>1?14:0),{hp:b.maxhp*v.childHpPercent/100,r:b.r*v.childSizePercent/100,gen:g+1,spd:b.spd*v.childSpeedPercent/100,body:b.body*v.childBodyDamagePercent/100,noBoss:true});c.boss=true}},
  onEnemyCollide(S,a,b,v){if(a.kind!=='hydra'||b.kind!=='hydra'||!a.alive||!b.alive||(a.gen||0)!==(b.gen||0)||S.t-a.born<v.mergeAfter||S.t-b.born<v.mergeAfter)return;   // same-size heads only
   const k=a.hp>=b.hp?a:b,l=k===a?b:a;k.hp+=l.hp;k.maxhp+=l.maxhp;k.r=Math.min(BOSS.hydra.r,k.r/(v.childSizePercent/100));k.m=k.r*k.r/324;k.gen=Math.max(0,Math.min(k.gen||0,l.gen||0)-1);k.born=S.t;
   l.alive=false;fx(S,{k:'ring',x:k.x,y:k.y,r:k.r+18,col:k.col});snd(S,'clack');count(S,'merges')}},
 reflect:{offAtStart:run=>[run.augs[0]],
  onSpawn(S,b,v){const P=S.P,W=P.W;b.spd=P.spd*v.speedPercent/100;if(W.fist){b.body=Math.max(4,P.pow*v.fistBodyPercent/100)}else for(let i=0;i<P.blades;i++)b.ws.push(mkW(W.type,Math.max(3,P.pow*v.powerPercent/100),Math.min(P.reach,v.maxReach),Math.min(P.spin,v.maxSpin),{ang:Math.PI+i*TAU/P.blades,dir:-1,every:v.bowFireEvery}));
   b.basePow=b.ws.map(w=>w.pow);b.baseBody=b.body;BOSS_CODE.reflect.copy(S,b,v,0)},
  copy(S,b,v,i){const a=S.lock?null:S.run.augs[i];if(i>0)setOff(S,[a]);const d=a&&AUG[a.id],k=1+(d?(d.rar+1)*v.perRarityPercent/100:0);b.ws.forEach((w,j)=>w.pow=b.basePow[j]*k);b.body=b.baseBody*k;
   S.bossNote=d?tpl(DATA.text.copying||'Copying {name}',{name:d.name}):''},
  phase2(S,b,v){BOSS_CODE.reflect.copy(S,b,v,1);b.ph=2},tick(S,b,dt,v){if(b.ph===2&&b.hp<b.maxhp*.25){b.ph=3;BOSS_CODE.reflect.copy(S,b,v,2);fx(S,{k:'ring',x:b.x,y:b.y,r:110,col:b.col})}}},
 /* The Magnet. Phase 1: pulls your ball in, harder up close. Phase 2: every flipEvery seconds it pushes, and a push is its hold move: your ball is
    held in place (the Talisman blocks it) while your projectiles in flight (and any you fire meanwhile) and your Minis are sucked onto it. When they
    have all arrived, or after holdSeconds if you have none, or at holdMaxSeconds at the latest, it shoots your ball away at launchSpeed. Each wall
    bounce of the launch (launchBounces of them) hurts you for launchDamage (scaled by tier), +perCaughtPercent% for each projectile and Mini caught.
    Caught projectiles are used up; Minis are let go. Meanwhile it pulls its allies in. */
 magnet:{tick(S,b,dt,v){const p=S.player,dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy)||1,M=BOSS_CODE.magnet,T=DATA.text;
   if(b.hold){M.holding(S,b,dt,v);return}
   if(b.launchN>0&&S.t>b.launchEnd)b.launchN=0;
   if(b.p2&&!(b.launchN>0)){b.ft=(b.ft||0)+dt;if(b.ft>=v.flipEvery&&!(b.frozen>0)){b.ft=0;M.startHold(S,b,v);return}}
   let f=v.pull*(1+v.closeBonusPercent/100*Math.max(0,1-d/v.closeRange));if(b.launchN>0)f=0;
   p.vx+=dx/d*f*dt;p.vy+=dy/d*f*dt},
  startHold(S,b,v){const p=S.player;if(S.talisman){S.bossNote=DATA.text.talismanBlocked||'Talisman';fx(S,{k:'ring',x:b.x,y:b.y,r:150,col:'#7fdcff'});return}
   b.hold={t:0,caught:0,mini:new Set(),hv:[p.vx,p.vy]};p.held=1;fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+30,col:'#7fdcff'});fx(S,{k:'zap',x1:b.x,y1:b.y,x2:p.x,y2:p.y});snd(S,'zap');count(S,'magnetHolds');
   S.bossNote=DATA.text.magnetHold||'Held'},
  holding(S,b,dt,v){const H=b.hold,p=S.player,R=p.r+(v.clumpRadius||22);H.t+=dt;p.pause=Math.max(p.pause||0,dt*2);p.vx=p.vy=0;
   if(!p.alive){b.hold=null;return}
   let left=0;
   for(const q of S.projs){if(q.dead||q.team!==0)continue;const qx=p.x-q.x,qy=p.y-q.y,qd=Math.hypot(qx,qy)||1;
    if(qd<R){q.dead=true;H.caught++;fx(S,{k:'spark',x:q.x,y:q.y});continue}
    left++;const sp=Math.max(v.suckSpeed,Math.hypot(q.vx,q.vy));q.vx=qx/qd*sp;q.vy=qy/qd*sp;q.ang=Math.atan2(q.vy,q.vx);q.life=Math.max(q.life,1);q.bn=Math.max(q.bn||0,1)}
   for(const m of S.balls){if(!m.alive||!m.mini)continue;const mx=p.x-m.x,my=p.y-m.y,md=Math.hypot(mx,my)||1;
    if(md<R+m.r){if(!H.mini.has(m.id)){H.mini.add(m.id);H.caught++}m.vx*=.5;m.vy*=.5;continue}
    left++;m.vx=mx/md*v.suckSpeed;m.vy=my/md*v.suckSpeed}
   for(const e of S.balls)if(e.alive&&e.team===1&&e!==b){const ex=b.x-e.x,ey=b.y-e.y,ed=Math.hypot(ex,ey)||1;e.vx+=ex/ed*v.pull*dt;e.vy+=ey/ed*v.pull*dt}
   if(H.t%.5<dt)fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+14+Math.min(30,H.caught*3),col:'#7fdcff'});
   S.bossNote=H.caught?tpl(DATA.text.magnetCaught||'Held: {n} caught',{n:H.caught}):(DATA.text.magnetHold||'Held');
   const done=H.t>=v.holdMaxSeconds||(left===0&&(H.caught>0?H.t>=v.holdMinSeconds:H.t>=v.holdSeconds));
   if(done)BOSS_CODE.magnet.launch(S,b,v)},
  launch(S,b,v){const H=b.hold,p=S.player;b.hold=null;p.held=0;p.pause=0;
   const dx=p.x-b.x,dy=p.y-b.y,d=Math.hypot(dx,dy)||1;p.vx=dx/d*v.launchSpeed;p.vy=dy/d*v.launchSpeed;p.dashT=v.launchSeconds;p.dashX=v.launchSpeed/Math.max(1,p.spd);p.stall=null;
   b.launchN=v.launchBounces;b.launchEnd=S.t+v.launchSeconds;b.launchDmg=v.launchDamage*S.ds*(1+v.perCaughtPercent/100*H.caught);b.ft=0;
   fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+40,col:b.col});fx(S,{k:'burst',x:p.x,y:p.y,col:'#7fdcff',n:20});snd(S,'impact');count(S,'magnetLaunches');if(H.caught)count(S,'magnetCaught',H.caught);
   S.bossNote=''},
  onPlayerBounce(S,p,v){const b=S.boss;if(!b||!(b.launchN>0)||S.t>b.launchEnd)return;b.launchN--;const hp=p.hp;enemyHit(S,b,p,b.launchDmg);
   fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+20,col:b.col});snd(S,'impact');count(S,'launchHits');if(b.launchN<=0)p.dashT=Math.min(p.dashT,.2)},
  phase2(S,b,v){b.ft=v.flipEvery-1}},
 nullb:{disablesTopAugment:true,offAtStart:run=>[run.augs[0]],
  onSpawn(S,b,v){b.idx=0;S.bossNote=S.lock?DATA.text.padlocked||'Padlocked':tpl(DATA.text.nullSocket||'Socket {n} off',{n:1})},
  tick(S,b,dt,v){const n=S.run.augs.length;if(n<2||S.lock)return;b.mt=(b.mt||0)+dt;if(b.mt<v.moveEvery)return;b.mt=0;b.idx=(b.idx+1)%n;
   const list=[S.run.augs[b.idx]];if(b.p2)list.push(S.run.augs[(b.idx+1)%n]);setOff(S,list);fx(S,{k:'ring',x:b.x,y:b.y,r:90,col:b.col});snd(S,'zap');
   S.bossNote=tpl(DATA.text.nullSocket||'Socket {n} off',{n:b.p2?(b.idx+1)+'+'+((b.idx+1)%n+1):b.idx+1})},
  phase2(S,b,v){const n=S.run.augs.length;if(n<2||S.lock)return;setOff(S,[S.run.augs[b.idx],S.run.augs[(b.idx+1)%n]]);S.bossNote=tpl(DATA.text.nullSocket||'Socket {n} off',{n:(b.idx+1)+'+'+((b.idx+1)%n+1)})}},
 glacier:{noChill:true,   // your own hits on it slow you: a stack each, all gone slowSeconds after your last hit (the Talisman blocks it)
  /* Touching it Chills your ball (contactChill stacks, at most every contactCooldown s; Chill slows your ball and blades); at freezeAt stacks you are
     Frozen for contactFreeze s. Your Chill fades like an enemy's. The Talisman blocks it. */
  onContact(S,b,p,v){if(S.talisman||!p.alive||p.frozen>0||S.t<(p.gcd||0))return;p.gcd=S.t+v.contactCooldown;p.chill=(p.chill||0)+v.contactChill;count(S,'chillTaken',v.contactChill);
   fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+8,col:DATA.theme.effects.freeze||'#d9f4ff'});
   if(p.chill>=v.freezeAt){p.chill=0;p.frozen=v.contactFreeze;count(S,'frozenTaken');fx(S,{k:'burst',x:p.x,y:p.y,col:DATA.theme.effects.freeze||'#d9f4ff',n:16});snd(S,'zap')}},
  hitTaken(S,b,c,v){if(S.talisman||!/^(weapon|body|proj)$/.test(c.src)||S.hitOwner)return;b.slowN=(b.slowN||0)+1;b.slowT=S.t+(v.slowSeconds||3);S.chill=Math.max(v.slowestPercent/100,1-b.slowN*v.slowPercent/100);if(b.slowN===1||b.slowN%3===0)fx(S,{k:'ring',x:S.player.x,y:S.player.y,r:S.player.r+12,col:DATA.theme.effects.freeze||'#d9f4ff'})},
  tick(S,b,dt,v){if(b.slowN&&S.t>=b.slowT){b.slowN=0;S.chill=1}},
  taken(S,b,amt,kind,type,v){return kind==='burn'?amt*v.burnTakenX:amt},
  onWall(S,b,v){if(b.p2&&S.ice.length<v.maxPatches)S.ice.push({x:b.x,y:b.y,r:v.iceRadius,t:v.iceSeconds,t0:v.iceSeconds,freeze:v.freezeSeconds,cd:v.iceCooldown})},phase2(){}},
 queen:{tick(S,b,dt,v){b.st=(b.st||0)+dt;if(b.st>=v.spawnEvery/(b.p2?2:1)){b.st=0;let n=0;for(const e of S.balls)if(e.alive&&e.team===1)n++;if(n<v.maxEnemiesAlive&&b.def.spawns)spawnEnemy(S,b.def.spawns,b.x,b.y+b.r)}
   for(const e of S.balls)if(e.alive&&e.kind==='swarm'&&S.t-(e.born||0)>=v.growAfter){e.alive=false;const g=spawnEnemy(S,'grunt',e.x,e.y,{hp:ENEMY.grunt.hp*S.hs*v.grownHpPercent/100});fx(S,{k:'ring',x:g.x,y:g.y,r:g.r+10,col:g.col});count(S,'grown')}},
  taken(S,b,amt,kind,type,v){if(b.p2&&S.balls.some(e=>e.alive&&e.kind==='swarm'))return amt*(1+v.frenzyTakenPercent/100);return amt},
  phase2(S,b,v){S.bossNote=DATA.text.queenFrenzy||'Frenzy'}},
 furnace:{onPlayerBounce(S,p,v){if(p.inv>0)return;const hot=S.hotWalls&&S.hotWalls.includes(nearestWall(p)),d=p.maxhp*v.hpPercent/100*(hot?v.hotMult:1);
   p.hp-=d;p.flash=.1;text(S,p.x,p.y-p.r,d,'burn');if(hot)fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+14,col:DATA.theme.damageText.burn});if(p.hp<=0)playerDown(S)},
  taken(S,b,amt,kind,type,v){if(kind==='burn'){if(v.burnHealPercent>0)heal(S,b,amt*v.burnHealPercent/100);return 0}return amt},   // burnHealPercent above 0 makes Burn heal it
  phase2(S,b,v){b.wt=v.rotateEvery},tick(S,b,dt,v){if(!b.p2)return;b.wt+=dt;if(b.wt<v.rotateEvery)return;b.wt=0;const a=rnd(S.rsrc)*4|0;let c=rnd(S.rsrc)*3|0;if(c>=a)c++;S.hotWalls=[a,c]}},
 storm:{tick(S,b,dt,v){b.st=(b.st||0)+dt;if(b.st>=v.strikeEvery){b.st=0;const p=S.player,n=(v.strikeCount||1)+Math.min(v.maxExtra,b.extra||0)+(b.p2?1:0);b.extra=0;
   for(let i=0;i<n;i++)S.marks.push({x:clamp(p.x+p.vx*.5+(rnd(S.rsrc)-.5)*(90+i*40),40,AW-40),y:clamp(p.y+p.vy*.5+(rnd(S.rsrc)-.5)*(90+i*40),40,AH-40),r:v.radius,t:v.warning,t0:v.warning,pow:v.damage*S.ds,src:b})}
   /* Lightning arrow: bounces off walls, passes through your balls, hits and Shocks them. Its Ramp is the Bow's: more arrows per volley. */
   if(v.arrowEvery&&!(b.frozen>0)){b.at=(b.at||0)+dt;if(b.at>=v.arrowEvery&&S.player.alive){b.at=0;const p=S.player,a0=Math.atan2(p.y-b.y,p.x-b.x),nv=Math.min(RULES.projectiles.maxPerVolley,(v.arrowCount||1)+Math.floor(b.arr||0));
    for(let i=0;i<nv;i++){const a=a0+(i-(nv-1)/2)*(v.arrowSpread||.3),c=Math.cos(a),s=Math.sin(a);S.projs.push({x:b.x+c*(b.r+6),y:b.y+s*(b.r+6),vx:c*v.arrowSpeed,vy:s*v.arrowSpeed,r:6,team:1,pow:v.arrowDamage*S.ds,owner:b,bn:v.arrowBounces,life:v.arrowSeconds,ang:a,bolt:true,pierce:true,shock:v.arrowShock,rehit:v.arrowRehit||.6,hitT:{},stormRamp:true})}
    snd(S,'zap');count(S,'stormArrows')}}},
  hitTaken(S,b,c,v){if(hasTag(c,'shock'))b.extra=(b.extra||0)+1},taken(S,b,amt,kind,type,v){if(kind==='shock')b.extra=(b.extra||0)+1;return amt},
  phase2(S,b,v){S.bossNote=DATA.text.stormPairs||'Double strikes'}},
 /* The Gavel: its hammer knocks far harder than normal. If your ball hits a wall soon after one of its blows, you lose a share of Max HP.
    Max HP (knockback resistance) and size keep you from flying as far. Phase 2: leaps and slams, knocking every ball away. */
 gavel:{onSpawn(S,b,v){for(const w of b.ws)w.kb*=v.knockMult},
  onPlayerBounce(S,p,v){if(p.knockT==null||S.t-p.knockT>v.window||p.inv>0)return;p.knockT=null;const d=p.maxhp*v.hpPercent/100;p.hp-=d;p.flash=.12;
   text(S,p.x,p.y-p.r,d,'hurt');fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+22,col:DATA.theme.page.mult});snd(S,'impact');count(S,'hurt');if(p.hp<=0)playerDown(S)},
  phase2(S,b,v){b.slt=v.slamEvery-1},tick(S,b,dt,v){if(!b.p2||b.frozen>0)return;b.slt+=dt;if(b.slt<v.slamEvery)return;b.slt=0;b.pause=v.slamWarning;b.tele=v.slamWarning;
   S.marks.push({x:b.x,y:b.y,r:v.slamRadius,t:v.slamWarning,t0:v.slamWarning,pow:v.slamDamage*S.ds,knock:v.slamKnock,src:b})}},
 /* The Samurai: every v.every seconds it draws and slashes v.slashes times (more in phase 2). Each slash winds up with its path shown, then dashes along it.
    Each of your balls it passes through loses hpPercent of its own Max HP through Armor (enemyHit with pierce), with the biggest impact frame on your ball.
    Burst damage staggers it (taken). Debuff while it lives: no lifesteal (S.noLeech) and Regen cut (S.regenX); the Talisman blocks it. */
 samurai:{onSpawn(S,b,v){b.ait=v.every*.5;b.seq=0;b.dlog=[];if(S.talisman){S.bossNote=DATA.text.talismanBlocked||'Talisman';return}S.noLeech=true;S.regenX=1-v.regenCutPercent/100},
  endSlash(b){b.slash=null;b.wind=0;b.ramPts=null;b.dashT=0},
  start(S,b,v){const p=S.player,w=b.p2?v.windupPhase2:v.windup,d0=Math.hypot(p.x-b.x,p.y-b.y),k=stallF(S,p),tt=(w+d0/v.dashSpeed)*(v.leadPercent||0)/100;   // aims where you will be: leadPercent of the way
   const tx=clamp(p.x+p.vx*k*tt,p.r,AW-p.r),ty=clamp(p.y+p.vy*k*tt,p.r,AH-p.r),dx=tx-b.x,dy=ty-b.y,d=Math.hypot(dx,dy)||1;b.sDir=[dx/d,dy/d];b.ramPts=ramTrace(b,dx/d,dy/d,v.dashBounces);b.wind=1;b.pause=w;b.tele=w},
  next(S,b,v){BOSS_CODE.samurai.endSlash(b);b.seq--;if(b.seq>0)b.gap=v.between;else if(S.bossNote===(DATA.text.samuraiDraw||'Drawing'))S.bossNote=''},
  cut(S,b,o,v){const amt=o.maxhp*v.hpPercent/100;if(o.inv>0)return;
   if(IMP&&S.juice&&o.player){S.fx.push({k:'impact',pct:1e4,x:o.x,y:o.y,dmg:amt});S.hold=true}   // the biggest impact frame on your ball
   enemyHit(S,b,o,amt,true);count(S,'slashHits');fx(S,{k:'ring',x:o.x,y:o.y,r:o.r+22,col:b.col});fx(S,{k:'burst',x:o.x,y:o.y,col:b.col,n:16});snd(S,'impact');
   if(o.alive){if(v.stallSeconds!=null){o.stall=S.t;o.stallS=v.stallSeconds;o.stallC=v.climbSeconds;o.knockT=null}else{knock(S,o,b.x,b.y,v.knock);o.knockT=S.t}}},   // stopped dead, then speeds back up (faster than a pocket)
  tick(S,b,dt,v){const C=BOSS_CODE.samurai,stag=S.t<(b.stagUntil||0);
   if(!stag&&S.bossNote===(DATA.text.samuraiStagger||'Staggered'))S.bossNote='';
   if(b.frozen>0||stag){if(b.slash||b.wind)C.endSlash(b);if(stag)b.seq=0;return}   // staggered or Frozen: the slashes are cancelled
   if(b.slash){b.slash.t+=dt;
    for(const o of S.balls.slice())if(b.slash&&o.alive&&o.team===0&&!b.slash.hit.has(o.id)&&Math.hypot(o.x-b.x,o.y-b.y)<o.r+b.r+4){b.slash.hit.add(o.id);C.cut(S,b,o,v);if(S.done)return}
    if(b.slash&&b.slash.t>v.dashMaxSeconds)C.next(S,b,v);return}
   if(b.wind){if(b.pause>0||b.stun>0)return;b.wind=0;b.ramPts=ramTrace(b,b.sDir[0],b.sDir[1],v.dashBounces);b.vx=b.sDir[0]*v.dashSpeed;b.vy=b.sDir[1]*v.dashSpeed;b.dashT=99;b.dashX=v.dashSpeed/Math.max(1,b.spd);b.slash={n:0,t:0,hit:new Set()};snd(S,'parry');return}
   if(b.stun>0)return;
   if(b.seq>0){b.gap-=dt;if(b.gap<=0)C.start(S,b,v);return}
   b.ait+=dt;if(b.ait>=v.every&&S.player.alive){b.ait=0;b.seq=b.p2?v.slashesPhase2:v.slashes;S.bossNote=DATA.text.samuraiDraw||'Drawing';C.start(S,b,v)}},
  onWall(S,b,v){if(b.slash&&++b.slash.n>=v.dashBounces)BOSS_CODE.samurai.next(S,b,v)},
  taken(S,b,amt,kind,type,v){if(S.t<(b.stagUntil||0))amt*=1+v.staggerTakenPercent/100;
   b.dlog.push([S.t,amt]);while(b.dlog.length&&b.dlog[0][0]<S.t-v.staggerWindow)b.dlog.shift();
   if(S.t>=(b.stagCd||0)){let s=0;for(const q of b.dlog)s+=q[1];
    if(s>=b.maxhp*v.staggerPercent/100){b.stagUntil=S.t+v.staggerSeconds;b.stagCd=S.t+v.staggerCooldown;b.stun=Math.max(b.stun||0,v.staggerSeconds);b.dlog.length=0;BOSS_CODE.samurai.endSlash(b);b.seq=0;b.ait=0;
     S.bossNote=DATA.text.samuraiStagger||'Staggered';fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+30,col:DATA.theme.page.gold});fx(S,{k:'burst',x:b.x,y:b.y,col:DATA.theme.page.gold,n:20});snd(S,'impact');count(S,'staggers');
     if(IMP&&S.juice){S.fx.push({k:'impact',pct:IMP_MIN,x:b.x,y:b.y,dmg:amt});S.hold=true}}}
   return amt},
  phase2(S,b,v){}},
 /* The Clockwork: open (no arms, can be hurt) for openSeconds, then spins: invulnerable and immune to statuses, with clockarm blades out. The spin lasts
    from maxSpin (you dealt nothing while it was open) down to minSpin (you dealt fullDamagePercent of its Max HP or more). Its arms are three clock hands:
    hour (short, slow, hits hardest), minute (twice as long, faster) and second (reaches past the arena, fastest, weakest). Hands can't be parried and
    don't stop arrows: they pass through your ball, hitting it (ghost weapons, no knockback). Phase 2: the hands spin faster. */
 clockwork:{onSpawn(S,b,v){b.cs='open';b.ct=v.openSeconds;b.dealt=0},
  arms(S,b,v){const k=b.p2?1+(v.phase2SpinPercent||0)/100:1,far=Math.hypot(AW,AH);b.ws=[];
   [['hour',0],['minute',TAU/3],['second',2*TAU/3]].forEach(([h,a])=>{const len=v[h+'Reach']>0?v[h+'Reach']:far;
    b.ws.push(mkW('clockarm',v[h+'Power']*S.ds,len,v[h+'Spin']*k,{ang:a,dir:1,hand:h,ghost:1,kb:0,th:v[h+'Thickness']||WDEF.clockarm.th}))})},
  tick(S,b,dt,v){b.ct-=dt;const T=DATA.text;
   if(b.cs==='open'){if(b.ct<=v.windSeconds)b.tele=Math.max(b.tele||0,.05);S.bossNote=tpl(T.clockOpen||'Open {s}s',{s:Math.max(0,Math.ceil(b.ct))});
    if(b.ct<=0){const f=Math.min(1,b.dealt/Math.max(1,b.maxhp*v.fullDamagePercent/100));b.cs='spin';b.ct=v.maxSpin-(v.maxSpin-v.minSpin)*f;b.spinFor=b.ct;b.dealt=0;BOSS_CODE.clockwork.arms(S,b,v);
     b.inv=.05;b.ward=S.t+.05;fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+v.hourReach,col:b.col});snd(S,'zap');count(S,'clockSpins');count(S,'clockSpinTime',b.ct)}}
   else{b.inv=Math.max(b.inv||0,.05);b.ward=S.t+.05;S.bossNote=tpl(T.clockSpin||'Winding {s}s',{s:Math.max(0,Math.ceil(b.ct))});
    if(b.ct<=0){b.cs='open';b.ct=v.openSeconds;b.ws=[];b.inv=0;b.ward=0;fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+20,col:DATA.theme.page.gold});snd(S,'clack')}}},
  taken(S,b,amt,kind,type,v){if(b.cs==='open')b.dealt+=amt;return amt},
  phase2(S,b,v){}},
 /* The Thief: takes your bonus weapons (more than your weapon starts with) off your ball for the fight and swings them as your weapon type, with its Ramp.
    Nothing to steal (or a Talisman): fights with its own dagger. Phase 2: faster. */
 thief:{onSpawn(S,b,v){const P=S.P,W=P.W,p=S.player,n=W.fist?0:Math.max(0,p.ws.length-W.blades);
   if(n>0&&!S.talisman){p.ws.splice(p.ws.length-n,n);P.blades=p.ws.length;if(W.type==='bow')p.ws.forEach((w,i)=>{w.side=wOpt(W,i,p.ws.length,0).side});else p.ws.forEach((w,i)=>{w.ang=i*TAU/p.ws.length});
    for(let i=0;i<n;i++)b.ws.push(mkW(W.type,Math.max(3,P.pow*v.stealPowerPercent/100),Math.min(P.reach,v.maxReach),Math.min(P.spin,v.maxSpin),{ang:Math.PI+i*TAU/n,dir:-1,every:v.bowFireEvery}));
    b.stole=n;S.bossNote=n===1?(DATA.text.thiefStoleOne||'Stole 1 weapon'):tpl(DATA.text.thiefStole||'Stole {n} weapons',{n});fx(S,{k:'zap',x1:p.x,y1:p.y,x2:b.x,y2:b.y});count(S,'stolen',n)}
   else{const bw=DATA.bosses.thief.baseWeapon||{type:'dagger',power:9,reach:38,spin:8};b.ws.push(mkW(bw.type,bw.power*S.ds,bw.reach,bw.spin,{ang:rnd(S.rsrc)*TAU}));
    let a=null;if(!S.talisman&&!S.lock&&!(n>0))for(const x of S.run.augs)if(AUG[x.id]&&(!a||AUG[x.id].rar>AUG[a.id].rar))a=x;   // no bonus weapon: your highest-rarity augment, the top one on a tie
    if(a){setOff(S,[a]);const k=1+(AUG[a.id].rar+1)*v.augPerRarityPercent/100;for(const w of b.ws)w.pow*=k;b.body*=k;b.stoleAug=a.id;S.bossNote=tpl(DATA.text.thiefStoleAug||'Stole {name}',{name:AUG[a.id].name});fx(S,{k:'zap',x1:p.x,y1:p.y,x2:b.x,y2:b.y});count(S,'stolenAug')}
    else S.bossNote=n>0||S.talisman?(DATA.text.talismanBlocked||'Talisman'):S.lock&&S.run.augs.length?(DATA.text.padlocked||'Padlocked'):(DATA.text.thiefOwn||'Nothing to steal')}},
  phase2(S,b,v){const k=1+v.ragePercent/100;b.spd*=k;for(const w of b.ws){w.spin*=k;if(w.spin0b)w.spin0b*=k}}},
 /* The Eight Ball: invulnerable while any of its balls live. It racks with the 7 solids; clearing them costs it clearPercent of its Max HP and the
    7 stripes arrive (bigCount of them big, ramming along marked paths). Once they are gone it is alone, and can be pocketed. */
 eight:{onSpawn(S,b,v){S.pockets={r:v.pocketRadius,window:v.pocketWindow,bossPercent:v.bossPercent,bossCooldown:v.bossCooldown,stall:v.stallSeconds,climb:v.climbSeconds};b.dmgT={};b.phase='alone';
   if(!v.rack||!ENEMY.pool)return;b.phase='solids';
   const pv=ENEMY.pool.v,d=pv.rackSpacing,ax=AW*pv.rackX,rows=[[1],[2,3],[4,8,5],[6,7]];   // the solids' rack, apex toward you, the Eight Ball in the middle
   if(v.spread){const sp=spreadSpots(S,8,Math.max(b.r,ENEMY.pool.r),b);b.x=sp[0][0];b.y=sp[0][1];b.vx=b.vy=0;b.pause=pv.rackPause;for(let n=1;n<=7;n++)poolBall(S,n,sp[n][0],sp[n][1],false);return}   // spread: every ball at its own spot
   rows.forEach((row,i)=>row.forEach((n,j)=>{const x=ax+i*d*.866,y=AH/2+(j-(row.length-1)/2)*d;if(n===8){b.x=x;b.y=y;b.vx=b.vy=0;b.pause=pv.rackPause}else poolBall(S,n,x,y,false)}))},
  taken(S,b,amt,kind,type,v){if(!b.rage){b.dmgT[type]=(b.dmgT[type]||0)+amt;return amt}return type===b.resist?amt*(1-v.resistPercent/100):amt},
  tick(S,b,dt,v){
   const allies=S.balls.some(e=>e.alive&&e.team===1&&!e.boss);
   if(allies){b.inv=Math.max(b.inv||0,.1);b.ward=S.t+.1;S.bossNote=DATA.text.eightShielded||'Invulnerable'}   // shielded while its balls live
   else if(b.phase==='solids'){b.phase='stripes';S.bossNote='';b.inv=0;b.ward=0;   // rack cleared: it loses a share of Max HP and the stripes arrive
    const amt=Math.min(b.maxhp*v.clearPercent/100,b.hp-1),ar=b.armor;b.armor=0;S.hitKey='src:rackclear';damage(S,b,amt,'aoe');S.hitKey=null;b.armor=ar;fx(S,{k:'ring',x:b.x,y:b.y,r:110,col:DATA.theme.page.gold});snd(S,'impact');
    const pv=ENEMY.pool.v,d=pv.rackSpacing,left=S.player.x>AW/2,ax=left?AW*(1-pv.rackX)-30:AW*pv.rackX+30,rows=[[9],[10,11],[12,13,14,15]],big=[];
    const nums=[9,10,11,12,13,14,15];while(big.length<v.bigCount&&nums.length)big.push(nums.splice(rnd(S.rsrc)*nums.length|0,1)[0]);
    if(v.spread){const sp=spreadSpots(S,7,ENEMY.pool.r*pv.bigRadiusX,null);[9,10,11,12,13,14,15].forEach((n,i)=>{const e=poolBall(S,n,sp[i][0],sp[i][1],big.includes(n));fx(S,{k:'ring',x:e.x,y:e.y,r:e.r+12,col:e.col})})}
    else rows.forEach((row,i)=>row.forEach((n,j)=>{const x=clamp(ax+(left?-1:1)*i*d*.866,30,AW-30),y=AH/2+(j-(row.length-1)/2)*d,e=poolBall(S,n,x,y,big.includes(n));fx(S,{k:'ring',x:e.x,y:e.y,r:e.r+12,col:e.col})}))}
   else if(b.phase==='stripes'){b.phase='alone';S.bossNote=''}
   if(!b.rage&&b.hp<b.maxhp*v.rageAtHpPercent/100){b.rage=1;b.spd*=v.rageSpeedPercent/100;for(const w of b.ws)w.spin*=v.rageSpinPercent/100;
   fx(S,{k:'ring',x:b.x,y:b.y,r:120,col:DATA.theme.page.mult});
   let best=null;for(const k in b.dmgT)if(!best||b.dmgT[k]>b.dmgT[best])best=k;b.resist=best;if(best)S.bossNote=tpl(DATA.text.resisting||'Resists {type}',{type:(DATA.text.damageTypes||{})[best]||best})}}},
};
const BOSS={};
for(const k of dkeys(DATA.bosses)){const d=DATA.bosses[k];BOSS[k]=Object.assign(unitFromData(d),{rule:tpl(d.rule,d.values),p2:d.phase2?tpl(d.phase2,d.values):'',weak:d.weak||[],resists:d.resists||[],code:BOSS_CODE[k]||{}})}
const BOSS_POOL=DATA.bossPool.slice(),FINAL_BOSS=DATA.finalBoss;

function spawnEnemy(S,id,x,y,o){
 const d=BOSS[id]||ENEMY[id],boss=!!BOSS[id];o=o||{};
 const b=mkBall({team:1,def:d,kind:id,name:d.name,col:d.col,x,y,r:o.r||d.r,hp:o.hp||(boss?d.hp*BH0*S.bhs:d.hp*S.hs),spd:o.spd||d.spd,body:o.body!=null?o.body:(d.body||0)*S.ds,armor:(d.armor||0)*S.ds,boss,gen:o.gen||0});
 d.w.forEach((w,i)=>b.ws.push(mkW(w[0],w[1]*S.ds,w[2],w[3],Object.assign({ang:rnd(S.rsrc)*TAU+i*Math.PI,dir:rnd(S.rsrc)<.5?1:-1,ft:.8+rnd(S.rsrc),every:w[4]||1.9},w[5]?{th:w[5]}:{}))));   // optional thickness (big hammers)
 b.x=clamp(b.x,b.r+2,AW-b.r-2);b.y=clamp(b.y,b.r+2,AH-b.r-2);
 if(b.maxhp>S.refHp)S.refHp=b.maxhp;   // strongest enemy seen this fight: the yardstick for impact frames
 b.born=S.t;b.aim0=b.aim;launch(S,b);S.balls.push(b);
 if(boss&&!o.noBoss){S.boss=b;S.bossDef=d;if(d.code.onSpawn)d.code.onSpawn(S,b,d.v)}
 return b;
}

/* ---------- 3. augments ---------- */
/* Behaviour of each augment, by id. Names, text, rarity and numbers come from DATA.augments[id].
   Every hook is called as hook(a, S, x, v):
     a = this augment's own state. a.n persists for the whole run, a.f is wiped at the start of every fight.
     S = the fight state.   x = the event payload (see fire()).   v = this augment's "values" from the data file.
   A hook returns true when it did something, which makes the augment's card flash.
   Hooks: stats(P) at fight start; onStart; preHit(c); onHit(c); afterHit(c); onBounce(ball); onTouch(enemy); onParry(enemy);
          onHurt({att,raw,d}); onLethal(x); onKill(enemy); onBurn(enemy); onTick(dt); onWin(payoutLines).
   Extra: live(a,S,v) returns a short counter shown during fights; info(a,v) returns a line shown on the card. */
const enemies=S=>S.balls.filter(b=>b.alive&&b.team===1);
/* The count of whichever event this fight has had most of: hits, bounces, crits, collisions or kills (Singularity). */
/* How many different statuses your side has applied this fight (Convergence): Burn, Chill or Freeze, Poison, Shock. */
const statusesApplied=S=>{const C=S.count||{};return(C.burn>0)+(C.chill>0||C.freezes>0)+(C.poison>0)+(C.shock>0)+(C.siphon>0)};
/* How many kinds of damage over time an enemy has on it right now (Catalyst): Poison, Burn, and Siphon if it was siphoned in the last second. */
const dotKinds=(S,e)=>(e.poison>0)+(e.burn>0)+(S.t-(e.siphT==null?-9:e.siphT)<1);
const topEvent=S=>{const C=S.count||{};return Math.max(C.hits||0,C.bounces||0,C.crits||0,(C.collisions||0)+(C.enemyCollisions||0),C.kills||0)};
/* How many Minis you have, for effects that count them (Hive Mind, Underdog). With Mitosis, each of your other halves counts as miniCount. */
const minis=S=>{let n=0;for(const b of S.balls)if(b.alive){if(b.mini)n++;else if(b.miniCount&&b!==S.player)n+=b.miniCount}return n};
/* Mitosis halves. Every half is a ball of yours with its own ramp (b.ramp), its own copy of your augments' fight state (b.st) and its own Minis
   (b.owner). Everything a half does runs "as" that half: S.player, S.ramp, S.lastBounce and S.hitCount point at it, and fire() uses its augment
   copies, so its hooks react to its own bounces, hits, kills and timers. halfOf(ball) is the twin that owns a ball, or null for your main ball. */
const halfOf=b=>!b?null:b.twin?b:(b.owner&&b.owner.twin?b.owner:null);
function enterHalf(S,h){const cur=S.player;if(!h||h===cur||!h.alive)return null;cur.lb=S.lastBounce;cur.hc=S.hitCount;S.player=h;S.ramp=h.ramp;S.lastBounce=h.lb==null?-9:h.lb;S.hitCount=h.hc||0;return cur}
function exitHalf(S,prev){if(!prev)return;const h=S.player;h.lb=S.lastBounce;h.hc=S.hitCount;S.player=prev;S.ramp=prev.ramp;S.lastBounce=prev.lb==null?-9:prev.lb;S.hitCount=prev.hc||0}
function asHalf(S,h,fn){const t=enterHalf(S,h);try{return fn()}finally{exitHalf(S,t)}}
/* A half is gone: its Minis, Mini-Yous, clones and Hut go with it. */
function dropHalf(S,h){for(const b of S.balls)if(b.alive&&b.owner===h){b.alive=false;fx(S,{k:'burst',x:b.x,y:b.y,col:b.col,n:6})}}
/* Mitosis damage cut: while two or more of your halves live, everything your side deals (not Minis' rams) is cut to S.splitCut. */
const splitOn=S=>!!(S.twins&&S.twins.some(t=>t.alive));
/* How hard your side pushes on a passed-on or Mini knock: your Knockback, or Impact on Bare Fists (they have no blade, so no Knockback). */
const pushStat=S=>S.P.W.fist?S.P.impact+S.P.kb:S.P.kb;
const nearestEnemy=S=>{const p=S.player;return enemies(S).sort((x,y)=>Math.hypot(x.x-p.x,x.y-p.y)-Math.hypot(y.x-p.x,y.y-p.y))[0]};
const AUG_CODE={
 // bounce
 rubber:{onBounce(a,S,b,v){a.f.c=Math.min(v.max,(a.f.c||0)+1);return true},
  onHit(a,S,c,v){if(a.f.c&&c.src!=='aoe'){c.power+=v.power*a.f.c;a.f.c=0;return true}},live:(a,S,v)=>a.f.c?'+'+f1(v.power*a.f.c):''},
 pinball:{onBounce(a,S,b,v){if(S.ramp.spd<v.maxPercent/100){S.ramp.spd+=v.speedPercent/100;return true}}},
 echo:{onBounce(a,S,b,v){a.f.c=(a.f.c||0)+1;if(a.f.c%v.every===0){wave(S,b.x,b.y,v.radius,v.powerPercent/100,DATA.theme.damageText.area);return true}}},
 corner:{onHit(a,S,c,v){if(S.t-S.lastBounce<v.window){c.mult*=v.mult;return true}}},
 battery:{onBounce(a,S,b,v){a.f.m=(a.f.m||0)+v.mult},onHit(a,S,c){if(a.f.m){c.mult+=a.f.m;return true}},live:a=>a.f.m?'+'+f1(a.f.m)+' '+DATA.text.statNames.mult:''},
 hyper:{stats(a,S,P,v){P.bounceX+=v.count-1}},
 momentum:{onHit(a,S,c,v){const s=S.player.spd;if(s>0){c.power+=s/v.speedPer;return true}},live:(a,S,v)=>'+'+f1(S.player.spd/v.speedPer)},
 // blade
 whet:{stats(a,S,P,v){P.pow+=v.power}},
 gyro:{stats(a,S,P,v){P.spin*=1+v.percent/100}},
 handle:{stats(a,S,P,v){P.reach*=1+v.percent/100}},
 combo:{onHit(a,S,c,v){if(S.t-(a.f.t==null?-9:a.f.t)<v.window)a.f.m=(a.f.m||0)+v.mult;else a.f.m=0;a.f.t=S.t;if(a.f.m){c.mult+=a.f.m;return true}},live:(a,S,v)=>a.f.m&&S.t-a.f.t<v.window?'+'+f1(a.f.m)+' '+DATA.text.statNames.mult:''},
 twin:{stats(a,S,P,v){if(P.W.fist){for(const k in P.W.rampDef)if(k!=='maxSpeedBonusPercent'){P.rampAdd[k]=(P.rampAdd[k]||0)+v.fistRamp;break}}else P.blades+=v.blades}},   // Bare Fists: +fistRamp to its Ramp step
 centri:{onHit(a,S,c,v){const w=S.player.ws[0];if(w&&w.spin>0){c.power+=Math.min(v.max,w.spin*v.power);return true}},live:(a,S,v)=>{const w=S.player.ws[0];return w&&w.spin>0?'+'+f1(Math.round(Math.min(v.max,w.spin*v.power)*10)/10):''}},   // capped at max
 parry:{onParry(a,S,e,v){playerHit(S,e,'aoe',v.powerPercent/100);return true}},
 glass:{stats(a,S,P,v){P.hp*=v.hpPercent/100},onHit(a,S,c,v){c.mult*=v.mult;return true}},
 // crit
 coin:{stats(a,S,P,v){P.crit+=v.percent/100}},
 eye:{stats(a,S,P,v){P.critMult+=v.bonus}},
 jackpot:{onHit(a,S,c,v){if(c.crit&&(a.f.g||0)<v.max){a.f.g=(a.f.g||0)+v.gold;S.gold+=v.gold;return true}}},
 exec:{onHit(a,S,c,v){const t=c.target;if(c.crit&&t.hp/t.maxhp<v.hpPercent/100){if(t.boss)c.mult*=v.bossMult;else c.kill=true;return true}}},
 dice:{preHit(a,S,c,v){if(c.n%v.every===0){c.crit=true;return true}}},
 // poison
 venom:{afterHit(a,S,c,v){addPoison(S,c.target,v.stacks*c.status);return true}},
 fester:{stats(a,S,P,v){P.poisonX*=v.mult}},
 neuro:{onHit(a,S,c,v){const p=c.target.poison;if(p>0){c.mult+=v.mult*p;return true}}},
 plague:{onKill(a,S,e){if(e.poison>0){let any=false;for(const o of enemies(S)){o.poison+=e.poison;any=true}return any}}},
 miasma:{onBounce(a,S,b,v){for(const e of enemies(S))addPoison(S,e,v.stacks);return true}},
 // burn
 match:{afterHit(a,S,c,v){addBurn(S,c.target,v.stacks*c.status);return true}},
 accel:{stats(a,S,P,v){P.burnDecay*=v.fadeMult;P.burnX*=1+v.damagePercent/100}},
 flash:{onBurn(a,S,t,v){if(t.burn>=v.threshold&&t.alive){const n=t.burn;t.burn=0;fx(S,{k:'ring',x:t.x,y:t.y,r:v.radius,col:DATA.theme.damageText.burn});snd(S,'boom');for(const e of enemies(S))if(Math.hypot(e.x-t.x,e.y-t.y)<v.radius+e.r)damage(S,e,n*v.powerPercent/100*(S.P.pow+S.ramp.pow)*S.P.burnX*S.overtime,'burn');return true}}},
 streak:{onHit(a,S,c,v){if(c.crit){c.status*=v.mult;return true}}},
 // shock
 coil:{afterHit(a,S,c,v){if(c.src==='aoe'||c.n%v.every!==0||!c.dealt)return;const t=c.target,o=enemies(S).filter(e=>e!==t).sort((p,q)=>Math.hypot(p.x-t.x,p.y-t.y)-Math.hypot(q.x-t.x,q.y-t.y)).slice(0,v.targets);
  if(o.length)for(const e of o){fx(S,{k:'zap',x1:t.x,y1:t.y,x2:e.x,y2:e.y});damage(S,e,c.dealt*v.percent/100,'shock')}else if(t.alive){fx(S,{k:'zap',x1:S.player.x,y1:S.player.y,x2:t.x,y2:t.y});damage(S,t,c.dealt*v.soloPercent/100,'shock')}snd(S,'zap');return true}},
 capacitor:{onBounce(a,S,b,v){a.f.c=Math.min(v.max,(a.f.c||0)+1)},
  afterHit(a,S,c,v){if(c.src==='aoe'||!a.f.c)return;const n=a.f.c;a.f.c=0;snd(S,'zap');for(const e of enemies(S)){fx(S,{k:'zap',x1:S.player.x,y1:S.player.y,x2:e.x,y2:e.y});playerHit(S,e,'aoe',v.powerPercent/100*n)}return true},live:a=>a.f.c?a.f.c+' '+DATA.text.charge:''},
 tesla:{onTick(a,S,dt,v){a.f.t=(a.f.t||0)+dt;if(a.f.t>=v.interval){a.f.t=0;const p=S.player,e=nearestEnemy(S);if(e){fx(S,{k:'zap',x1:p.x,y1:p.y,x2:e.x,y2:e.y});snd(S,'zap');playerHit(S,e,'aoe',v.powerPercent/100);return true}}}},
 // body
 iron:{stats(a,S,P,v){P.armor+=v.armor}},
 /* Armor build (16 Nov 2026): Tempered Plate grows each won fight (a.n), Stone Heart turns Max HP into Armor, Ironclad turns Armor into Power. */
 forged:{stats(a,S,P){P.armor+=a.n||0},onWin(a,S,lines,v){a.n=(a.n||0)+v.armor},info:a=>tpl(DATA.text.currently,{value:'+'+f1(a.n||0)+' '+DATA.text.statNames.armor})},
 stoneheart:{stats(a,S,P,v){P.armor+=Math.floor(P.hp/v.hpPer)}},
 ironclad:{stats(a,S,P,v){if(P.armor>0)P.pow+=Math.floor(P.armor*v.power)}},
 /* ---------- Void augments (Night Market, 16 Nov 2026). They take no socket, can't be sold, run after every augment (source kind 'void'). ---------- */
 /* Empty Hands: no weapon (Bare Fists: no body-hit damage) and no On hit effects, except on slams: an enemy you knocked that hits a wall or another
    enemy within window takes percent% Power x Mult as a hit that triggers On hit effects. Contacts push with Impact + Knockback, like Bare Fists. */
 vhands:{stats(a,S,P,v){P.noWeapon=1;P.noOnHit=1;P.blades=0;P.impact+=v.impact},
  onEnemyWall(a,S,x,v){const b=x.ball;if(b.knockT==null||S.t-b.knockT>v.window||S.t<(b.vhT||0))return;b.vhT=S.t+v.cooldown;voidSlam(S,b,v);return true},
  onCollide(a,S,x,v){const p=x.a,q=x.b;if(p.team!==1||q.team!==1)return;const fresh=b=>b.knockT!=null&&S.t-b.knockT<v.window;if(!fresh(p)&&!fresh(q))return;
   let any=false;for(const b of[p,q])if(S.t>=(b.vhT||0)){b.vhT=S.t+v.cooldown;voidSlam(S,b,v);any=true}return any}},
 /* Gluttony: each kill grows you (Size) and slows you, up to sizeMax/speedMax over the run (a.n kills). Max HP cut to hpPercent. ×Mult grows with
    Size above normal from any source: +mult per 10%. */
 vglut:{stats(a,S,P,v){const k=a.n||0;P.size*=1+Math.min(v.sizeMax,k*v.size)/100;P.spd*=1-Math.min(v.speedMax,k*v.speed)/100;P.hp*=v.hpPercent/100},
  onKill(a,S,e,v){const k=a.n||0;if(k*v.size>=v.sizeMax&&k*v.speed>=v.speedMax)return;const f=n=>1+Math.min(v.sizeMax,n*v.size)/100,g=n=>1-Math.min(v.speedMax,n*v.speed)/100;
   a.n=k+1;const p=S.player,r=f(k+1)/f(k);S.P.size*=r;p.r=S.P.size;p.m=p.r*p.r/324;S.P.spd*=g(k+1)/g(k);return true},
  onHit(a,S,c,v){const m=1+v.mult*Math.max(0,S.player.r/RULES.player.radius-1)*10;if(m>1.001){c.mult*=m;return true}},
  info:(a,v)=>tpl(DATA.text.currently,{value:'+'+f1(Math.min(v.sizeMax,(a.n||0)*v.size))+'% '+(DATA.text.statNamesExtra.size||'Size')}),
  live:(a,S,v)=>'×'+f1(1+v.mult*Math.max(0,S.player.r/RULES.player.radius-1)*10)},
 /* Cursed Gold: fight payouts cut by cut%; ×Mult +per for each $1 you hold. */
 vgold:{onWin(a,S,lines,v){for(const l of lines)l[1]=Math.floor(l[1]*(1-v.cut/100))},onHit(a,S,c,v){if(S.run.gold>0){c.mult*=1+v.per*S.run.gold;return true}},live:(a,S,v)=>'×'+f1(1+v.per*S.run.gold)},
 /* Event Horizon: every enemy is pulled toward you all fight; ×mult Mult. */
 vpull:{onTick(a,S,dt,v){const p=S.player;for(const e of enemies(S)){const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy);if(d>1){e.vx+=dx/d*v.pull*dt;e.vy+=dy/d*v.pull*dt}}},onHit(a,S,c,v){c.mult*=v.mult;return true}},
 /* Echoing Void: sockets past keep are switched off; sockets 1 to keep trigger twice (handled in fire()). */
 vecho:{},
 /* Bleeding Edge: you lose drain% Max HP per second; every hit this fight adds +mult to a ×Mult. */
 vbleed:{onTick(a,S,dt,v){const p=S.player;if(!p.alive||p.inv>0)return;p.hp-=p.maxhp*v.drain/100*dt;if(p.hp<=0)playerDown(S)},
  onHit(a,S,c,v){a.f.k=(a.f.k||0)+1;c.mult*=1+v.mult*a.f.k;return true},live:(a,S,v)=>a.f.k?'×'+f1(1+v.mult*a.f.k):''},
 /* Retribution: what your Armor blocked from a hit (raw - taken) goes back to the attacker, times percent and your Mult on that enemy (dotMult). */
 retrib:{onHurt(a,S,x,v){const at=x.att;if(!at||!at.alive||at.team!==1||!(x.raw>x.d))return;const amt=(x.raw-x.d)*v.percent/100*dotMult(S,at);
  const k=S.hitKey;S.hitKey='aug:retrib';damage(S,at,amt,'aoe');S.hitKey=k;fx(S,{k:'spark',x:at.x,y:at.y});return true}},
 bastion:{onHurt(a,S,x,v){if(!x.capped||(a.f.n||0)>=v.max)return;a.f.n=(a.f.n||0)+1;S.P.pow+=v.power;return true},live:(a,S,v)=>a.f.n?'+'+f1(a.f.n*v.power):''},   // Power from hits taken at the Armor cap, this fight
 big:{stats(a,S,P,v){P.hp+=v.hp;P.size*=1+v.sizePercent/100}},
 spike:{onTouch(a,S,e,v){playerHit(S,e,'aoe',1,S.player.maxhp*v.hpPercent/100);return true}},
 thorn:{onHurt(a,S,x,v){if(x.att&&x.att.alive&&x.att.team===1){damage(S,x.att,x.raw*v.percent/100,'aoe');return true}}},
 jugg:{stats(a,S,P,v){P.pow+=Math.floor(P.hp/v.hpPer)}},
 heavy:{onHit(a,S,c,v){c.power+=S.player.maxhp/v.hpPer;return true},live:(a,S,v)=>'+'+f1(S.player.maxhp/v.hpPer)},   // reads Max HP at the moment of the hit, so socket order does not matter
 fang:{afterHit(a,S,c,v){if(c.dealt>0&&!S.noLeech){heal(S,S.player,Math.min(c.dealt*v.percent/100,S.player.maxhp*v.maxHealPercentOfMaxHpPerHit/100));return true}}},
 wind:{onLethal(a,S,x,v){if(!a.f.u&&!x.saved){a.f.u=1;x.saved=true;const p=S.player;p.hp=Math.ceil(p.maxhp*v.hpPercent/100);p.inv=v.seconds;fx(S,{k:'ring',x:p.x,y:p.y,r:90,col:DATA.theme.page.gold});return true}}},
 bers:{onHit(a,S,c,v){const p=S.player,m=1+(v.maxMult-1)*(1-p.hp/p.maxhp);if(m>1.02){c.mult*=m;return true}}},
 under:{onHit(a,S,c,v){if(enemies(S).length>1+minis(S)){c.mult*=v.mult;return true}}},
 // swarm
 /* Mini augments, round 2. Windows (Pack Bounce, Pack Contact, Pack Hunt) open at fight start and then every interval seconds. */
 /* Quests: once done, the reward is kept for the run even if the card is sold (run.questsDone; the 'quest' source kind applies reward()). */
 packquest:{reward(t,S,P,v){P.miniSpd=1;P.miniKb=Math.max(P.miniKb,v.knockPercent/100)},
  stats(a,S,P,v){if((a.n||0)>=v.need)AUG.packquest.reward(a,S,P,v)},
  onTick(a,S,dt,v){if(a.f.done||(a.n||0)>=v.need||(a.n||0)+(S.count.minis||0)<v.need)return;a.f.done=1;S.P.miniSpd=1;S.P.miniKb=Math.max(S.P.miniKb,v.knockPercent/100);
   for(const b of S.balls)if(b.alive&&b.mini&&!b.miniYou)b.spd=Math.max(b.spd,S.P.spd);fx(S,{k:'ring',x:S.player.x,y:S.player.y,r:80,col:DATA.theme.page.gold});return true},
  onWin(a,S,lines,v){if((a.n||0)<v.need)a.n=Math.min(v.need,(a.n||0)+(S.count.minis||0));if(a.n>=v.need)(S.run.questsDone||(S.run.questsDone={})).packquest=1},
  info:(a,v)=>(a.n||0)>=v.need?DATA.text.questDone||'Quest complete':tpl(DATA.text.questProgress||'Quest: {n}/{need}',{n:a.n||0,need:v.need}),
  live:(a,S,v)=>{const n=Math.min(v.need,(a.n||0)+(S.count.minis||0));return n>=v.need?'':n+'/'+v.need}},
 afterimage:{onTick(a,S,dt,v){a.f.t=(a.f.t||0)+dt;if(a.f.t<v.interval)return;a.f.t=0;let made=0,live=0;for(const b of S.balls)if(b.alive&&b.clone)live++;
   for(const m of S.balls.slice()){if(live>=v.maxClones)break;if(!m.alive||!m.mini||m.clone||m.miniYou||m.owner!==S.player)continue;
    const c=mkBall({team:0,mini:true,clone:true,kind:'mini',x:clamp(m.x+(rnd(S.rsrc)-.5)*30,12,AW-12),y:clamp(m.y+(rnd(S.rsrc)-.5)*30,12,AH-12),r:m.r,hp:m.maxhp,spd:m.spd,armor:m.armor,col:m.col});
    c.life=v.seconds;c.owner=m.owner;launch(S,c);S.balls.push(c);count(S,'clones');live++;made++}return made>0},
  live:(a,S,v)=>f1(Math.ceil((v.interval-(a.f.t||0))*10)/10)+'s'},
 nursery:{onStart(a,S,x,v){if(!a.n)return;for(let i=0;i<a.n;i++)spawnMini(S);return true},
  onWin(a,S,lines,v){let k=0;for(const b of S.balls)if(b.alive&&b.mini&&!b.clone&&!b.miniYou&&b.hp>=b.maxhp*v.percent/100)k++;a.n=Math.min(v.max,(a.n||0)+k)},
  info:a=>tpl(DATA.text.currently,{value:'+'+(a.n||0)+' '+(DATA.text.miniWord||'Minis')})},
 packbounce:{onTick(a,S,dt,v){a.f.t=(a.f.t==null?v.interval:a.f.t)+dt;if(a.f.t>=v.interval){a.f.t=0;S.miniBounce=S.t+v.seconds;return true}},live:(a,S,v)=>S.t<S.miniBounce?DATA.text.active||'On':f1(Math.ceil((v.interval-(a.f.t||0))*10)/10)+'s'},
 packcontact:{onTick(a,S,dt,v){a.f.t=(a.f.t==null?v.interval:a.f.t)+dt;if(a.f.t>=v.interval){a.f.t=0;S.miniTouch=S.t+v.seconds;return true}},live:(a,S,v)=>S.t<S.miniTouch?DATA.text.active||'On':f1(Math.ceil((v.interval-(a.f.t||0))*10)/10)+'s'},
 packhunt:{onTick(a,S,dt,v){a.f.t=(a.f.t==null?v.interval:a.f.t)+dt;if(a.f.t>=v.interval){a.f.t=0;S.miniHunt=S.t+v.seconds;S.miniHuntShare=Math.max(S.miniHuntShare,v.powerPercent/100);return true}},live:(a,S,v)=>S.t<S.miniHunt?DATA.text.active||'On':f1(Math.ceil((v.interval-(a.f.t||0))*10)/10)+'s'},
 lifeline:{stats(a,S,P,v){P.regen+=v.regen;P.miniRegen=Math.max(P.miniRegen,v.sharePercent/100)}},
 herd:{stats(a,S,P,v){P.armor+=v.armor;P.miniArmor=Math.max(P.miniArmor,v.sharePercent/100)}},
 skin:{stats(a,S,P,v){P.hurtInv=Math.max(P.hurtInv,v.seconds)}},
 mitosis:{onStart(a,S,x,v){for(let i=0;i<v.count;i++)spawnMini(S);return true}},
 brood:{onKill(a,S,e){spawnMini(S,e.x,e.y);return true}},
 hive:{onHit(a,S,c,v){const n=minis(S);if(n){c.mult+=v.mult*n;return true}}},
 /* Pack Tactics: Minis' rams trigger your On hit effects (without it they deal plain Power × Mult; see playerHit). */
 packtactics:{stats(a,S,P){P.miniProc=1}},
 /* Mini Hut: at fight start a Hut stands near you (a fixed ball on your side that enemies can attack). It makes a Mini every few seconds until it is
    destroyed. Minis alive at the end of a won fight are kept (a.n, up to keep) and come back at the start of the next fight. */
 hut:{onStart(a,S,x,v){const p=S.player,h=mkBall({team:0,hut:true,fixed:true,kind:'hut',x:clamp(p.x-p.r-v.radius-12,v.radius+2,AW-v.radius-2),y:clamp(p.y-70,v.radius+2,AH-v.radius-2),r:v.radius,hp:S.P.hp*v.hpPercent/100,spd:0,col:DATA.theme.balls.hut||'#c08552'});
   h.m=1e6;h.vx=h.vy=0;h.owner=S.player;S.balls.push(h);a.f.hut=h;for(let i=0;i<Math.min(a.n||0,v.max||99);i++){const m=spawnMini(S);if(m)m.hutOf=h}return true},
  onTick(a,S,dt,v){const h=a.f.hut;if(!h||!h.alive)return;a.f.t=Math.min(v.every,(a.f.t||0)+dt);if(a.f.t<v.every)return;
   let n=0;for(const b of S.balls)if(b.alive&&b.hutOf===h)n++;if(n>=(v.max||99))return;   // full: waits, and makes the next one as soon as one of its Minis falls
   a.f.t=0;const m=spawnMini(S,h.x,h.y+h.r);if(m)m.hutOf=h;return true},
  onWin(a,S,lines,v){let k=0;for(const b of S.balls)if(b.alive&&b.mini&&!b.clone&&!b.miniYou)k++;a.n=Math.min(v.keep,k)},
  info:a=>tpl(DATA.text.currently,{value:'+'+(a.n||0)+' '+(DATA.text.miniWord||'Minis')}),
  live:(a,S,v)=>{const h=a.f.hut;return h&&h.alive?f1(Math.ceil((v.every-(a.f.t||0))*10)/10)+'s':''}},
 /* Mitosis (id fission): at fight start (in your main ball only) a twin appears: your weapon and stats, its own ramp, its own copy of every augment's
    fight state (run-long state, a.n, is shared). It then runs every augment's onStart as itself (its own Minis, its own Hut...). While two or more
    halves live, each deals damagePercent. Mirror Ball or Resonator on it makes more twins. Each twin counts as countsAs Minis for the others. */
 fission:{stats(a,S,P,v){if(P.splitHp)return;P.splitHp=1;more(P,'hp',v.hpPercent/100)},   // every half has hpPercent of your Max HP (once, even with Mirror Ball or Resonator on it)
  onStart(a,S,x,v){const p=S.player;if(!p.player)return;S.twins=S.twins||[];S.splitCut=v.damagePercent/100;p.miniCount=v.countsAs;
   const P=S.P,W=P.W,k=S.twins.length,side=(k%2?-1:1)*(1+Math.floor(k/2));
   const t=mkBall({team:0,twin:true,miniCount:v.countsAs,kind:'player',x:clamp(p.x+(k>1?side*20:0),p.r+2,AW-p.r-2),y:clamp(p.y+side*(p.r*2+16),p.r+2,AH-p.r-2),r:p.r,hp:P.hp,spd:P.spd,armor:P.armor,col:p.col});
   t.ramp={pow:0,mult:0,spin:1,reach:0,arrows:0,hits:0,spd:0,crit:0,critOver:2};t.lb=-9;t.hc=0;
   t.st=S.run.augs.map(o=>{const s={id:o.id,f:{}};Object.defineProperty(s,'n',{get:()=>o.n,set:x_=>{o.n=x_},enumerable:true});return s});   // own fight state, shared run-long state
   if(!W.fist)for(let i=0;i<P.blades;i++)t.ws.push(mkW(W.type,0,P.reach,P.spin,Object.assign({every:W.fireEvery},wOpt(W,i,P.blades,.7),W.type==='bow'?{}:{ang:Math.PI+i*TAU/P.blades})));
   launch(S,t);S.balls.push(t);S.twins.push(t);fx(S,{k:'ring',x:t.x,y:t.y,r:t.r+16,col:DATA.theme.page.gold});
   asHalf(S,t,()=>fire(S,'onStart',null));return true}},
 // shot
 sidearm:{onTick(a,S,dt,v){a.f.t=(a.f.t||0)+dt;if(a.f.t>=v.interval){a.f.t=0;const p=S.player,e=nearestEnemy(S);if(e){shoot(S,p,Math.atan2(e.y-p.y,e.x-p.x),v.powerPercent/100,false,1);return true}}}},
 rico:{stats(a,S,P,v){P.projBounce+=v.bounces}},
 multi:{stats(a,S,P,v){P.projExtra+=v.count}},
 // gold and scaling
 piggy:{onWin(a,S,lines,v){lines.push([DATA.augments.piggy.name,v.gold])}},
 plating:{stats(a,S,P,v){P.pow+=Math.floor(S.run.gold/v.goldPer)}},
 hunter:{stats(a,S,P){P.pow+=a.n||0},onKill(a,S,e,v){a.n=(a.n||0)+v.power;S.P.pow+=v.power;return true},info:a=>tpl(DATA.text.currently,{value:'+'+f1(a.n||0)+' '+DATA.text.statNames.power})},
 bloom:{onWin(a,S,lines,v){a.n=(a.n||0)+v.mult},onHit(a,S,c){if(a.n){c.mult+=a.n;return true}},info:a=>tpl(DATA.text.currently,{value:'+'+f1(a.n||0)+' '+DATA.text.statNames.mult})},
 // epic
 /* Earthquake: every few bounces, the wall it hit shakes and every enemy takes a share of Power (through playerHit as 'aoe', so Mult and other augments apply) and is stunned for a moment (bosses less). */
 quake:{onBounce(a,S,b,v){a.f.c=(a.f.c||0)+1;if(a.f.c%v.every)return;
   const dl=b.x,dr=AW-b.x,dt=b.y,db=AH-b.y,m=Math.min(dl,dr,dt,db);   // the nearest wall is the one it just hit
   fx(S,{k:'quake',x:m===dl?0:m===dr?AW:b.x,y:m===dt?0:m===db?AH:b.y,shake:v.shake});snd(S,'boom');
   for(const e of enemies(S)){e.stun=Math.max(e.stun||0,v.stunSeconds*(e.boss?.4:1));playerHit(S,e,'aoe',v.percent/100)}return true},
  live:(a,S,v)=>((a.f.c||0)%v.every)+'/'+v.every},

 /* ---------- added 15 Nov 2026 (augment draft 1). Shared helpers: addChill, freeze, knockBy, count, inc, more (section 4 and 5). ---------- */
 // collisions and knockback
 bumper:{onTouch(a,S,e,v){a.f.p=v.power;return true},onHit(a,S,c){if(a.f.p&&c.src!=='aoe'){c.power+=a.f.p;a.f.p=0;return true}},live:a=>a.f.p?'+'+f1(a.f.p):''},
 lead:{stats(a,S,P,v){P.size*=1+v.sizePercent/100;P.armor+=v.armor}},
 heavyswing:{stats(a,S,P,v){inc(P,'kb',v.percent/100);P.pow+=v.power}},
 // reach (added with the Spear rework): Pike and Horizon read the blade's live length, so the Spear's Reach ramp feeds them
 pike:{onHit(a,S,c,v){if(c.src!=='weapon'&&!(c.src==='proj'&&S.arrow))return;   // blade hits and Bow arrows
  const w=S.player.ws[0];if(w&&w.len>0){c.power+=w.len/v.reachPer;return true}},live:(a,S,v)=>{const w=S.player.ws[0];return w&&w.len>0?'+'+f1(Math.floor(w.len/v.reachPer*10)/10):''}},
 sweetspot:{onHit(a,S,c,v){if((c.src==='weapon'&&S.bladeAt>=v.reach)||(c.src==='proj'&&S.arrow&&S.arrowD>=v.arrowRange)){c.mult*=v.mult;return true}}},
 sweep:{stats(a,S,P){P.sweep++}},
 horizon:{onHit(a,S,c,v){const w=S.player.ws[0];if(!w)return;const m=1+v.mult*Math.max(0,w.len-S.P.W.reach)/v.reachPer;if(m>1){c.mult*=m;return true}},
  live:(a,S,v)=>{const w=S.player.ws[0];return w?'×'+f1(1+v.mult*Math.max(0,w.len-S.P.W.reach)/v.reachPer):''}},
 wallslam:{onEnemyWall(a,S,x,v){const b=x.ball;if(b.knockT==null||S.t-b.knockT>v.window)return;b.knockT=null;
   fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+18,col:DATA.theme.effects.spark});snd(S,'impact');playerHit(S,b,'aoe',v.percent/100);return true}},
 chainrx:{onCollide(a,S,x,v){const p=x.a,q=x.b;if(p.team!==1||q.team!==1||x.impact<v.minImpact||S.t<(p.crT||0)||S.t<(q.crT||0))return;
   p.crT=q.crT=S.t+v.cooldown;fx(S,{k:'spark',x:(p.x+q.x)/2,y:(p.y+q.y)/2});playerHit(S,p,'aoe',v.percent/100);playerHit(S,q,'aoe',v.percent/100);return true}},
 undertow:{onTick(a,S,dt,v){const p=S.player;for(const e of enemies(S)){const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy);if(d<v.radius&&d>1){e.vx+=dx/d*v.pull*dt;e.vy+=dy/d*v.pull*dt}}}},
 breakshot:{onCollide(a,S,x,v){const p=x.a.player?x.a:x.b.player?x.b:null;if(!p)return;const e=p===x.a?x.b:x.a;if(e.team!==1)return;
   playerHit(S,e,'aoe',v.percent/100*x.impact/100);return true}},
 /* knockback family (added 15 Nov 2026): Knockback = blade hits (P.kb), Impact = ball bumps (P.impact); both mark enemies with knockT */
 battering:{stats(a,S,P,v){P.impact+=v.impact}},
 followthrough:{onHit(a,S,c,v){const t=c.target;if(t.knockT!=null&&S.t-t.knockT<v.window){c.mult+=v.mult;return true}}},
 wrecking:{stats(a,S,P,v){const n=Math.floor(P.hp/v.hpPer);if(n>0){inc(P,'kb',n*v.percent/100);P.impact+=n*v.impact}}},   // counts Max HP from augments above
 /* Newton's Cradle: an enemy knocked in the last moment that hits another enemy passes the knock on (which can chain) and that enemy takes a share of Power. */
 /* Newton's Cradle: a freshly knocked enemy that hits another passes the knock on and deals percent% Power. Each pass adds one to the chain
    (t.ncN; a knock from you starts a new chain). From showAt passes "Chain ×n" floats over the hit; heavyAt and massiveAt play the impact frames. */
 cradle:{onKnock(a,S,t){if(!a.f.busy)t.ncN=0},
  onCollide(a,S,x,v){const p=x.a,q=x.b;if(p.team!==1||q.team!==1)return;const fresh=b=>b.knockT!=null&&S.t-b.knockT<v.window;
   const src=fresh(p)&&(!fresh(q)||p.knockT>=q.knockT)?p:fresh(q)?q:null;if(!src)return;const dst=src===p?q:p;if(S.t<(dst.ncT||0))return;dst.ncT=S.t+v.cooldown;
   a.f.busy=1;knockBy(S,dst,src.x,src.y,pushStat(S)*v.knockPercent/100);a.f.busy=0;const n=dst.ncN=(src.ncN||0)+1;
   fx(S,{k:'spark',x:(p.x+q.x)/2,y:(p.y+q.y)/2});snd(S,'clack');const d=playerHit(S,dst,'aoe',v.percent/100);
   if(n>(a.f.best||0))a.f.best=n;count(S,'cradleChain');if(n>=v.showAt)fx(S,{k:'streak',x:dst.x,y:dst.y,n});
   if(IMP&&S.juice&&(n===v.heavyAt||n===v.massiveAt)){const L=IMP.levels.map(l=>l.minPercentOfMaxHp).sort((m,k)=>m-k);S.fx.push({k:'impact',pct:n===v.massiveAt?L[L.length-1]:L[0],x:dst.x,y:dst.y,dmg:d});S.hold=true}
   return true},
  live:a=>a.f.best>1?tpl(DATA.text.chainBest||'Best ×{n}',{n:a.f.best}):''},
 rack:{onHit(a,S,c,v){const n=(S.count.collisions||0)+(S.count.enemyCollisions||0);if(n){c.mult*=Math.pow(v.mult,n);return true}},
  live:(a,S,v)=>{const n=(S.count.collisions||0)+(S.count.enemyCollisions||0);return n?'×'+f1(Math.pow(v.mult,n)):''}},
 // chill and freeze
 frost:{afterHit(a,S,c,v){addChill(S,c.target,v.stacks*c.status);return true}},
 shatter:{onHit(a,S,c,v){const t=c.target;if(t.frozen>0){c.mult*=v.mult;t.frozen=0;fx(S,{k:'burst',x:t.x,y:t.y,col:DATA.theme.effects.freeze||'#d9f4ff',n:16});return true}}},
 glacial:{stats(a,S,P,v){P.frozenX*=v.mult}},
 stasis:{onTick(a,S,dt,v){a.f.t=(a.f.t||0)+dt;if(a.f.t>=v.interval){a.f.t=0;for(const e of enemies(S))freeze(S,e,v.seconds);snd(S,'zap');return true}},
  live:(a,S,v)=>f1(Math.ceil((v.interval-(a.f.t||0))*10)/10)+'s'},
 // burn
 kindling:{onStart(a,S,x,v){for(const e of enemies(S))addBurn(S,e,v.stacks);return true}},
 thermal:{onBurn(a,S,t,v){if(a.f.busy||!t.alive||!(t.chill>0)||!(t.burn>0))return;   // busy: its own hit can add Chill and Burn again, which must not loop
   const n=t.burn+t.chill;t.burn=0;t.chill=0;a.f.busy=1;fx(S,{k:'ring',x:t.x,y:t.y,r:t.r+20,col:DATA.theme.damageText.burn});snd(S,'boom');
   playerHit(S,t,'aoe',v.percent/100*n);a.f.busy=0;return true}},
 fuel:{onHit(a,S,c,v){const b=c.target.burn;if(b>0){c.mult+=v.mult*b;return true}}},
 afterburner:{onBounce(a,S,b,v){if(!b.player&&!b.twin)return;const e=nearestEnemy(S);if(e){addBurn(S,e,v.stacks);return true}}},
 wildfire:{onCollide(a,S,x,v){const p=x.a,q=x.b;if(p.team!==1||q.team!==1)return;const src=p.burn>=q.burn?p:q,dst=src===p?q:p;
   if(!(src.burn>0)||S.t<(dst.wfT||0))return;dst.wfT=S.t+v.cooldown;addBurn(S,dst,Math.ceil(src.burn*v.percent/100));return true}},
 inferno:{stats(a,S,P,v){P.burnDecay=0;P.burnGrow+=v.percent/100}},
 // speed, size, sockets
 adrenaline:{onHurt(a,S,x,v){if(!a.f.on){S.ramp.spd+=v.percent/100;a.f.on=1}a.f.until=S.t+v.seconds;return true},
  onTick(a,S,dt,v){if(a.f.on&&S.t>a.f.until){S.ramp.spd-=v.percent/100;a.f.on=0}}},
 velocity:{stats(a,S,P,v){P.pow+=Math.floor(P.spd/v.speedPer)}},
 terminal:{onHit(a,S,c,v){const sp=S.player.spd+S.over.spd,m=1+v.mult*Math.max(0,sp-S.P.W.spd)/v.speedPer;if(m>1){c.mult*=m;return true}},
  live:(a,S,v)=>'×'+f1(1+v.mult*Math.max(0,S.player.spd+S.over.spd-S.P.W.spd)/v.speedPer)},
 colossus:{onHit(a,S,c,v){c.mult*=1+v.mult*S.player.maxhp/v.hpPer;return true},live:(a,S,v)=>'×'+f1(1+v.mult*S.player.maxhp/v.hpPer)},
 overclock:{onHit(a,S,c,v){const CB=RULES.combat,o=S.over.spd/CB.maxPlayerSpeed+S.over.spin/CB.maxSpin+S.P.over.blades/4;if(o>0){c.mult+=v.mult*o*10;return true}}},
 spare:{stats(a,S,P,v){P.mult+=v.mult*Math.max(0,S.run.slots-S.run.augs.length)}},
 tagteam:{stats(a,S,P){const t=new Set();for(const x of S.run.augs){const d=AUG[x.id];if(d)for(const g of d.tags)t.add(g)}a.f.k=t.size},
  onHit(a,S,c,v){if(a.f.k){inc(c,'power',v.percent/100*a.f.k);return true}},live:(a,S,v)=>a.f.k?'+'+f1(v.percent*a.f.k)+'%':''},
 specialist:{stats(a,S,P){const n={};let m=0;for(const x of S.run.augs){const d=AUG[x.id];if(d)for(const g of d.tags){n[g]=(n[g]||0)+1;if(n[g]>m)m=n[g]}}a.f.k=m},
  onHit(a,S,c,v){if(a.f.k){inc(c,'power',v.percent/100*a.f.k);return true}},live:(a,S,v)=>a.f.k?'+'+f1(v.percent*a.f.k)+'%':''},
 // wild cards
 resonator:{},   // handled in fire(): the augment below it triggers twice
 singularity:{onHit(a,S,c,v){const k=Math.floor(topEvent(S)/10);if(k){c.mult*=Math.pow(v.mult,k);return true}},live:(a,S,v)=>{const k=Math.floor(topEvent(S)/10);return k?'×'+f1(Math.pow(v.mult,k)):''}},
 /* Maw: in real fights, before stats, it eats the augment below it and keeps ×Mult for good: perGold per $1 of that augment's price (a Maw eaten by a Maw hands over what it had stored). */
 maw:{beforeFight(a,S,i,v){const run=S.run,nb=run.augs[i+1];if(!nb||isOff(S,a)||S.lock||(a.n||0)>=v.max)return;const d=AUG[nb.id];if(!d)return;   // full: it stops eating
   const gain=Math.min(v.max-(a.n||0),v.perEat+(nb.id==='maw'?(nb.n||0):0));a.n=(a.n||0)+gain;run.augs.splice(i+1,1);S.ate.push({id:nb.id,gain});
   fx(S,{k:'eat',by:AUG.maw.name,name:d.name,gain})},
  onHit(a,S,c){if(a.n){c.mult*=1+a.n;return true}},info:(a,v)=>tpl(DATA.text.currently,{value:'×'+f1(1+(a.n||0))+' '+DATA.text.statNames.mult})+((a.n||0)>=v.max?' · '+(DATA.text.full||'Full'):'')},
 // legendary
 /* Mini Me: Minis lose hpCut% of their Max HP (and Minis' rams deal miniDamagePercent). A Mini that stays alive for seconds in a fight turns into a
    Mini-You on the spot (up to max alive at once). Clones and Mini-Yous don't transform. */
 minime:{stats(a,S,P,v){P.miniHpX*=1-v.hpCut/100;P.miniDmgX*=v.miniDamagePercent/100},
  onTick(a,S,dt,v){let n=0,did=false;for(const b of S.balls)if(b.alive&&b.miniYou&&b.owner===S.player)n++;
   for(const b of S.balls.slice()){if(n>=v.max)break;if(!b.alive||!b.mini||b.miniYou||b.clone||b.owner!==S.player||S.t-(b.born||0)<v.seconds)continue;
    b.alive=false;const m=spawnMiniYou(S,v,b.x,b.y);fx(S,{k:'ring',x:m.x,y:m.y,r:m.r+16,col:DATA.theme.page.gold});n++;did=true}
   return did},
  live:(a,S)=>{let n=0;for(const b of S.balls)if(b.alive&&b.miniYou)n++;return n?'×'+n:''}},
 domino:{stats(a,S,P,v){P.domino={v,a}},live:a=>a.f.best>1?tpl(DATA.text.chainBest||'Best ×{n}',{n:a.f.best}):'',info:a=>a.n>1?tpl(DATA.text.chainRecord||'Record ×{n}',{n:a.n}):''},
 mirror:{},   // handled inside fire(): it runs the hooks of the augment below it
 /* Ambidextrous: ×mult on every hit while you carry need or more weapons (S.P.blades, after caps). */
 ambi:{onHit(a,S,c,v){if(S.P.blades>S.P.W.blades){c.mult*=v.mult;return true}},live:(a,S,v)=>S.P.blades>S.P.W.blades?'×'+f1(v.mult):''},   // a bonus weapon: more than your weapon starts with
 /* Convergence: ×Mult +per for each status applied this fight: Burn, Chill (or Freeze), Poison, Shock. */
 converge:{onHit(a,S,c,v){const n=statusesApplied(S);if(n){c.mult*=1+v.per*n;return true}},live:(a,S,v)=>{const n=statusesApplied(S);return n?'×'+f1(1+v.per*n):''}},
 /* Cap Legendaries: owning one removes that cap (uncapped()); selling it brings the cap back. */
 uncapspd:{uncap:'spd'},uncapspin:{uncap:'spin'},uncapblades:{uncap:'blades'},uncapvolley:{uncap:'volley'},uncaparmor:{uncap:'armor'},
 perpetual:{stats(a,S,P,v){P.rampX*=v.mult}},
 catalyst:{stats(a,S,P,v){P.cat={mult:v.mult,both:v.bothMult}}},
 /* Seeping Wounds: Poison and Burn ticks are multiplied by your current Mult on that enemy (dotMult(), the same Mult a hit on it would get, crits
    aside); percent scales how much of the Mult above ×1 counts. */
 /* Siphon (19 Nov 2026): turns Regen into damage over time on the nearest enemy; the damage itself is in step() (search "Siphon"). */
 siphon:{stats(a,S,P){P.siphon=(P.siphon||0)+1}},
 /* Cushion (19 Nov 2026): holds back percent% of each hit you take and deals it to you over seconds instead (a.f.pool, drained at a.f.rate per second).
    The drain pauses while you are immune. Regen heals against it. Resonator or Mirror Ball on it hold back percent% of what is left as well. */
 cushion:{onHurt(a,S,x,v){const left=x.d-(x.held||0);if(!(left>0))return;const h=left*v.percent/100;x.held=(x.held||0)+h;a.f.pool=(a.f.pool||0)+h;a.f.rate=(a.f.rate||0)+h/v.seconds;return true},
  onTick(a,S,dt,v){const p=S.player;if(!(a.f.pool>0)||!p.alive||p.inv>0)return;const amt=Math.min(a.f.pool,a.f.rate*dt);a.f.pool-=amt;if(a.f.pool<=1e-6){a.f.pool=0;a.f.rate=0}
   p.hp-=amt;a.f.sh=(a.f.sh||0)+amt;if(a.f.sh>=1&&S.t-(a.f.st||0)>=.5){text(S,p.x,p.y-p.r,a.f.sh,'hurt');a.f.sh=0;a.f.st=S.t}
   if(p.hp<=0){if(p.twin){p.alive=false;fx(S,{k:'burst',x:p.x,y:p.y,col:p.col,n:8});dropHalf(S,p)}else playerDown(S)}},
  live:a=>a.f.pool>=1?tpl(DATA.text.held||'{n} held',{n:short(a.f.pool)}):''},
 /* Pedigree (19 Nov 2026): +Power for each Rare, Epic and Legendary augment in your sockets (switched-off ones don't count; Void augments have no socket).
    values are keyed by rarity name in lower case. a.n keeps the last total for the card. */
 pedigree:{stats(a,S,P,v){let n=0;for(const x of S.run.augs){if(isOff(S,x))continue;const d=AUG[x.id];if(d)n+=v[RAR[d.rar].toLowerCase()]||0}a.n=n;P.pow+=n},
  info:a=>tpl(DATA.text.currently,{value:'+'+f1(a.n||0)+' '+DATA.text.statNames.power})},
 seep:{stats(a,S,P,v){P.dotMult=Math.max(P.dotMult||0,v.percent/100)}},
 mass:{preHit(a,S,c,v){S.ramp.crit+=v.percent/100;S.ramp.critOver=v.critMultPerOverflow}},
};
/* ---------- what the Your ball card shows (stat view) ----------
   Three hooks, run through fire() like a real hit so socket order, Mirror Ball, Resonator, Echoing Void and switched-off sockets all count:
   showPow (Power a hit gets on top of your Power stat), showMult (the +Mult and ×Mult, in socket order), showCrit.
   x.live: in a fight (timers and counters read live; the target is the nearest enemy, x.tgt). x.all: the second pass that assumes every conditional
   bonus with a fixed value applies, for the \"(+x)\" beside a stat. x.lines (first pass only): one line per source for the stat's hover list.
   A hook passes cond = a short reason when its bonus is not applying right now; val null means it has no fixed value (it grows in a fight). */
function shNote(x,stat,txt,cond){if(x.lines)x.lines.push({stat,key:x._key,id:x._id,txt,cond:cond||''})}
function shm(x,op,val,cond,txt){if(val!=null&&(!cond||x.all)){if(op==='+')x.m+=val;else x.m*=val}shNote(x,'mult',txt||(op==='+'?'+'+f1(val)+' Mult':'×'+f1(val)+' Mult'),cond)}
function shp(x,val,cond,txt){if(val!=null&&(!cond||x.all))x.p+=val;shNote(x,'pow',txt||'+'+f1(Math.round(val*10)/10)+' Power',cond)}
const TXC=k=>(DATA.text.condReasons||{})[k]||k;   // short reasons, data text.condReasons
const SHOW_POW={
 heavy(a,S,x,v){shp(x,S.player.maxhp/v.hpPer)},
 momentum(a,S,x,v){shp(x,S.player.spd/v.speedPer)},
 centri(a,S,x,v){const w=S.player.ws[0];if(w&&w.spin>0)shp(x,Math.min(v.max,w.spin*v.power))},
 pike(a,S,x,v){const w=S.player.ws[0];if(w&&w.len>0)shp(x,w.len/v.reachPer,TXC('weaponHits'))},
 rubber(a,S,x,v){if(x.live&&a.f.c)shp(x,v.power*a.f.c);else shp(x,null,TXC('afterBounces'),'+'+f1(v.power)+' Power per bounce, max +'+f1(v.power*v.max))},
 bumper(a,S,x,v){if(x.live&&a.f.p)shp(x,a.f.p);else shp(x,v.power,TXC('afterContact'))},
 bastion(a,S,x,v){if(!x.live)shp(x,null,TXC('atArmorCap'),'+'+f1(v.power)+' Power per hit taken, max +'+f1(v.maxPower))},
 tagteam(a,S,x,v){const k=a.f.k||0;if(k){x.pinc+=v.percent/100*k;shNote(x,'pow','+'+f1(v.percent*k)+'% Power')}},
 specialist(a,S,x,v){const k=a.f.k||0;if(k){x.pinc+=v.percent/100*k;shNote(x,'pow','+'+f1(v.percent*k)+'% Power')}},
};
const SHOW_CRIT={
 dice(a,S,x,v){if(x.live&&(S.hitCount+1)%v.every===0){x.c=Math.max(x.c,1);shNote(x,'crit','100% (this hit)')}else shNote(x,'crit','100% every '+v.every+' hits',TXC('everyN'))},
 mass(a,S,x,v){if(!x.live)shNote(x,'crit','+'+f1(v.percent)+'% Crit per hit',TXC('thisFight'))},
};
const SHOW_MULT={
 glass(a,S,x,v){shm(x,'×',v.mult)},
 horizon(a,S,x,v){const w=S.player.ws[0];if(!w)return;const m=1+v.mult*Math.max(0,w.len-S.P.W.reach)/v.reachPer;if(m>1.0001)shm(x,'×',m);else shm(x,'×',null,TXC('moreReach'),'+'+f1(v.mult)+' ×Mult per '+v.reachPer+' Reach')},
 terminal(a,S,x,v){const m=1+v.mult*Math.max(0,S.player.spd+S.over.spd-S.P.W.spd)/v.speedPer;if(m>1.0001)shm(x,'×',m);else shm(x,'×',null,TXC('moreSpeed'),'+'+f1(v.mult)+' ×Mult per '+v.speedPer+' Speed')},
 colossus(a,S,x,v){shm(x,'×',1+v.mult*S.player.maxhp/v.hpPer)},
 maw(a,S,x){if(a.n)shm(x,'×',1+a.n);else shm(x,'×',null,TXC('mawEats'),'×1 Mult')},
 bloom(a,S,x){if(a.n)shm(x,'+',a.n)},
 overclock(a,S,x,v){const CB=RULES.combat,o=S.over.spd/CB.maxPlayerSpeed+S.over.spin/CB.maxSpin+S.P.over.blades/4;if(o>0)shm(x,'+',v.mult*o*10);else shm(x,'+',null,TXC('overflow'),'+'+f1(v.mult)+' Mult per 10% Overflow')},
 battery(a,S,x,v){if(x.live&&a.f.m)shm(x,'+',a.f.m);else shm(x,'+',null,TXC('perBounce'),'+'+f1(v.mult)+' Mult per bounce')},
 hive(a,S,x,v){const n=x.live?minis(S):0;if(n)shm(x,'+',v.mult*n);else shm(x,'+',null,TXC('perMini'),'+'+f1(v.mult)+' Mult per Mini')},
 bers(a,S,x,v){const p=S.player,m=1+(v.maxMult-1)*(1-p.hp/p.maxhp);if(x.live&&m>1.02)shm(x,'×',m);else shm(x,'×',null,TXC('lowHp'),'up to ×'+f1(v.maxMult)+' Mult')},
 rack(a,S,x,v){const n=x.live?(S.count.collisions||0)+(S.count.enemyCollisions||0):0;if(n)shm(x,'×',Math.pow(v.mult,n));else shm(x,'×',null,TXC('perCollision'),'×'+f1(v.mult)+' Mult per Collision')},
 singularity(a,S,x,v){const k=x.live?Math.floor(topEvent(S)/10):0;if(k)shm(x,'×',Math.pow(v.mult,k));else shm(x,'×',null,TXC('topEvent'),'×'+f1(v.mult)+' Mult per 10 events')},
 ambi(a,S,x,v){if(S.P.blades>S.P.W.blades)shm(x,'×',v.mult);else shm(x,'×',v.mult,TXC('bonusWeapon'))},
 converge(a,S,x,v){const n=x.live?statusesApplied(S):0;if(n)shm(x,'×',1+v.per*n);else shm(x,'×',null,TXC('perStatus'),'+'+f1(v.per)+' ×Mult per Status')},
 corner(a,S,x,v){if(x.live&&S.t-S.lastBounce<v.window)shm(x,'×',v.mult);else shm(x,'×',v.mult,TXC('afterBounce'))},
 combo(a,S,x,v){if(x.live&&a.f.t!=null&&S.t-a.f.t<v.window)shm(x,'+',(a.f.m||0)+v.mult);else shm(x,'+',null,TXC('combo'),'+'+f1(v.mult)+' Mult per hit in a combo')},
 under(a,S,x,v){if(x.live&&enemies(S).length>1+minis(S))shm(x,'×',v.mult);else shm(x,'×',v.mult,TXC('outnumbered'))},
 neuro(a,S,x,v){const t=x.tgt;if(t&&t.poison>0)shm(x,'+',v.mult*t.poison);else shm(x,'+',null,TXC('perPoison'),'+'+f1(v.mult)+' Mult per Poison on the target')},
 fuel(a,S,x,v){const t=x.tgt;if(t&&t.burn>0)shm(x,'+',v.mult*t.burn);else shm(x,'+',null,TXC('perBurn'),'+'+f1(v.mult)+' Mult per Burn on the target')},
 followthrough(a,S,x,v){const t=x.tgt,own=!x.dot&&(S.P.W.fist?S.P.impact>0:S.P.kb>0);if(own||(t&&t.knockT!=null&&S.t-t.knockT<v.window))shm(x,'+',v.mult);else shm(x,'+',v.mult,TXC('knocked'))},   // your weapon hit (or Fists' bump with Impact) knocks the enemy just before it lands
 shatter(a,S,x,v){const t=x.tgt;if(t&&t.frozen>0)shm(x,'×',v.mult);else shm(x,'×',v.mult,TXC('frozen'))},
 sweetspot(a,S,x,v){shm(x,'×',v.mult,TXC('farHits'))},
 exec(a,S,x,v){shm(x,'×',v.bossMult,TXC('bossCrits'))},
 vglut(a,S,x,v){const r=S.player.r||S.P.size,m=1+v.mult*Math.max(0,r/RULES.player.radius-1)*10;if(m>1.001)shm(x,'×',m);else shm(x,'×',null,TXC('moreSize'),'+'+f1(v.mult)+' ×Mult per 10% Size')},
 vgold(a,S,x,v){if(S.run.gold>0)shm(x,'×',1+v.per*S.run.gold);else shm(x,'×',null,TXC('goldHeld'),'+'+f1(v.per)+' ×Mult per $1')},
 vpull(a,S,x,v){shm(x,'×',v.mult)},
 vbleed(a,S,x,v){const k=x.live?a.f.k||0:0;if(k)shm(x,'×',1+v.mult*k);else shm(x,'×',null,TXC('perHit'),'+'+f1(v.mult)+' ×Mult per hit')},
};
/* Your Mult on one enemy for damage over time (Seeping Wounds): like shownMult, but no Fists Speed factor and no knock from a weapon hit (x.dot). */
function dotMult(S,e){const x={m:S.P.mult+S.ramp.mult+(OVF_ON?overflowMult(S):0),live:true,tgt:e,dot:true};fire(S,'showMult',x);return x.m}
/* The Mult shown in a fight: what your next hit would get right now (crits aside), against the nearest enemy. */
function shownMult(S){return statView(S).mult}
/* A stand-in fight state for the shop, so the same hooks can be read outside a fight. */
function shopState(run){const P=calcPlayer(run,null),CB=RULES.combat;
 return{run,P,player:{maxhp:P.hp,hp:P.hp,spd:P.spd,r:P.size,ws:P.W.fist||P.noWeapon?[]:[{len:P.reach,spin:P.spin}]},over:{spd:Math.max(0,P.raw.spd-CB.maxPlayerSpeed),spin:Math.max(0,P.raw.spin-CB.maxSpin)},
  count:{},balls:[],src:null,cur:null,t:0,lastBounce:-9,hitCount:0,ramp:{pow:0,mult:0,crit:0,spd:0,spin:1,reach:0,arrows:0}}}
function shopMult(run){return statView(shopState(run)).mult}
/* The stat view. S is a fight (live) or shopState(run). Returns the main numbers (what your next hit gets now; in the shop, every always-on bonus),
   the extra if every fixed-value conditional bonus applied (powB, multB, hitB, critB) and, with withLines, the source lines of Power, Mult and Crit. */
function statView(S,withLines){
 const P=S.P,R=S.ramp,live=!!(S.balls&&S.balls.length&&S.player&&S.player.team===0&&S.player.alive);
 const fist=live&&P.W.fist&&P.spd>0?Math.max(1,S.player.spd/P.spd):1,tgt=live?nearestEnemy(S):null,lines=withLines?[]:null;
 const pass=all=>{const x={p:P.pow+(R.pow||0),pinc:0,m:(P.mult+(R.mult||0)+(OVF_ON&&S.over?overflowMult(S):0))*fist,c:P.crit+(R.crit||0),live,tgt,all,lines:all?null:lines};
  fire(S,'showPow',x);fire(S,'showMult',x);fire(S,'showCrit',x);x.p*=1+x.pinc;return x};
 const a=pass(false),b=pass(true);
 return{pow:a.p,powB:b.p-a.p,mult:a.m,multB:b.m-a.m,hit:a.p*a.m,hitB:b.p*b.m-a.p*a.m,crit:Math.min(1,a.c),fist,lines,live}
}
const RAR=DATA.rarities.map(r=>r.name),COST=DATA.rarities.map(r=>r.cost);
const AUG={};
for(const id of dkeys(DATA.augments)){const d=DATA.augments[id];
 if(!AUG_CODE[id])CORE_PROBLEMS.push('augments.'+id+' is in game-data.json but has no code in core.js (AUG_CODE). A new augment needs code as well as data.');
 AUG[id]=Object.assign({id,name:d.name,rar:Math.max(0,RAR.indexOf(d.rarity)),tags:d.tags||[],desc:tpl(d.text,d.values),v:d.values||{}},AUG_CODE[id]||{});if(SHOW_MULT[id])AUG[id].showMult=SHOW_MULT[id];if(SHOW_POW[id])AUG[id].showPow=SHOW_POW[id];if(SHOW_CRIT[id])AUG[id].showCrit=SHOW_CRIT[id]}

const TUNE={},TUNE_IDS=['hp','pow','spd','spin','reach','armor','crit','regen','knock','impact','mini'];
/* The eleven fixed ids, then any cap tune-ups (an entry with "cap": spd, spin, blades, volley or armor). */
for(const k of Object.keys(DATA.tuneUps))if(k[0]!=='_'&&!TUNE_IDS.includes(k)&&DATA.tuneUps[k]&&(CAP_KEYS.includes(DATA.tuneUps[k].cap)||k==='blade'||k==='size'))TUNE_IDS.push(k);   // 'blade': +1 weapon per purchase
for(const k of TUNE_IDS){const d=DATA.tuneUps[k];TUNE[k]={name:d.name,desc:tpl(d.text,{amount:d.amount}),amount:d.amount,weight:d.weight==null?1:d.weight,cap:d.cap||null,cost:d.cost,costStep:d.costStep}}   // weight: how often it shows up in the shop (1 = normal)
/* Trophy behaviour by id. Trophies are a source (section 4): they can use any hook an augment can, with the same signature, and run before
   every augment. stats(t,S,P,v) runs when the player's stats are worked out. Rule changes (weak, coupon...) are checked by id where they apply. */
const TROPHY_CODE={
 socket:{many:1},shelf:{},banker:{},coupon:{},weak:{},recycle:{},taste:{},
 engine:{stats(t,S,P,v){P.spd*=1+v.percent/100;P.spin*=1+v.percent/100}},
 hide:{stats(t,S,P,v){P.hp+=v.hp;P.armor+=v.armor}},
 edge:{stats(t,S,P,v){P.mult+=v.mult}},
 tonic:{stats(t,S,P,v){P.crit+=v.critPercent/100;P.regen+=v.regen}},
 pack:{onStart(t,S,x,v){for(let i=0;i<v.count;i++)spawnMini(S);return true}},
 /* Legendary trophies ("legendary": true in the data): offered only after a boss in endless mode. many: can be taken again. Gold, the ticket,
    the satchel and sockets act when picked (pickTrophy); the rest are big versions of the normal trophies, checked by id where those are. */
 arm:{many:1,stats(t,S,P,v){if(P.W.fist){for(const k in P.W.rampDef)if(k!=='maxSpeedBonusPercent'){P.rampAdd[k]=(P.rampAdd[k]||0)+v.fistRamp;break}}else P.blades+=v.blades}},
 chest:{many:1},ticket:{many:1},satchel:{many:1},socketL:{many:1},shelfL:{},bankerL:{},couponL:{},weakL:{},recycleL:{},tasteL:{},
 engineL:{stats(t,S,P,v){P.spd*=1+v.percent/100;P.spin*=1+v.percent/100}},
 hideL:{stats(t,S,P,v){P.hp+=v.hp;P.armor+=v.armor}},
 edgeL:{stats(t,S,P,v){P.mult+=v.mult}},
 tonicL:{stats(t,S,P,v){P.crit+=v.critPercent/100;P.regen+=v.regen}},
 packL:{onStart(t,S,x,v){for(let i=0;i<v.count;i++)spawnMini(S);return true}},
};
const TROPHY={};
for(const id of dkeys(DATA.trophies)){const d=DATA.trophies[id];
 if(!TROPHY_CODE[id])CORE_PROBLEMS.push('trophies.'+id+' is in game-data.json but has no code in core.js (TROPHY_CODE).');
 TROPHY[id]=Object.assign({id,name:d.name,desc:tpl(d.text,d.values),v:d.values||{},tags:d.tags||[],weight:d.weight==null?1:d.weight,legendary:!!d.legendary},TROPHY_CODE[id]||{})}
const has=(run,id)=>run.trophies.includes(id)&&!!TROPHY[id];
const nHas=(run,id)=>TROPHY[id]?run.trophies.filter(x=>x===id).length:0;   // how many times a trophy was taken (legendary ones can repeat)

/* ---------- 4. sources and hook dispatch ---------- */
/* A source is anything that changes the player's stats or reacts to fight events: augments, trophies, and later passives, relics, consumables...
   Every hook has one signature, hook(st, S, x, v): st is the entry's own state ({n, f}: n lasts the run, f is wiped every fight), S the fight,
   x the event payload, v the entry's "values". Return true when it did something (an augment's card flashes).
   Order on every hook: 'early' source kinds, then augments top to bottom (socket order is the core puzzle), then 'late' source kinds.
   'late' runs after every augment, the strongest position for a ×Mult, so keep it for rare effects.
   To add a system: addSourceKind({kind, stage:'early'|'late', list(run) -> [{def, st, v}]}) and give each entry hooks. Store run-long state with srcState(). */
const SOURCE_KINDS=[];
function addSourceKind(k){SOURCE_KINDS.push(k)}
/* Persistent state for one entry of a source (plain JSON on the run, so it survives snapshots). */
function srcState(run,key){const m=run.src||(run.src={});return m[key]||(m[key]={n:0,f:{}})}
/* Consumable items (DATA.consumables). Bought in the shop into the bag (run.bag, up to rules.consumables.bagSize), switched on for the next fight
   with "Use", and used up when that fight starts (run.active, cleared by advance()). Each item is a source, like trophies, so it can use any hook. */
const CONS=Object.assign({bagSize:3,shopItems:2},RULES.consumables||{});
const ITEM_CODE={
 padlock:{},   // checked by id where sockets are switched off or eaten (S.lock)
 talisman:{},   // checked by id in boss code (S.talisman): The Thief, The Samurai, The Glacier, The Storm's arrow
 tonic:{stats(t,S,P,v){inc(P,'pow',v.percent/100)}},
 draught:{stats(t,S,P,v){inc(P,'hp',v.percent/100)}},
 stoneskin:{stats(t,S,P,v){inc(P,'armor',v.percent/100)}},
 quickstep:{stats(t,S,P,v){inc(P,'spd',v.percent/100)}},
 aegis:{onTick(t,S,dt,v){const p=S.player;if(t.f.u||p.hp>p.maxhp*v.hpPercent/100)return;t.f.u=1;p.inv=Math.max(p.inv,v.seconds);fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+30,col:DATA.theme.page.gold});snd(S,'coin');return true}},
 smoke:{onStart(t,S,x,v){for(const e of enemies(S))freeze(S,e,v.seconds);return true}},
 crystal:{},   // used from the bag in the shop: opens the Night Market (openMarket)
 ticket:{},   // Free Shop Ticket (legendary trophy): used from the bag in the shop (useTicket)
 growth:{stats(t,S,P,v){inc(P,'size',v.percent/100)}},
 minibox:{onStart(t,S,x,v){for(let i=0;i<v.count;i++)spawnMini(S);return true}},
 twinkit:{stats(t,S,P,v){P.bladesPastCap=(P.bladesPastCap||1)*v.mult}},   // applied after the blade cap in calcPlayer
 /* Ramp Oil: adds a flat amount to each part of your weapon's ramp (only the parts it has). hitsPerArrow counts down (fewer hits per arrow). */
 rampoil:{stats(t,S,P,v){for(const k in P.W.rampDef)if(typeof v[k]==='number')P.rampAdd[k]=(P.rampAdd[k]||0)+v[k]}},
};
/* Your weapon's ramp with flat additions (Ramp Oil), for the hint in the shop: the weapon's ramp text filled with the new numbers. */
function rampWith(W,add){const r=Object.assign({},W.rampDef);for(const k in add)if(k in r)r[k]=k==='hitsPerArrow'?Math.max(1,r[k]-add[k]):+(r[k]+add[k]).toFixed(2);return tpl(DATA.weapons[W.id].rampText,r)}
const ITEM={};
for(const id of dkeys(DATA.consumables||{})){const d=DATA.consumables[id];if(!ITEM_CODE[id])CORE_PROBLEMS.push('consumables.'+id+' is in game-data.json but has no code in core.js (ITEM_CODE).');
 ITEM[id]=Object.assign({id,name:d.name,desc:tpl(d.text,d.values),cost:d.cost,v:d.values||{},tags:[],weight:d.weight==null?1:d.weight},ITEM_CODE[id]||{})}
addSourceKind({kind:'item',stage:'early',list:run=>(run.active||[]).filter(id=>ITEM[id]).map(id=>({def:ITEM[id],st:srcState(run,'item:'+id),v:ITEM[id].v}))});
function buyItem(run,i){const o=run.shop.items&&run.shop.items[i];if(!o||o.sold)return false;run.bag=run.bag||[];if(run.bag.length>=bagSize(run))return false;const c=itemCost(run,o.id);if(run.gold<c)return false;run.gold-=c;o.sold=true;run.bag.push({id:o.id,use:false});return true}
function toggleItem(run,i){const b=run.bag&&run.bag[i];if(!b||b.aug)return false;b.use=!b.use;return true}
function sellItem(run,i){const b=run.bag&&run.bag[i];if(!b)return false;run.gold+=b.aug?sellValue(run,b.aug):Math.floor(ITEM[b.id].cost/2);run.bag.splice(i,1);return true}
/* Bagging an augment: buy a shop augment into the item bag instead of a socket (one bagged augment at a time; it takes a bag slot and does nothing
   there). Socket it later from the bag when there is room (unbagAug). Bag entry: {aug: id}. */
function bagAug(run,i){const o=run.shop.offers[i];run.bag=run.bag||[];if(!o||o.sold||run.bag.length>=bagSize(run)||run.bag.some(x=>x.aug))return false;const c=augCost(run,o.id);if(run.gold<c)return false;
 run.gold-=c;o.sold=true;run.bag.push({aug:o.id});return true}
function unbagAug(run,i){const b=run.bag&&run.bag[i];if(!b||!b.aug||run.augs.length>=run.slots)return false;run.bag.splice(i,1);run.augs.push(b.keep||{id:b.aug,n:0,f:{}});return true}
function canBag(run){run.bag=run.bag||[];return run.bag.length<bagSize(run)&&!run.bag.some(x=>x.aug)}   // room in the bag, and no augment bagged yet
function bagOwned(run,i){const a=run.augs[i];if(!a||!canBag(run))return false;run.augs.splice(i,1);run.bag.push({aug:a.id,keep:a});return true}   // an owned augment into the bag (keeps its growth)
/* The Free Shop Ticket (legendary trophy, used from the bag in the shop): everything in the current shop costs $0 until it is rerolled or replaced. */
function useTicket(run,i){const b=run.bag&&run.bag[i];if(!b||b.id!=='ticket'||!run.shop||run.shop.free)return false;run.bag.splice(i,1);run.shop.free=true;return true}
/* Void augments (run.void, ids): no socket, can't be sold, run after every augment. The Night Market (Crystal Ball item) offers up to 4 of them. */
const VOID_RAR=DATA.rarities.findIndex(r=>r.void);
const isVoid=id=>!!AUG[id]&&AUG[id].rar===VOID_RAR;
const echoKeep=run=>run&&run.void&&run.void.includes('vecho')&&AUG.vecho?AUG.vecho.v.keep:0;
addSourceKind({kind:'void',stage:'late',list:run=>(run.void||[]).filter(id=>AUG[id]).map(id=>({def:AUG[id],st:srcState(run,'void:'+id),v:AUG[id].v}))});
function voidPool(run){return Object.keys(AUG).filter(k=>isVoid(k)&&!(run.void||[]).includes(k)&&fits(run,DATA.augments[k]))}
/* Using a Crystal Ball from the bag (index i): it is used up and the Night Market opens with up to 'offers' random Void augments (run.market). */
function openMarket(run,i){const b=run.bag&&run.bag[i];if(!b||b.id!=='crystal'||run.market)return false;const pool=voidPool(run);if(!pool.length)return false;
 run.bag.splice(i,1);const n=Math.min(pool.length,(ITEM.crystal&&ITEM.crystal.v.offers)||4),m=[];while(m.length<n){const k=pick(run,pool.filter(x=>!m.includes(x)));m.push(k)}run.market=m;return true}
function pickVoid(run,id){if(!run.market||!run.market.includes(id))return false;(run.void||(run.void=[])).push(id);run.market=null;return true}
/* Finished quests whose card you no longer own still give their reward (an owned card gives it itself). */
addSourceKind({kind:'quest',stage:'early',list:run=>Object.keys(run.questsDone||{}).filter(id=>AUG[id]&&AUG[id].reward&&!run.augs.some(a=>a.id===id)).map(id=>({def:{id,name:AUG[id].name,tags:[],stats:AUG[id].reward},st:srcState(run,'quest:'+id),v:AUG[id].v}))});
addSourceKind({kind:'trophy',stage:'early',list:run=>run.trophies.filter(id=>TROPHY[id]).map(id=>({def:TROPHY[id],st:srcState(run,'trophy:'+id),v:TROPHY[id].v}))});
/* The non-augment entries of a run, split by stage. Built once per fight and cached on S (trophies and the like do not change mid-fight). */
function sourceLists(run){const L={early:[],late:[]};for(const k of SOURCE_KINDS)for(const e of k.list(run))L[k.stage==='late'?'late':'early'].push(e);return L}
/* Calls one hook on every source in order. S.cur is the definition whose hook is running, so a hit it causes knows where it came from (tags, below).
   Mirror Ball borrows the hooks of the augment below it. */
function fire(S,hook,x){
 const L=S.src||(S.src=sourceLists(S.run)),prev=S.cur;
 const track=(hook==='stats'||hook==='preHit'||hook==='onHit')&&x&&x.inc,st_=hook==='stats';
 /* call: runs one hook, notes how much it raised the damage of this hit (or of every hit, for stats) in x.bst, and counts triggers (S.trig).
    These feed the damage breakdown after a fight. key is the id shown there: Mirror Ball and Resonator get the credit for what they copy or repeat. */
 const hitRec=(hook==='preHit'||hook==='onHit')&&x&&x.inc&&S.hitStat,dynRec=S.dynStat&&hook!=='stats'&&!/^show/.test(hook);
 if(hook==='onHit'&&S.hitStat)S.hookHits=(S.hookHits||0)+1;   // hits that ran On hit effects, for "on 23/60 hits"
 const call=(key,def,fn,st,v)=>{S.cur=def;if(x&&x.lines!==undefined){x._key=key;x._id=def.id}const e0=track?boostEff(x,st_):0,s0=st_&&x.log?statSnap(x):null;
  const p0=hitRec?layerVal(x,'power'):0,m0=hitRec?layerVal(x,'mult'):0,d0=dynRec?dynOpen(S):null,ok=fn(st,S,x,v);
  if(s0)statDiff(x,key,s0);
  if(hitRec){const dp=layerVal(x,'power')-p0,m1=layerVal(x,'mult'),dm=m1-m0;if(Math.abs(dp)>1e-9||Math.abs(dm)>1e-9){const r=S.hitStat[key]||(S.hitStat[key]={n:0,dp:0,dpMax:0,dm:0,dmMax:0,lr:0,rMax:1});
   r.n++;r.dp+=dp;r.dpMax=Math.max(r.dpMax,dp);r.dm+=dm;r.dmMax=Math.max(r.dmMax,dm);const q=m0>0&&m1>0?m1/m0:1;r.lr+=Math.log(q);r.rMax=Math.max(r.rMax,q)}}
  if(d0)dynClose(S,key,d0);
  if(track){const e1=boostEff(x,st_);if(e0>0&&e1>e0*1.0001)(x.bst||(x.bst=[])).push([key,e1/e0])}
  if(ok&&S.trig)S.trig[key]=(S.trig[key]||0)+1;return ok};
 const half=S.player&&S.player.st,tw=S.player&&S.player.twin;   // a Mitosis twin uses its own augment copies, and trophies and items are not doubled
 if(!tw)for(const e of L.early){const fn=e.def[hook];if(fn)call(e.def.id,e.def,fn,e.st,e.v)}
 const augs=S.run.augs,echo=echoKeep(S.run);
 for(let i=0;i<augs.length;i++){if(echo&&i>=echo)continue;   // Echoing Void
  if(isOff(S,augs[i]))continue;let a=half&&half[i]?half[i]:augs[i];
  let def=AUG[a.id];if(!def)continue;
  if(augs[i].id==='mirror'){const nb=augs[i+1];if(!nb||nb.id==='mirror'||isOff(S,nb)||!AUG[nb.id])continue;def=AUG[nb.id];if(!a.sh||a.sh.id!==nb.id)a.sh={id:nb.id,n:0,f:{}};a=a.sh}
  const fn=def[hook];if(!fn)continue;
  const rep_=(i>0&&augs[i-1].id==='resonator'&&!isOff(S,augs[i-1])?2:1)*(echo?(AUG.vecho.v.times||2):1);   // Resonator: the augment below it triggers twice; Echoing Void repeats the kept sockets
  const key=augs[i].id==='mirror'?'mirror':def.id;
  for(let r=0;r<rep_;r++){if(call(r?'resonator':key,def,fn,a,def.v)&&S.pulses){S.pulses[i]=S.t||0;if(r)S.pulses[i-1]=S.t||0}}
 }
 if(!tw)for(const e of L.late){const fn=e.def[hook];if(fn)call(e.def.id,e.def,fn,e.st,e.v)}
 S.cur=prev;
}
/* Per-hit and in-fight stats, for the damage breakdown. layerVal: a hit's Power or Mult with its pending layers. Every hook call outside 'stats' notes
   how it changed your live stats (DYN) and keeps only its own share: a hook that causes a hit, a kill or another hook passes the nested changes to
   the source that made them (dynOpen/dynClose keep a stack). S.dynStat[id][stat] = {tot, peak}: net change this fight and the highest it reached. */
const layerVal=(o,k)=>o[k]*(1+(o.inc[k]||0))*(o.more[k]==null?1:o.more[k]);
const DYN=[['pow',S=>S.P.pow+S.ramp.pow],['mult',S=>S.P.mult+S.ramp.mult],['crit',S=>S.P.crit+S.ramp.crit],['spd',S=>S.ramp.spd],['reach',S=>S.ramp.reach],['armor',S=>S.P.armor],['regen',S=>S.P.regen]];
function dynOpen(S){const f={v:DYN.map(d=>d[1](S)),inner:DYN.map(()=>0)};(S.dynStack||(S.dynStack=[])).push(f);return f}
function dynClose(S,key,f){S.dynStack.pop();const par=S.dynStack[S.dynStack.length-1];
 DYN.forEach((d,i)=>{const all=d[1](S)-f.v[i],own=all-f.inner[i];if(par)par.inner[i]+=all;if(Math.abs(own)<1e-9)return;
  const R=S.dynStat[key]||(S.dynStat[key]={}),q=R[d[0]]||(R[d[0]]={tot:0,peak:0});q.tot+=own;if(q.tot>q.peak)q.peak=q.tot})}
/* Stats added, for the damage breakdown: each stats hook's change to the player's stats, by source id (P.log). Plain changes are logged as amounts,
   inc() as +%, more() as ×. */
const LOG_KEYS=['hp','pow','mult','crit','critMult','spd','spin','reach','armor','regen','kb','impact','blades','size','projExtra','projBounce','bounceX','rampX','poisonX','burnX','frozenX'],LOG_RATIO=new Set(['rampX','poisonX','burnX','frozenX']);   // ratio keys are logged as ×
function statSnap(P){const o={};for(const k of LOG_KEYS)o[k]=P[k];o.inc=Object.assign({},P.inc);o.more=Object.assign({},P.more);return o}
function statDiff(P,key,s){const L=P.log[key]||(P.log[key]={});
 for(const k of LOG_KEYS){if(LOG_RATIO.has(k)){if(s[k]&&Math.abs(P[k]/s[k]-1)>1e-9)L['more.'+k]=(L['more.'+k]==null?1:L['more.'+k])*P[k]/s[k];continue}const d=P[k]-s[k];if(Math.abs(d)>1e-9)L[k]=(L[k]||0)+d}
 for(const k in P.inc){const d=P.inc[k]-(s.inc[k]||0);if(Math.abs(d)>1e-9)L['inc.'+k]=(L['inc.'+k]||0)+d}
 for(const k in P.more){const a=P.more[k],b=s.more[k]==null?1:s.more[k];if(Math.abs(a/b-1)>1e-9)L['more.'+k]=(L['more.'+k]==null?1:L['more.'+k])*a/b}}
/* Modifier layers. Inside a stats hook, a plain change (P.pow += 4, P.spin *= 1.3) applies at once, in hook order.
   inc(P,'pow',.2) adds +20% to that stat's increases; all increases on a stat are added together. more(P,'pow',1.5) multiplies; all are multiplied.
   After every stats hook: stat = (result of the plain changes) × (1 + sum of increases) × (product of multipliers). Admin overrides and caps come last.
   The same helpers work on a hit inside preHit/onHit, for 'power' and 'mult': c.power and c.mult are adjusted after every onHit hook, before the crit. */
/* Damage a hit (or the player's stats, st true) would deal from Power and Mult, counting the layers still waiting to apply. */
function boostEff(o,st){const a=st?'pow':'power',I=o.inc,M=o.more;return o[a]*o.mult*(1+(I[a]||0))*(M[a]==null?1:M[a])*(1+(I.mult||0))*(M.mult==null?1:M.mult)}
/* Sockets switched off this fight (The Null, The Reflection). S.off is a Set of owned augments; S.disabled is the first, for older code. */
function isOff(S,a){return!!(S.off&&S.off.has(a))}
/* Works the player's stats out again mid-fight (after a socket is switched off or back on). Keeps the HP share. */
function refreshStats(S){const pl=S.player,f=pl.maxhp>0?pl.hp/pl.maxhp:1,P=calcPlayer(S.run,S);P.bst=P.bst||null;S.P=P;pl.maxhp=P.hp;pl.hp=Math.max(1,Math.min(P.hp,P.hp*f));pl.armor=P.armor;
 if(!P.W.fist&&pl.ws.length!==P.blades){pl.ws=[];for(let i=0;i<P.blades;i++)pl.ws.push(mkW(P.W.type,0,P.reach,P.spin,Object.assign({every:P.W.fireEvery},wOpt(P.W,i,P.blades,.5))))}}
function setOff(S,list){if(S.lock)return;S.off=new Set(list.filter(Boolean));S.disabled=[...S.off][0]||null;refreshStats(S)}
function inc(o,k,x){o.inc[k]=(o.inc[k]||0)+x}
function more(o,k,x){o.more[k]=(o.more[k]==null?1:o.more[k])*x}
function applyLayers(o,map){for(const k in o.inc){const t=map?map[k]:k;if(typeof o[t]==='number')o[t]*=1+o.inc[k]}for(const k in o.more){const t=map?map[k]:k;if(typeof o[t]==='number')o[t]*=o.more[k]}}
/* Tags. Every hit carries tags: what made it (src) plus the tags of the source whose hook caused it, and c.from, that source's id.
   Future effects can then say "+20% damage on bounce hits" without knowing every augment: hasTag(c,'bounce'). */
const SRC_TAGS={weapon:['hit','weapon'],body:['hit','body','contact'],proj:['hit','projectile'],mini:['hit','mini','contact'],aoe:['hit','effect']};
const hasTag=(c,t)=>!!c.tags&&c.tags.includes(t);
/* Counters for this fight (S.count) and the whole run (run.count, added up at each payout). Effects that scale "per bounce", "per crit"...
   read these. Kept: hits, crits, kills, bounces, wallHits, collisions (your side vs an enemy), enemyCollisions, enemyWallHits, parries, hurt,
   poison and burn (stacks applied), shots, minis, and overflow counts (see OVERFLOW). */
function count(S,k,n){if(S.count)S.count[k]=(S.count[k]||0)+(n==null?1:n)}
/* Overflow: stats past their caps (Speed, Spin, blades, projectiles per volley, Minis alive) are not lost. P.over (fight start) and S.over (live,
   Speed and Spin) hold the amount above the cap; blocked projectiles and Minis are counted. rules.overflow can turn every 100% over a cap into +Mult
   on each hit. All rates are 0 in the shipped data, so nothing changes until an effect uses it. */
const OVF=(RULES.overflow&&typeof RULES.overflow==='object')?RULES.overflow:{};
const OVF_ON=['speed','spin','blades'].some(k=>+OVF[k+'ToMult']>0);
function overflowMult(S){const P=S.P,cb=RULES.combat,o=S.over;let m=0;
 if(+OVF.speedToMult>0)m+=o.spd/cb.maxPlayerSpeed*OVF.speedToMult;
 if(+OVF.spinToMult>0)m+=o.spin/cb.maxSpin*OVF.spinToMult;
 if(+OVF.bladesToMult>0)m+=P.over.blades/4*OVF.bladesToMult;
 return m}
/* Works out the player's stats for a fight: weapon + tune-ups, then every source's stats hook (trophies, augments top to bottom, late sources), then the layers. */
function calcPlayer(run,S){
 const W=WEAPONS[run.weapon],t=run.tune,pr=RULES.player;
 const P={W,hp:pr.baseHp+TUNE.hp.amount*t.hp+pr.hpPerBossBeaten*(run.grown||0),pow:W.pow+TUNE.pow.amount*t.pow,mult:1,spd:W.spd*(1+TUNE.spd.amount/100*t.spd),spin:W.spin*(1+TUNE.spin.amount/100*t.spin),reach:W.reach*(1+TUNE.reach.amount/100*t.reach),size:pr.radius*(1+(TUNE.size?TUNE.size.amount/100*(t.size||0):0)),armor:TUNE.armor.amount*t.armor,
  crit:pr.critChancePercent/100+TUNE.crit.amount/100*t.crit,critMult:pr.critMult,regen:TUNE.regen.amount*t.regen,blades:W.blades+(TUNE.blade&&!W.fist?TUNE.blade.amount*(t.blade||0):0),bounceX:1,rampX:1,projBounce:0,projExtra:0,poisonX:1,burnX:1,burnDecay:1,cat:null,kb:W.kb*(1+TUNE.knock.amount/100*(t.knock||0)),impact:(RULES.player.impact||0)+W.impact+TUNE.impact.amount*(t.impact||0),frozenX:1,rampAdd:{},burnGrow:0,domino:null,sweep:0,miniHpX:1,miniDmgX:1,miniArmor:0,miniRegen:0,hurtInv:0,miniSpd:0,miniKb:0,miniProc:0};
 P.inc={};P.more={};P.log={};
 fire(S||{run,disabled:null},'stats',P);   // trophies and other early sources first, then augments top to bottom
 applyLayers(P);
 // admin overrides (Admin panel in ui.js): absolute values that replace the computed stat
 if(run.override)for(const k of Object.keys(run.override)){const v=run.override[k];if(typeof v==='number'&&isFinite(v)&&typeof P[k]==='number')P[k]=v}
 P.raw={spd:P.spd,spin:P.spin,blades:P.blades};   // before the caps, for overflow
 const cS=capOf(run,'spd'),cR=capOf(run,'spin'),cB=capOf(run,'blades');   // one Speed cap now (was 560 here and 760 in the fight)
 P.over={spd:Math.max(0,P.spd-cS),spin:Math.max(0,P.spin-cR),blades:Math.max(0,P.blades-cB)};
 P.hp=Math.max(1,Math.round(P.hp));P.spin=Math.min(P.spin,cR);P.spd=Math.min(P.spd,cS);P.blades=Math.min(P.blades,cB);if(P.bladesPastCap)P.blades=Math.min((RULES.uncapped||{}).blades||16,Math.round(P.blades*P.bladesPastCap));   // Twin Kit: past the cap
 P.bounceX=Math.max(1,Math.round(P.bounceX));
 return P;
}

/* ---------- 5. fight simulation ---------- */
/* Visual and sound events are queued on S and drawn by ui.js. They are skipped in headless runs (S.vis false). */
function fx(S,e){if(S.vis)S.fx.push(e)}
function snd(S,k){if(S.vis)S.snd.push(k)}
function text(S,x,y,v,kind){if(S.vis&&S.texts.length<90)S.texts.push({x,y,v,kind})}

function newFight(run,o){
 o=o||{};
 const S={run,rsrc:o.rsrc||run,t:0,balls:[],projs:[],fx:[],texts:[],snd:[],marks:[],hitCount:0,overtime:1,done:null,freeze:0,statusAcc:0,
  vis:!!(o.juice||o.preview),juice:!!o.juice,preview:!!o.preview,kills:0,dmg:0,bestHit:0,pulses:[],last:null,bounces:0,lastBounce:-9,gold:0,chill:1,disabled:null,boss:null,bossDef:null,
  ramp:{pow:0,mult:0,spin:1,reach:0,arrows:0,hits:0,spd:0,crit:0,critOver:2},count:{},over:{spd:0,spin:0},src:null,cur:null,dmgBy:{},trig:{},hitStat:{},dynStat:{},hookHits:0,hitKey:null,hitOwner:null,miniBounce:0,miniTouch:0,miniHunt:0,miniHuntShare:0,ice:[],pockets:null,bossNote:'',hotWalls:null,off:null};
 const T=run.tier,enc=run.enc;
 {const wk=(has(run,'weak')?1-TROPHY.weak.v.percent/100:1)*(has(run,'weakL')?1-TROPHY.weakL.v.percent/100:1),Z=tierScale(T);S.hs=Z.hs*wk;S.bhs=Z.bhs*wk*(T===1?(RULES.scaling.firstBossHpPercent||100)/100:1);S.ds=Z.ds}
 S.refHp=IMP?(IMP.minReferenceHp||0)*S.hs:0;S.hold=false;S.endlessFight=T>RULES.run.tiersToWin;
 if(!S.preview&&!o.keepItems){run.active=(run.bag||[]).filter(x=>x.use&&ITEM[x.id]&&x.id!=='crystal').map(x=>x.id);run.bag=(run.bag||[]).filter(x=>!x.use||x.id==='crystal')}   // bagged augments (x.aug) are never "used"   // items switched on are used up now
 S.lock=!S.preview&&(run.active||[]).includes('padlock');S.talisman=!S.preview&&(run.active||[]).includes('talisman');
 S.off=new Set();{const bc=enc.boss&&BOSS[enc.boss]&&BOSS[enc.boss].code;if(bc&&bc.offAtStart&&!S.preview&&!S.lock)for(const a of bc.offAtStart(run,BOSS[enc.boss].v))if(a)S.off.add(a)}S.disabled=[...S.off][0]||null;   // The Null and The Reflection switch sockets off
 for(const a of run.augs){a.f={};if(a.sh)a.sh.f={}}
 if(run.src)for(const k in run.src)run.src[k].f={};   // per-fight state of trophies and other sources
 S.ate=[];if(!S.preview)for(let i=0;i<run.augs.length;i++){const a=run.augs[i],d=AUG[a.id];if(d&&d.beforeFight)d.beforeFight(a,S,i,d.v)}   // Maw: may remove the augment below it
 S.src=sourceLists(run);
 const P=S.P=calcPlayer(run,S),W=P.W;
 const pl=S.player=mkBall({team:0,player:true,kind:'player',x:AW*.2,y:AH/2,r:P.size,hp:P.hp,spd:P.spd,armor:P.armor,col:DATA.theme.balls.player});
 for(let i=0;i<P.blades;i++)pl.ws.push(mkW(W.type,0,P.reach,P.spin,Object.assign({every:W.fireEvery},wOpt(W,i,P.blades,.5))));
 pl.ramp=S.ramp;pl.lb=-9;pl.hc=0;launch(S,pl);S.balls.push(pl);
 const spots=[];
 const place=r=>{for(let k=0;k<40;k++){const x=AW*.45+r+rnd(S.rsrc)*(AW*.55-2*r-6),y=r+6+rnd(S.rsrc)*(AH-2*r-12);if(spots.every(s=>Math.hypot(s[0]-x,s[1]-y)>s[2]+r+4)||k===39){spots.push([x,y,r]);return[x,y]}}};
 if(enc.boss&&BOSS[enc.boss]){const r=BOSS[enc.boss].r;spots.push([AW*.75,AH/2,r]);spawnEnemy(S,enc.boss,AW*.75,AH/2)}
 enc.list.forEach((id,i)=>{if(!ENEMY[id])return;const p=place(ENEMY[id].r),b=spawnEnemy(S,id,p[0],p[1]);if(enc.elite&&enc.elite.i===i)makeElite(S,b,enc.elite.mod)});
 if(!S.preview){for(let i=0;i<(run.tune.mini||0)*TUNE.mini.amount;i++)spawnMini(S);fire(S,'onStart',null)}   // Hatchling tune-ups: Minis at fight start
 return S;
}
/* Mini-You (Mini Me): a Mini with your weapon, blades and Speed. Its blade hits go through playerHit as 'weapon' hits for share% damage, so your
   augments apply to them; it never feeds the weapon ramp. It counts as a Mini (Hive Mind, Underdog) but ignores the Mini cap. */
function spawnMiniYou(S,v,x,y){
 const p=S.player,P=S.P,W=P.W,share=v.damagePercent/100;
 const b=mkBall({team:0,mini:true,miniYou:true,kind:'miniyou',x:clamp(x==null?p.x+(rnd(S.rsrc)-.5)*70:x,v.radius,AW-v.radius),y:clamp(y==null?p.y+(rnd(S.rsrc)-.5)*70:y,v.radius,AH-v.radius),r:v.radius,hp:P.hp*v.hpPercent/100,spd:P.spd,armor:P.armor*Math.max(RULES.minis.armorPercent/100,P.miniArmor),col:DATA.theme.balls.player});
 if(!W.fist)for(let i=0;i<P.blades;i++)b.ws.push(mkW(W.type,0,P.reach*v.reachPercent/100,P.spin,{ang:i*TAU/P.blades+rnd(S.rsrc)*TAU,every:W.fireEvery,ft:.6+i*.35,share,kb:P.kb*share}));
 b.share=share;b.owner=S.player;launch(S,b);S.balls.push(b);return b;
}
function spawnMini(S,x,y){
 const M=RULES.minis;let alive=0;for(const o of S.balls)if(o.alive&&o.mini)alive++;if(alive>=(M.safetyLimit||60)){count(S,'overflowMinis');return}const p=S.player;count(S,'minis');   // no game cap on Minis; safetyLimit only keeps the frame rate up
 const b=mkBall({team:0,mini:true,kind:'mini',x:x==null?p.x+(rnd(S.rsrc)-.5)*50:x,y:y==null?p.y+(rnd(S.rsrc)-.5)*50:y,r:M.radius,hp:S.P.hp*M.hpPercent/100*S.P.miniHpX,spd:S.P.miniSpd?Math.max(M.speed,S.P.spd):M.speed,armor:S.P.armor*Math.max(M.armorPercent/100,S.P.miniArmor),col:DATA.theme.balls.mini});
 b.owner=S.player;b.born=S.t;b.x=clamp(b.x,12,AW-12);b.y=clamp(b.y,12,AH-12);launch(S,b);S.balls.push(b);return b;
}
function shoot(S,from,ang,f,main,vol,o){   // o (Bow arrows): {spdX: speed multiplier from Reach, kb: Knockback each arrow pushes with}
 o=o||{};
 const P=S.P,PR=RULES.projectiles,want=(vol||1)+P.projExtra,n=Math.min(capOf(S.run,'volley'),want);
 if(want>n)count(S,'overflowShots',want-n);count(S,'shots',n);
 for(let i=0;i<n;i++){const a=ang+(i-(n-1)/2)*PR.spread,c=Math.cos(a),s=Math.sin(a);
  const sx=-Math.sin(ang)*(o.side||0),sy=Math.cos(ang)*(o.side||0);   // a side-by-side bow's arrows start from its side
  S.projs.push({bow:o.bow||null,half:halfOf(from),x:from.x+c*(from.r+6)+sx,y:from.y+s*(from.r+6)+sy,vx:c*PR.playerSpeed*(o.spdX||1),vy:s*PR.playerSpeed*(o.spdX||1),r:4,team:0,f,main,bn:P.projBounce,life:PR.lifetime,ang:a,arrow:!!o.arrow,kb:o.kb||0,d:0})}
 snd(S,'shot');
}
/* Domino Effect: a projectile that kills flies on to the nearest enemy with more damage (p.f grows), as many times as it keeps killing.
   Each link shows "Chain xn"; long chains play impact frames; the run's longest chain is kept on the card. */
function dominoArrow(S,p,dead,dealt){
 const D=S.P.domino,v=D.v,n=(p.chain||0)+1;if(n>v.max)return;let best=null,bd=1e9;
 for(const e of S.balls)if(e.alive&&e.team===1&&e!==dead){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<bd){bd=d;best=e}}
 if(!best)return;
 const sp=Math.hypot(p.vx,p.vy)||RULES.projectiles.playerSpeed,dx=best.x-p.x,dy=best.y-p.y,d=Math.hypot(dx,dy)||1;
 p.dead=false;p.chain=n;p.f*=1+v.percent/100;p.vx=dx/d*sp;p.vy=dy/d*sp;p.ang=Math.atan2(dy,dx);p.life=Math.max(p.life,1.5);
 if(dealt>0&&S.dmgBy)S.dmgBy['boost:domino']=(S.dmgBy['boost:domino']||0)+dealt*(1-Math.pow(1+v.percent/100,-(n-1)));   // breakdown: the extra damage this chain added
 count(S,'dominoChain');const a=D.a;if(n>(a.f.best||0))a.f.best=n;if(n>(a.n||0))a.n=n;if(S.trig)S.trig.domino=(S.trig.domino||0)+1;if(S.pulses){const i=S.run.augs.indexOf(a);if(i>=0)S.pulses[i]=S.t}
 fx(S,{k:'zap',x1:dead.x,y1:dead.y,x2:best.x,y2:best.y});if(n>=v.showAt)fx(S,{k:'streak',x:dead.x,y:dead.y,n});
 if(IMP&&S.juice&&(n===v.heavyAt||n===v.massiveAt)){const L=IMP.levels.map(l=>l.minPercentOfMaxHp).sort((m,k)=>m-k);S.fx.push({k:'impact',pct:n===v.massiveAt?L[L.length-1]:L[0],x:dead.x,y:dead.y,dmg:dealt});S.hold=true}
}
function voidSlam(S,b,v){if(!b.alive)return;fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+16,col:DATA.theme.effects.void||'#b06cff'});snd(S,'impact');const k=S.slam;S.slam=1;playerHit(S,b,'aoe',v.percent/100);S.slam=k}
function addPoison(S,t,n){if(t.alive&&!(t.ward>S.t)){t.poison+=n;count(S,'poison',n)}}
/* Chill stacks on an enemy. At ST.chillMax it is Frozen. Frozen enemies take no more Chill until they thaw. */
function addChill(S,t,n){if(!t.alive||t.team!==1||t.frozen>0||n<=0||t.ward>S.t||(t.boss&&S.bossDef&&S.bossDef.code.noChill))return;t.chill=(t.chill||0)+n;count(S,'chill',n);if(t.chill>=ST.chillMax){t.chill=0;freeze(S,t,ST.freezeSeconds)}}
function freeze(S,t,secs){if(!t.alive||t.team!==1||t.ward>S.t||(t.boss&&S.bossDef&&S.bossDef.code.noChill))return;const d=secs*(t.boss?ST.bossFreezePercent/100:1);if(d<=(t.frozen||0))return;
 t.frozen=d;count(S,'freezes');fx(S,{k:'ring',x:t.x,y:t.y,r:t.r+14,col:DATA.theme.effects.freeze||'#d9f4ff'});fire(S,'onFreeze',t)}
/* Your side knocks an enemy: Knockback stat applies, and the enemy is marked so a wall it hits soon after counts as a slam. */
function knockBy(S,t,fx_,fy_,kb){knock(S,t,fx_,fy_,kb);t.knockT=S.t;if(t.alive&&t.team===1)fire(S,'onKnock',t)}
/* Shock: each stack cuts the damage that enemy deals by shockPercent, up to shockMax stacks. Fades by shockFadePerSecond. */
function addShock(S,t,n){if(!t.alive||t.team!==1||t.ward>S.t||n<=0)return;t.shock=Math.min(ST.shockMax,(t.shock||0)+n);count(S,'shock',n)}
/* A Lightning kill: the bolt jumps to the nearest living enemy in range for more damage. Chains through damage() (kind 'shock'); S.lnk is the link. */
function lightningKill(S,dead,dealt){
 const n=(S.lnk||0)+1;if(n>LTN.max||!(dealt>0)||S.done)return;let best=null,bd=LTN.range;
 for(const e of S.balls)if(e.alive&&e.team===1&&e!==dead){const d=Math.hypot(e.x-dead.x,e.y-dead.y);if(d<bd){bd=d;best=e}}
 if(!best)return;
 fx(S,{k:'zap',x1:dead.x,y1:dead.y,x2:best.x,y2:best.y});snd(S,'zap');count(S,'lightningChain');if(n>(S.lbest||0))S.lbest=n;
 if(n>=LTN.showAt)fx(S,{k:'streak',x:dead.x,y:dead.y,n});
 const amt=dealt*(1+LTN.percent/100);
 if(IMP&&S.juice&&(n===LTN.heavyAt||n===LTN.massiveAt)){const L=IMP.levels.map(l=>l.minPercentOfMaxHp).sort((m,k)=>m-k);S.fx.push({k:'impact',pct:n===LTN.massiveAt?L[L.length-1]:L[0],x:best.x,y:best.y,dmg:amt});S.hold=true}
 const pl=S.lnk,hk=S.hitKey;S.lnk=n;S.hitKey='src:lightning';damage(S,best,amt,'shock');S.hitKey=hk;S.lnk=pl;
}
function addBurn(S,t,n){if(t.alive&&!(t.ward>S.t)){t.burn+=n;count(S,'burn',n);fire(S,'onBurn',t)}}
function heal(S,b,amt,quiet){if(!b.alive||amt<=0)return;const h=Math.min(amt,b.maxhp-b.hp);if(h<=0)return;b.hp+=h;if(!quiet&&h>=1)text(S,b.x,b.y-b.r,h,'heal')}
function wave(S,x,y,r,f,col){fx(S,{k:'ring',x,y,r,col});snd(S,'boom');for(const e of enemies(S))if(Math.hypot(e.x-x,e.y-y)<r+e.r)playerHit(S,e,'aoe',f)}
/* Pushes ball t away from a point. Size (mass) and Max HP both resist. Enemy HP is compared with its tier's scaling, so a Brute resists more than a
   Grunt at every tier instead of everything becoming immune late; the player's side uses plain Max HP. rules.knockback holds the numbers. */
const KB=Object.assign({resistHp:150,enemyReferenceHp:40,playerReferenceHp:100},RULES.knockback||{});
function knockResist(S,t){const enemy=t.team===1,hp=enemy?t.maxhp/((t.boss?BH0*S.bhs:S.hs)||1):t.maxhp,ref=enemy?KB.enemyReferenceHp:KB.playerReferenceHp;return(1+ref/KB.resistHp)/(1+hp/KB.resistHp)}
function knock(S,t,fx_,fy_,kb){if(!(kb>0))return;const dx=t.x-fx_,dy=t.y-fy_,d=Math.hypot(dx,dy)||1,k=kb/Math.max(.6,t.m)*knockResist(S,t);t.vx+=dx/d*k;t.vy+=dy/d*k}

/* The kind of damage for boss rules: 'poison', 'burn', 'hit' (your weapon, body, projectiles, Minis) or 'effect' (augment effects, shocks). */
function dmgType(S,kind){if(kind==='poison'||kind==='burn'||kind==='siphon')return kind;const k=S.hitKey||'';return/^src:(weapon|body|proj|mini|miniyou|twin)$/.test(k)?'hit':'effect'}
/* Deals damage to an enemy. kind decides the colour of the number; poison and burn ignore armor. */
function damage(S,t,amt,kind){
 if(!t.alive||t.inv>0||S.done)return 0;
 if(amt!==amt)return 0;   // never let a broken number (NaN) into HP; Infinity is fine and simply kills
 if(t.frozen>0&&S.P&&S.P.frozenX!==1)amt*=S.P.frozenX;   // Glacial Core
 const status=kind==='poison'||kind==='burn'||kind==='siphon';
 if(t.boss&&S.bossDef&&S.bossDef.code.taken){amt=S.bossDef.code.taken(S,t,amt,kind,dmgType(S,kind),S.bossDef.v);if(!(amt>0))return 0}   // boss rules: immunities, weaknesses, adapting
 if(!S.hitKey&&t.team===1&&splitOn(S))amt*=S.splitCut;   // Mitosis cut on damage dealt outside a hit (Poison, Burn, shocks, blasts)
 if(!status)amt=Math.max(1,amt-t.armor);
 // a hit worth a big share of the strongest enemy's Max HP asks the interface for an impact frame
 if(IMP&&S.juice&&!status&&t.team===1&&S.refHp>0){const pct=amt/S.refHp*100;if(pct>=IMP_MIN){S.fx.push({k:'impact',pct,x:t.x,y:t.y,dmg:amt,crit:kind==='crit'});S.hold=true}}
 t.hp-=amt;t.flash=.12;S.dmg+=amt;
 if(S.dmgBy&&t.team===1){const k=S.hitKey||(status?'src:'+kind:S.cur&&S.cur.id?'aug:'+S.cur.id:'src:other');S.dmgBy[k]=(S.dmgBy[k]||0)+amt}   // who dealt it, for the breakdown
 text(S,t.x,t.y-t.r,amt,kind);
 if(t.hp<=0)kill(S,t);
 if(kind==='shock'&&t.team===1){if(t.alive)addShock(S,t,1);else lightningKill(S,t,amt)}   // Lightning
 return amt;
}
function kill(S,t){
 if(!t.alive)return;t.alive=false;t.hp=0;
 fx(S,{k:'burst',x:t.x,y:t.y,col:t.col,n:t.boss?30:12});snd(S,t.boss?'bossdie':'pop');
 if(t.team!==1)return;
 S.kills++;count(S,'kills');const d=t.def;
 if(d.split&&ENEMY[d.split])for(let i=0;i<d.splitN;i++)spawnEnemy(S,d.split,t.x+(i%2?10:-10),t.y+(i>1?10:0));
 const bomb=d.bomb||(t.volatile?ELITE.volatileDamage:0),bR=d.bomb?d.bombR:ELITE.volatileRadius;
 if(bomb){fx(S,{k:'ring',x:t.x,y:t.y,r:bR,col:t.col});snd(S,'boom');for(const b of S.balls)if(b.alive&&b.team===0&&Math.hypot(b.x-t.x,b.y-t.y)<bR+b.r)enemyHit(S,null,b,bomb*S.ds);
  const ff=(d.v.allyPercent||0)/100;if(ff>0){S.hitKey='src:bomb';for(const e of S.balls)if(e.alive&&e.team===1&&e!==t&&Math.hypot(e.x-t.x,e.y-t.y)<bR+e.r)damage(S,e,bomb*S.hs*ff,'aoe');S.hitKey=null}}   // a Bomber's blast hurts enemies too
 if(d.code&&d.code.onDeath)d.code.onDeath(S,t,d.v);
 fire(S,'onKill',t);
}
function playerDown(S){
 const p=S.player;if(!p.alive)return;
 const x={saved:false};fire(S,'onLethal',x);
 if(!x.saved){const tw=S.balls.find(b=>b.twin&&b.alive);   // Fission: while your twin lives, you carry on in it
  if(tw){dropHalf(S,p);for(const b of S.balls)if(b.owner===tw)b.owner=p;tw.alive=false;p.x=tw.x;p.y=tw.y;p.vx=tw.vx;p.vy=tw.vy;p.hp=Math.max(1,tw.hp);p.inv=Math.max(p.inv,.5);
   p.st=tw.st;p.ramp=tw.ramp;if(S.player===p)S.ramp=tw.ramp;p.ws=tw.ws;fx(S,{k:'burst',x:p.x,y:p.y,col:p.col,n:14});fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+18,col:DATA.theme.page.gold});snd(S,'pop');return}}
 if(!x.saved){p.alive=false;p.hp=0;S.done='lose';fx(S,{k:'burst',x:p.x,y:p.y,col:p.col,n:30});snd(S,'lose')}
}
/* An enemy source hits a ball on the player's side. */
function enemyHit(S,att,t,pow,pierce){   // pierce: ignores Armor (The Samurai's slashes)
 if(!t.alive||t.inv>0||S.preview||S.done)return;
 if(att&&att.shock>0)pow*=1-Math.min(ST.shockMax,att.shock)*ST.shockPercent/100;   // Shock
 const raw=pow*S.overtime,capd=raw*(1-capOf(S.run,'armor')/100),d=pierce?Math.max(1,raw):Math.max(1,capd,raw-t.armor);
 const atCap=!pierce&&raw>0&&raw-t.armor<=capd;if(t.player&&raw>0){count(S,'hitsTaken');if(atCap)count(S,'hitsCapped')}   // how often your Armor reaches its cap (tests, breakdown)
 let held=0;if(t.player||t.twin){const x={att,raw,d,capped:atCap,held:0,t};if(t.twin)asHalf(S,t,()=>fire(S,'onHurt',x));else fire(S,'onHurt',x);held=Math.min(d,x.held||0)}   // x.held: damage an augment takes off now (Cushion deals it later)if(t.player)count(S,'taken:'+(att?(att.ram?'ram':att.kind):'other'),d);   // damage taken by source (tests)
 count(S,'hurt');if(att&&att.vamp&&att.alive)heal(S,att,d*att.vamp,true);   // Vampiric elite
 t.hp-=d-held;t.flash=.12;text(S,t.x,t.y-t.r,d-held,'hurt');snd(S,'hurt');
 if(S.P.hurtInv>0&&(t.player||t.mini||t.twin))t.inv=Math.max(t.inv,S.P.hurtInv);   // Second Skin: a moment of immunity after a hit
 if(t.hp<=0){if(t.player)playerDown(S);else{t.alive=false;fx(S,{k:'burst',x:t.x,y:t.y,col:t.col,n:8});if(t.twin)dropHalf(S,t)}}
}
/* THE HIT PIPELINE. Every hit from the player's side goes through here.
   src: 'weapon' | 'body' | 'proj' | 'mini' | 'aoe'.  f: fraction of Power.  base: use this instead of Power.  main: true when it is the weapon's own hit (drives the ramp).
   Order: preHit hooks -> crit roll -> onHit hooks (top to bottom) -> crit multiplier -> damage -> weapon ramp -> afterHit hooks.
   'aoe' hits still run onHit, but augments that create more hits must ignore src 'aoe' or they loop forever. */
function playerHit(S,t,src,f,base,main){
 if(!t.alive||S.done||S.preview)return 0;
 const P=S.P,R=S.ramp,pl=S.player;
 const from=S.cur,tags=(SRC_TAGS[src]||['hit']).concat(from&&from.tags?from.tags:[]);
 const c={target:t,src,power:(base!=null?base:P.pow+R.pow)*f,mult:P.mult+R.mult,crit:false,status:1,n:++S.hitCount,kill:false,dealt:0,tags,from:from?from.id:null,inc:{},more:{}};
 count(S,'hits');
 if(OVF_ON)c.mult+=overflowMult(S);
 if(src==='body'&&main)c.mult*=Math.max(1,pl.spd/P.spd);
 const hooks=!(src==='mini'&&S.hitOwner!=='miniyou'&&!P.miniProc)&&!(P.noOnHit&&!S.slam);   // Empty Hands: only its slams trigger On hit effects   // Minis' rams skip your On hit effects unless you own Pack Tactics (Mini-Yous always trigger them)
 if(hooks)fire(S,'preHit',c);
 const cc=P.crit+R.crit;
 if(!c.crit)c.crit=rnd(S.rsrc)<cc;
 if(hooks)fire(S,'onHit',c);
 applyLayers(c);   // % increases and multipliers that hooks added with inc() and more()
 let critF=1;if(c.crit){critF=P.critMult+Math.max(0,cc-1)*R.critOver;c.mult*=critF;count(S,'crits')}
 let dmg=c.power*c.mult*S.overtime*(splitOn(S)&&src!=='mini'&&S.hitOwner!=='miniyou'?S.splitCut:1);   // Mitosis: each half deals damagePercent
 if(pl.shock>0)dmg*=1-Math.min(ST.shockMax,pl.shock)*ST.shockPercent/100;   // Shock on your ball (The Storm's lightning arrow)
 if(c.kill)dmg=Math.max(dmg,t.hp+t.armor+1);
 S.hitKey=c.from?'aug:'+c.from:'src:'+(S.hitOwner||src);c.dealt=damage(S,t,dmg,c.crit?'crit':src);S.hitKey=null;
 if(t.boss&&S.bossDef&&S.bossDef.code.hitTaken)S.bossDef.code.hitTaken(S,t,c,S.bossDef.v);
 if(t.team===1&&hasTag(c,'shock')){if(t.alive)addShock(S,t,1);else if(c.dealt>0)lightningKill(S,t,c.dealt)}   // a hit from a shock augment is Lightning
 if(S.dmgBy&&c.dealt>0){const D=c.dealt,B=S.dmgBy,add=b=>{if(b[1]>1)B['boost:'+b[0]]=(B['boost:'+b[0]]||0)+D*(1-1/b[1])};   // what each boost added to this hit
  if(P.bst)P.bst.forEach(add);if(c.bst)c.bst.forEach(add);add(['crit',critF]);
  if(base==null)add(['ramp',(P.pow+R.pow)/Math.max(1e-9,P.pow)*(P.mult+R.mult)/Math.max(1e-9,P.mult)])}
 S.last={p:c.power,m:c.mult,d:c.dealt,c:c.crit,n:S.hitCount,t};   // t: the ball hit (tests)
 if(c.dealt>S.bestHit)S.bestHit=c.dealt;
 if(S.juice&&src!=='aoe')S.freeze=c.crit?RULES.feel.critHitStop:RULES.feel.hitStop;
 snd(S,c.crit?'crit':'hit');
 if(main){const x=P.rampX,D=P.W.rampDef,A=P.rampAdd||{};R.hits++;   // A: flat additions (Ramp Oil)
  if(D.power)R.pow+=(D.power+(A.power||0))*x;
  if(D.mult)R.mult+=(D.mult+(A.mult||0))*x;
  if(D.spinPercent)R.spin=Math.min(D.maxSpinMultiplier||4,R.spin+(D.spinPercent+(A.spinPercent||0))/100*x);
  if(D.reach)R.reach=Math.min(D.maxReach||220,R.reach+(D.reach+(A.reach||0))*x);
  if(D.hitsPerArrow){const g=x/Math.max(1,D.hitsPerArrow-(A.hitsPerArrow||0)),bw=S.rampBow;if(bw){bw.arr=(bw.arr||0)+g;R.arrows=Math.max(R.arrows,bw.arr)}else R.arrows+=g}}   // a bow's arrows feed that bow's own ramp; R.arrows shows the highest
 if(hooks){fire(S,'afterHit',c);if(c.crit)fire(S,'onCrit',c)}
 return c.dealt;
}
function bounceEvent(S,b){
 S.lastBounce=S.t;const D=S.P.W.rampDef;
 for(let k=0;k<S.P.bounceX;k++){S.bounces++;count(S,'bounces');fire(S,'onBounce',b);if(D.speedPercentPerBounce&&(b.player||b.twin))S.ramp.spd=Math.min((D.maxSpeedBonusPercent||180)/100,S.ramp.spd+(D.speedPercentPerBounce+((S.P.rampAdd||{}).speedPercentPerBounce||0))/100*S.P.rampX)}
 if(b.player&&S.boss&&S.boss.alive&&S.bossDef.code.onPlayerBounce)S.bossDef.code.onPlayerBounce(S,b,S.bossDef.v);
}
/* Geometry helpers. seg() gives a weapon's blade as a line [x1,y1,x2,y2]. */
function seg(b,w){const c=Math.cos(w.ang),s=Math.sin(w.ang);
 if(w.type==='shield'){const d=b.r+7,cx=b.x+c*d,cy=b.y+s*d,h=w.len/2;return[cx-s*h,cy+c*h,cx+s*h,cy-c*h]}
 const a=b.r*.8,e=b.r+w.len;return[b.x+c*a,b.y+s*a,b.x+c*e,b.y+s*e]}
function dSegPt(q,px,py){const dx=q[2]-q[0],dy=q[3]-q[1];let t=((px-q[0])*dx+(py-q[1])*dy)/(dx*dx+dy*dy||1);t=clamp(t,0,1);return Math.hypot(px-q[0]-dx*t,py-q[1]-dy*t)}
function segX(a,b){const d=(x1,y1,x2,y2,x3,y3)=>(x2-x1)*(y3-y1)-(y2-y1)*(x3-x1);
 const d1=d(a[0],a[1],a[2],a[3],b[0],b[1]),d2=d(a[0],a[1],a[2],a[3],b[2],b[3]),d3=d(b[0],b[1],b[2],b[3],a[0],a[1]),d4=d(b[0],b[1],b[2],b[3],a[2],a[3]);return d1*d2<0&&d3*d4<0}
function nearestFoe(S,b){let best=null,bd=1e9;for(const o of S.balls)if(o.alive&&o.team!==b.team){const d=Math.hypot(o.x-b.x,o.y-b.y);if(d<bd){bd=d;best=o}}return best}

/* Advances the fight by dt seconds (always 1/120). Order matters:
   timers and status ticks -> move balls and bounce off walls -> ball/ball collisions -> blades vs balls -> blade parries -> projectiles -> clean up -> win check. */
function step(S,dt){
 if(S.done)return;
 S.t+=dt;
 const pl=S.player,P=S.P,live=!S.preview,CB=RULES.combat;
 if(live){
  if(S.t>CB.overtimeStartsAt)S.overtime=1+(S.t-CB.overtimeStartsAt)*CB.overtimePercentPerSecond/100;
  if(S.t>CB.timeLimit){S.done='lose';return}
  fire(S,'onTick',dt);if(S.twins)for(const t of S.twins)if(t.alive)asHalf(S,t,()=>fire(S,'onTick',dt));   // each Mitosis half ticks its own augments
  if(S.boss&&S.boss.alive&&S.bossDef.code.tick)S.bossDef.code.tick(S,S.boss,dt,S.bossDef.v);
  if(S.boss&&S.boss.alive&&!S.boss.p2&&S.bossDef.code.phase2&&S.boss.hp<S.boss.maxhp*.5){S.boss.p2=1;fx(S,{k:'ring',x:S.boss.x,y:S.boss.y,r:130,col:DATA.theme.page.mult});snd(S,'boom');S.bossDef.code.phase2(S,S.boss,S.bossDef.v)}   // phase 2 at half HP
  for(const e of S.balls)if(e.alive&&e.team===1&&!e.boss){const ec=ENEMY_CODE[e.kind];if(ec&&ec.tick)ec.tick(S,e,dt,e.def.v)}   // enemy behaviours
  if(S.ice.length){const pl_=S.player;for(let i=S.ice.length-1;i>=0;i--){const z=S.ice[i];z.t-=dt;if(z.t<=0){S.ice.splice(i,1);continue}
   if(!S.talisman&&pl_.alive&&!(pl_.frozen>0)&&S.t>=(pl_.iceT||0)&&Math.hypot(pl_.x-z.x,pl_.y-z.y)<z.r+pl_.r*.5){pl_.frozen=z.freeze;pl_.iceT=S.t+z.cd;fx(S,{k:'ring',x:pl_.x,y:pl_.y,r:pl_.r+12,col:DATA.theme.effects.freeze||'#d9f4ff'})}}}   // The Glacier's ice patches
  if(S.pockets){const PK=S.pockets;let others=0;for(const e of S.balls)if(e.alive&&e.team===1&&!e.boss)others++;   // The Eight Ball's pockets
   for(const e of S.balls){if(!e.alive||e.knockT==null||S.t-e.knockT>PK.window||S.t<(e.pocketT||0))continue;
    const cx=e.x<AW/2?0:AW,cy=e.y<AH/2?0:AH;if(Math.hypot(e.x-cx,e.y-cy)>=Math.max(PK.r,e.r*Math.SQRT2+6))continue;   // a big ball pressed into the corner counts too
    const bx=cx?cx-8:8,by=cy?cy-8:8;
    if(e.team===1&&!e.boss){fx(S,{k:'burst',x:bx,y:by,col:e.col,n:18});snd(S,'pop');S.hitKey='src:pocket';damage(S,e,e.hp+e.armor+1,'aoe');S.hitKey=null;count(S,'pocketed')}
    else if(e.team===1){if(others)continue;e.pocketT=S.t+PK.bossCooldown;e.knockT=null;   // the Eight Ball: only when it is the last ball; hurts, never kills
     const amt=Math.min(e.maxhp*PK.bossPercent/100,e.hp-1);if(amt>0){const ar=e.armor;e.armor=0;S.hitKey='src:pocket';damage(S,e,amt,'aoe');S.hitKey=null;e.armor=ar}
     const dx=AW/2-e.x,dy=AH/2-e.y,dd=Math.hypot(dx,dy)||1;e.vx=dx/dd*e.spd*2;e.vy=dy/dd*e.spd*2;fx(S,{k:'burst',x:bx,y:by,col:DATA.theme.page.chalk,n:24});fx(S,{k:'ring',x:e.x,y:e.y,r:e.r+20,col:DATA.theme.page.gold});snd(S,'impact');count(S,'bossPocketed')}
    else if(e.player||e.twin){e.knockT=null;e.pocketT=S.t+PK.stall+PK.climb;e.stall=S.t;e.stallS=e.stallC=null;fx(S,{k:'ring',x:e.x,y:e.y,r:e.r+14,col:DATA.theme.page.mult});snd(S,'hurt');count(S,'stalled')}}}   // your ball: stops dead, then speeds back up
  if(P.regen>0){const rg=P.regen*(S.regenX==null?1:S.regenX);heal(S,pl,rg*dt,true);for(const b of S.balls)if(b.twin&&b.alive)heal(S,b,rg*dt,true);if(P.miniRegen>0)for(const b of S.balls)if(b.mini&&b.alive)heal(S,b,rg*P.miniRegen*dt,true)}   // Lifeline: Minis share your Regen. S.regenX: The Samurai's Regen cut
  S.statusAcc+=dt;
  if(S.statusAcc>=.5){S.statusAcc-=.5;
   for(const e of S.balls){if(!e.alive||e.team!==1)continue;
    let cx=P.cat?(dotKinds(S,e)>=2?P.cat.both:P.cat.mult):1;
    const mf=P.dotMult&&(e.poison>0||e.burn>0)?Math.max(0,1+(dotMult(S,e)-1)*P.dotMult):1;cx*=mf;   // Seeping Wounds
    const credit=d=>{if(mf>1&&d>0&&S.dmgBy)S.dmgBy['boost:seep']=(S.dmgBy['boost:seep']||0)+d*(1-1/mf)};
    if(e.poison>0)credit(damage(S,e,e.poison*.5*CB.poisonDamagePerStackPerSecond*P.poisonX*cx*S.overtime,'poison'));
    if(e.alive&&e.burn>0){credit(damage(S,e,e.burn*.5*(CB.burnDamagePerStackPerSecond+(P.pow+S.ramp.pow)*(CB.burnPowerPercentPerStack||0)/100)*P.burnX*cx*S.overtime,'burn'));   // Burn: a flat part plus a share of Power
     e.burn=Math.max(0,e.burn-.5*CB.burnStacksLostPerSecond*P.burnDecay);if(P.burnGrow&&e.burn>0)e.burn*=Math.sqrt(1+P.burnGrow)}   // Inferno: Burn grows each second
    if(e.alive&&e.chill>0)e.chill=Math.max(0,e.chill-.5*ST.chillFadePerSecond);
    if(e.alive&&e.shock>0)e.shock=Math.max(0,e.shock-.5*ST.shockFadePerSecond)}
   for(const b of S.balls)if(b.alive&&b.team===0&&b.shock>0)b.shock=Math.max(0,b.shock-.5*ST.shockFadePerSecond);   // Shock on your side fades too
   for(const b of S.balls)if(b.alive&&b.team===0&&b.chill>0)b.chill=Math.max(0,b.chill-.5*ST.chillFadePerSecond);   // and Chill (The Glacier)
   /* Siphon (augment siphon, P.siphon): each regen tick, every ball of yours that regenerates (your ball, Mitosis twins, and Minis while they share
      your Regen) deals that tick's Regen to the enemy nearest it, as Siphon damage over time: ignores Armor, counts as a Status, boosted by Catalyst. */
   if(P.siphon&&P.regen>0){const tick=b=>{const sh=b.mini?P.miniRegen:1;if(!(sh>0))return;const e=nearestFoe(S,b);if(!e||e.team!==1||!e.alive||e.ward>S.t)return;
     e.siphT=S.t;const cx=P.cat?(dotKinds(S,e)>=2?P.cat.both:P.cat.mult):1;count(S,'siphon');damage(S,e,P.regen*sh*.5*P.siphon*cx*S.overtime,'siphon')};
    if(pl.alive)tick(pl);for(const b of S.balls.slice()){if(S.done)break;if(b.alive&&(b.twin||(b.mini&&P.miniRegen>0)))tick(b)}}}
  for(let i=S.marks.length-1;i>=0;i--){const m=S.marks[i];m.t-=dt;if(m.t<=0){S.marks.splice(i,1);fx(S,{k:'zap',x1:m.x,y1:0,x2:m.x,y2:m.y});fx(S,{k:'ring',x:m.x,y:m.y,r:m.r,col:m.src.col});snd(S,'zap');
   for(const b of S.balls)if(b.alive&&b.team===0&&Math.hypot(b.x-m.x,b.y-m.y)<m.r+b.r){if(m.pow>0)enemyHit(S,m.src,b,m.pow);if(m.knock){knock(S,b,m.x,m.y,m.knock);b.knockT=S.t}}}}
  if(S.done)return;
 }
 const capS=capOf(S.run,'spd'),capR=capOf(S.run,'spin');
 pl.spd=Math.min(capS,P.spd*(1+S.ramp.spd)*S.chill)*stallF(S,pl);
 S.over.spd=Math.max(0,P.raw.spd*(1+S.ramp.spd)*S.chill-capS);S.over.spin=Math.max(0,P.raw.spin*S.ramp.spin*S.chill-capR);
 for(const w of pl.ws){w.spin=Math.min(capR,P.spin*S.ramp.spin*S.chill);w.len=P.reach+S.ramp.reach}
 for(const b of S.balls)if(b.twin&&b.alive){const R=b.ramp;b.spd=Math.min(capS,P.spd*(1+R.spd)*S.chill)*stallF(S,b);for(const w of b.ws){w.spin=Math.min(capR,P.spin*R.spin*S.chill);w.len=P.reach+R.reach}}   // Mitosis twin: your stats with its own ramp
 // move
 for(const b of S.balls){
  if(!b.alive)continue;
  if(b.inv>0)b.inv-=dt;if(b.bcd>0)b.bcd-=dt;if(b.flash>0)b.flash-=dt;
  if(b.life!=null&&(b.life-=dt)<=0){b.alive=false;fx(S,{k:'burst',x:b.x,y:b.y,col:b.col,n:5});continue}   // Afterimage clones fade
  if(b.fixed){b.vx=b.vy=0;continue}   // Mini Hut: never moves
  let sm=1;if(b.stun>0){b.stun-=dt;sm=.15}if(b.pause>0){b.pause-=dt;sm=0}if(b.stall!=null)sm*=stallF(S,b);if(b.dashT>0)b.dashT-=dt;if(b.tele>0)b.tele-=dt;   // pause: winding up; dashT: lunging or charging
  if(b.frozen>0){b.frozen-=dt;sm=0}else if(b.chill>0)sm*=Math.max(0,1-b.chill*ST.chillSlowPercent/100);   // Freeze stops the ball, Chill slows it
  b.x+=b.vx*dt*sm;b.y+=b.vy*dt*sm;
  let hit=false;
  if(b.x<b.r){b.x=b.r;b.vx=Math.abs(b.vx);hit=true}else if(b.x>AW-b.r){b.x=AW-b.r;b.vx=-Math.abs(b.vx);hit=true}
  if(b.y<b.r){b.y=b.r;b.vy=Math.abs(b.vy);hit=true}else if(b.y>AH-b.r){b.y=AH-b.r;b.vy=-Math.abs(b.vy);hit=true}
  if(hit){const j=b.ram||b.slash?0:(rnd(S.rsrc)-.5)*CB.wallBounceJitter,c=Math.cos(j),s=Math.sin(j),vx=b.vx*c-b.vy*s,vy=b.vx*s+b.vy*c;
   // keep heading into the arena after the nudge
   b.vx=(b.x<=b.r)?Math.abs(vx):(b.x>=AW-b.r)?-Math.abs(vx):vx;b.vy=(b.y<=b.r)?Math.abs(vy):(b.y>=AH-b.r)?-Math.abs(vy):vy;
   if(b.player){snd(S,'wall');if(live){count(S,'wallHits');bounceEvent(S,b)}if(S.done)return}
   else if(b.twin){snd(S,'wall');if(live){count(S,'wallHits');asHalf(S,b,()=>bounceEvent(S,b))}if(S.done)return}   // Mitosis twin: its bounces trigger its own augments
   else if(live&&b.mini&&S.t<S.miniBounce){asHalf(S,halfOf(b),()=>bounceEvent(S,b));if(S.done)return}   // Pack Bounce: Minis' bounces count as yours
   else if(live&&b.team===1){count(S,'enemyWallHits');if(b.boss)bossFistRamp(S,b);if(b.boss&&S.bossDef&&S.bossDef.code.onWall)S.bossDef.code.onWall(S,b,S.bossDef.v);else if(ENEMY_CODE[b.kind]&&ENEMY_CODE[b.kind].onWall)ENEMY_CODE[b.kind].onWall(S,b,b.def.v);fire(S,'onEnemyWall',{ball:b,speed:Math.hypot(b.vx,b.vy)});if(S.done)return}}
  const sp=Math.hypot(b.vx,b.vy);
  if(b.stall!=null){}else if(sp<5){if(!(b.frozen>0)&&!(b.pause>0))launch(S,b)}else{const tgt=b.spd*(b.dashT>0?(b.dashX||1):1),ns=sp+(tgt-sp)*Math.min(1,(b.dashT>0?12:4)*dt);b.vx*=ns/sp;b.vy*=ns/sp}
  if(b.aim&&b.stun<=0&&!(b.frozen>0)&&!(b.dashT>0)&&!b.noAim){const tg=nearestFoe(S,b);if(tg){let d=Math.atan2(tg.y-b.y,tg.x-b.x)-Math.atan2(b.vy,b.vx);d=Math.atan2(Math.sin(d),Math.cos(d));const q=clamp(d,-b.aim*dt,b.aim*dt),c=Math.cos(q),s=Math.sin(q),vx=b.vx*c-b.vy*s;b.vy=b.vx*s+b.vy*c;b.vx=vx}}
  for(const w of b.ws){
   if(w.cd>0)w.cd-=dt;if(w.pcd>0)w.pcd-=dt;
   if(w.type==='bow'){
    const tg=nearestFoe(S,b);
    if(tg){let d=Math.atan2(tg.y-b.y,tg.x-b.x)-w.ang;d=Math.atan2(Math.sin(d),Math.cos(d));const mx=Math.max(1.5,w.spin)*1.6*dt*sm;w.ang+=clamp(d,-mx,mx)}
    if(live&&!(b.frozen>0)){w.ft-=dt;if(w.ft<=0){
     // your Bow: Spin sets the fire rate (weapon Spin = its listed fireEvery), Reach sets arrow speed, and arrows push with your Knockback
     const BW=RULES.bow||{},WB=P.W;w.ft=b.team===0?Math.max(BW.minFireEvery||.25,w.every*Math.pow(WB.spin/Math.max(.1,w.spin),BW.spinPower==null?1:BW.spinPower)):w.every;
     if(b.team===0){const me=b.player||b.twin;shoot(S,b,w.ang,me?1:w.share||1,me,1+Math.floor(me?(w.arr||0):(b.ramp||S.ramp).arrows),{bow:me?w:null,side:w.side||0,arrow:true,spdX:clamp(w.len/Math.max(1,WB.reach),BW.minSpeedX||.5,BW.maxSpeedX||2.5),kb:me?P.kb:(w.kb||0)})}
     else{const PR=RULES.projectiles,nv=Math.min(PR.maxPerVolley,1+Math.floor(w.arr||0)),pw=w.pow*(1+(w.rmult||0));   // w.arr: a boss bow's Ramp (more arrows)
      for(let k=0;k<nv;k++){const a=w.ang+(k-(nv-1)/2)*PR.spread,c=Math.cos(a),s=Math.sin(a);S.projs.push({x:b.x+c*(b.r+6),y:b.y+s*(b.r+6),vx:c*PR.enemySpeed,vy:s*PR.enemySpeed,r:5,team:1,pow:pw,owner:b,pw:w,bn:0,life:PR.lifetime,ang:a})}snd(S,'shot')}}}
   }else w.ang+=w.spin*w.dir*dt*sm;
  }
  if(live&&b.def&&b.def.heal&&b.alive&&!(b.cutT>S.t)){let m=null;for(const o of S.balls)if(o.alive&&o.team===1&&o!==b&&o.hp<o.maxhp&&(!m||o.hp/o.maxhp<m.hp/m.maxhp))m=o;if(m){heal(S,m,b.def.heal*S.hs*dt,true);b.healT=m}else b.healT=null}
 }
 // ball vs ball
 const B=S.balls,n=B.length;
 for(let i=0;i<n;i++){const a=B[i];if(!a.alive)continue;
  for(let j=i+1;j<n;j++){const b=B[j];if(!b.alive||!a.alive)continue;
   const dx=b.x-a.x,dy=b.y-a.y,min=a.r+b.r,d2=dx*dx+dy*dy;if(d2>=min*min||d2===0)continue;
   const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,ov=min-d,tm=a.m+b.m;
   a.x-=nx*ov*b.m/tm;a.y-=ny*ov*b.m/tm;b.x+=nx*ov*a.m/tm;b.y+=ny*ov*a.m/tm;
   const vn=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny,tk=live?enterHalf(S,halfOf(a)||halfOf(b)):null;   // a Mitosis twin's (or its Minis') collisions run as that half
   if(vn>0){const imp=2*vn/tm;a.vx-=imp*b.m*nx;a.vy-=imp*b.m*ny;b.vx+=imp*a.m*nx;b.vy+=imp*a.m*ny;if(a.player||b.player)snd(S,'clack')
    if(live&&(a.team===1||b.team===1)){count(S,a.team===b.team?'enemyCollisions':'collisions');
     {const push=S.P.impact+(S.P.W.fist||S.P.noWeapon?S.P.kb:0);if(push>0&&(a.player||b.player||a.twin||b.twin)&&a.team!==b.team){const p=a.team===0?a:b,e=p===a?b:a;knockBy(S,e,p.x,p.y,push)}}   // Impact; Bare Fists' contacts also push with Knockback
     fire(S,'onCollide',{a,b,impact:vn});if(a.team===1&&b.team===1&&S.bossDef&&S.bossDef.code.onEnemyCollide)S.bossDef.code.onEnemyCollide(S,a,b,S.bossDef.v);if(S.done){exitHalf(S,tk);return}}}
   if(live&&a.team!==b.team){
    const p=a.team===0?a:b,e=a.team===0?b:a;
    if(e.boss&&p.player&&S.bossDef&&S.bossDef.code.onContact)S.bossDef.code.onContact(S,e,p,S.bossDef.v);   // The Glacier's touch
    if(p.bcd<=0){p.bcd=CB.bodyHitCooldown;if(p.player||p.twin){S.hitOwner=p.twin?'twin':null;if(P.W.fist&&!P.noWeapon)playerHit(S,e,'body',1,null,true);S.hitOwner=null;fire(S,'onTouch',e)}else if(p.hut){}else{S.hitOwner=p.miniYou?'miniyou':null;const mp=S.t<S.miniHunt?Math.max(RULES.minis.powerPercent/100,S.miniHuntShare):RULES.minis.powerPercent/100;
     playerHit(S,e,'mini',p.miniYou?(P.W.fist?p.share:mp):mp*P.miniDmgX);S.hitOwner=null;
     if(e.alive&&P.miniKb>0)knockBy(S,e,p.x,p.y,pushStat(S)*P.miniKb);if(e.alive&&S.t<S.miniTouch)fire(S,'onTouch',e)}}   // Pack Training knock, Pack Hunt and Pack Contact windows
    if(e.alive&&p.alive&&e.body>0&&(e.bcd<=0||e.ram)&&!(e.frozen>0)){e.bcd=CB.enemyBodyHitCooldown;const rv=e.ram&&RAMV();enemyHit(S,e,p,e.body*(rv?(e.kind==='grunt'?rv.gruntRamDamageMult:rv.ramDamageMult):1));
     if(rv&&p.alive){knock(S,p,e.x,e.y,rv.ramKnock);p.knockT=S.t;endRam(e);fx(S,{k:'ring',x:p.x,y:p.y,r:p.r+18,col:e.col});snd(S,'impact')}
     else if(e.impact>0&&p.alive){knock(S,p,e.x,e.y,e.impact);p.knockT=S.t}}   // pool balls shove your ball on contact (stripes harder)   // a ram hits hard and knocks you flying
    if(S.done){exitHalf(S,tk);return}
   }
   exitHalf(S,tk)}}
 // weapons
 const segs=[];
 for(const b of S.balls)if(b.alive)for(const w of b.ws)segs.push({b,w,s:seg(b,w)});
 if(live)for(const A_ of segs){const w=A_.w,b=A_.b;
  if(w.type==='shield'||w.type==='bow'||w.cd>0||!b.alive||b.frozen>0)continue;
  const me=b.player||b.twin,sw=me&&P.sweep>0,tk=b.team===0?enterHalf(S,halfOf(b)):null;   // Sweep: the player's blade has no shared cooldown; each enemy has its own per blade (w.sw), so one swing hits every enemy it passes
  for(const t of S.balls){if(!t.alive||t.team===b.team||(sw&&S.t<((w.sw||(w.sw={}))[t.id]||0)))continue;
   if(dSegPt(A_.s,t.x,t.y)<t.r+w.th){
    if(b.team===0&&t.boss&&S.bossDef&&S.bossDef.code.blocks&&S.bossDef.code.blocks(S,t,b,S.bossDef.v)){w.cd=w.cdMax;fx(S,{k:'spark',x:t.x,y:t.y});snd(S,'parry');count(S,'blocked');break}   // The Bulwark's shield
    if(sw)w.sw[t.id]=S.t+w.cdMax;else w.cd=w.cdMax;if(b.team===0)knockBy(S,t,b.x,b.y,me?S.P.kb:w.kb);else if(!w.ghost){knock(S,t,b.x,b.y,w.kb);t.knockT=S.t}if(w.stun)t.stun=t.boss?w.stun*.4:w.stun;
    if(b.team===0)S.bladeAt=Math.hypot(t.x-b.x,t.y-b.y)-b.r-t.r;   // how far from the player's ball the blade met the enemy, in Reach units (Sweet Spot)
    if(b.team===0){S.hitOwner=b.miniYou?'miniyou':b.twin?'twin':null;playerHit(S,t,'weapon',me?1:w.share||1,null,me);S.hitOwner=null}else{enemyHit(S,b,t,w.pow*(w.mult||1)*(1+(w.rmult||0)));if(b.boss)bossRamp(S,b,w)}
    if(S.done){exitHalf(S,tk);return}if(!sw)break}}exitHalf(S,tk)}
 for(let i=0;i<segs.length;i++){const a=segs[i];if(a.w.pcd>0||!a.b.alive||a.w.ghost)continue;   // ghost weapons (the Clockwork's hands) pass through other weapons
  for(let j=i+1;j<segs.length;j++){const b=segs[j];if(b.b.team===a.b.team||b.w.pcd>0||!b.b.alive||b.w.ghost)continue;
   if(segX(a.s,b.s)){a.w.dir*=-1;b.w.dir*=-1;a.w.pcd=b.w.pcd=CB.parryCooldown;if(live&&(a.b.team===0||b.b.team===0))count(S,'parries');
    fx(S,{k:'spark',x:(a.s[2]+b.s[2])/2,y:(a.s[3]+b.s[3])/2});snd(S,'parry');
    if(live){const pw=a.b.team===0?a:b,ew=a.b.team===0?b:a;if(pw.b.player||pw.b.twin)asHalf(S,halfOf(pw.b),()=>fire(S,'onParry',ew.b))}
    break}}}
 // projectiles
 for(const p of S.projs){
  if(p.dead)continue;p.life-=dt;if(p.life<=0){p.dead=true;continue}
  p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.arrow)p.d+=Math.hypot(p.vx,p.vy)*dt;   // how far an arrow has flown (Sweet Spot)
  let out=false;
  if(p.x<p.r||p.x>AW-p.r){out=true;if(p.bn>0){p.vx=-p.vx;p.x=clamp(p.x,p.r,AW-p.r)}}
  if(p.y<p.r||p.y>AH-p.r){out=true;if(p.bn>0){p.vy=-p.vy;p.y=clamp(p.y,p.r,AH-p.r)}}
  if(out){if(p.bn>0){p.bn--;p.ang=Math.atan2(p.vy,p.vx);if(p.team===0&&P.projBounce>0)asHalf(S,p.half,()=>bounceEvent(S,p))}else{p.dead=true;continue}}
  if(!p.pierce)for(const sg of segs)if(sg.b.alive&&sg.b.team!==p.team&&!sg.w.ghost&&dSegPt(sg.s,p.x,p.y)<p.r+sg.w.th+1){p.dead=true;fx(S,{k:'spark',x:p.x,y:p.y});snd(S,'parry');break}
  if(p.dead)continue;
  for(const t of S.balls){if(!t.alive||t.team===p.team)continue;
   if(Math.hypot(t.x-p.x,t.y-p.y)<t.r+p.r){
    if(p.pierce){if(S.t<(p.hitT[t.id]||0))continue;p.hitT[t.id]=S.t+p.rehit;enemyHit(S,p.owner,t,p.pow);if(p.shock)addPlayerShock(S,t,p.shock);   // The Storm's lightning arrow passes through
     fx(S,{k:'ring',x:t.x,y:t.y,r:t.r+10,col:DATA.theme.effects.shock||'#8fe3ff'});if(p.stormRamp&&bossRampOn(S,p.owner)&&BRAMP.bow)p.owner.arr=(p.owner.arr||0)+bossRampX()/BRAMP.bow.hitsPerArrow;if(S.done)return;continue}
    p.dead=true;if(p.team===0){if(p.kb>0){const sp=Math.hypot(p.vx,p.vy)||1;knockBy(S,t,t.x-p.vx/sp*10,t.y-p.vy/sp*10,p.kb)}asHalf(S,p.half,()=>{S.arrow=p.arrow;S.arrowD=p.d;S.rampBow=p.bow;const dealt=playerHit(S,t,'proj',p.f,null,p.main);S.arrow=false;S.rampBow=null;if(!t.alive&&S.P.domino&&!S.done)dominoArrow(S,p,t,dealt)})}else{enemyHit(S,p.owner,t,p.pow);if(p.pw&&p.owner&&p.owner.boss)bossRamp(S,p.owner,p.pw)}break}}
  if(S.done)return;
 }
 if(S.projs.length&&S.projs.some(p=>p.dead))S.projs=S.projs.filter(p=>!p.dead);
 if(B.some(b=>!b.alive&&b!==pl))S.balls=B.filter(b=>b.alive||b===pl);
 if(live&&!S.done){let any=false;for(const b of S.balls)if(b.alive&&b.team===1){any=true;break}if(!any){S.done='win';snd(S,'win')}}
}

/* ---------- 6. run and shop ---------- */
/* A run is plain JSON so it can be snapshotted: no functions, no references to fight state. */
function newRun(weapon,seed){
 const RN=RULES.run;
 const run={seed,rs:seed|0,weapon,tier:1,stage:0,gold:RN.startGold,augs:[],slots:RN.startSlots,shelf:0,intCap:RULES.economy.interestCap,tune:Object.fromEntries(TUNE_IDS.map(k=>[k,0])),trophies:[],bosses:[],
  shop:null,enc:null,pending:null,bag:[],active:[],endless:false,grown:0,stats:{fights:0,kills:0,bestHit:0,dmg:0}};
 const pool=BOSS_POOL.slice();for(let i=pool.length-1;i>0;i--){const j=rnd(run)*(i+1)|0;[pool[i],pool[j]]=[pool[j],pool[i]]}
 const need=RN.tiersToWin-1;run.bosses=[];   // a boss with minTier never comes before that tier; the shuffled pool is otherwise used in order
 for(let i=0;i<need;i++){const T=i+1,left=pool.filter(id=>!run.bosses.includes(id)),ok=left.filter(id=>(BOSS[id].minT||1)<=T);run.bosses.push((ok.length?ok:left.length?left:pool)[0])}run.bosses.push(FINAL_BOSS);
 planTier(run);rollShop(run);
 return run;
}
function bossFor(run){return run.bosses[run.tier-1]}
/* Builds all three fights of the current tier at once (run.plan), so the shop can preview fights that are still ahead.
   The run then takes run.enc from the plan as it advances, so a preview always shows the fight that will really come. */
function planTier(run){
 const st=run.stage,plan=[];for(let i=0;i<3;i++){run.stage=i;plan.push(genEnc(run))}
 run.stage=st;run.plan=plan;run.planTier=run.tier;run.enc=plan[st];
}
/* The fight at stage i of the current tier, from the plan (or the current fight if there is no plan, as in an old saved run). */
function encAt(run,i){return run.plan&&run.planTier===run.tier&&run.plan[i]?run.plan[i]:run.enc}
/* Builds the enemy list for the current tier and stage by spending a budget on enemy costs. */
function genEnc(run){
 const T=run.tier,st=run.stage,SC=RULES.scaling;
 if(st===2){let id=run.bosses[T-1];if(!id||!BOSS[id]){id=pick(run,BOSS_POOL.concat(FINAL_BOSS));run.bosses[T-1]=id}
  if(BOSS[id].v.rack)return{boss:id,list:[]};   // The Eight Ball brings its rack instead
  const list=[];let bud=Math.max(0,(T-SC.bossAddsStartTier)*SC.bossAddsBudgetPerTier);const opts=SC.bossAddTypes.filter(k=>ENEMY[k]&&ENEMY[k].min<=T);let guard=0;
  while(bud>=.5&&list.length<SC.bossAddsMax&&opts.length&&guard++<60){const k=pick(run,opts);if(ENEMY[k].cost>bud){if(bud<1&&ENEMY.swarm){list.push('swarm');bud-=.5}continue}list.push(k);bud-=ENEMY[k].cost}
  return{boss:id,list}}
 let bud=(st===0?SC.fight1BudgetBase:SC.fight2BudgetBase)+T*(st===0?SC.fight1BudgetPerTier:SC.fight2BudgetPerTier);
 let all=Object.keys(ENEMY).filter(k=>ENEMY[k].min<=T);if(!all.length)all=Object.keys(ENEMY);
 const feat=[],nf=Math.min(all.length,2+(rnd(run)*2|0));
 while(feat.length<nf){const k=pick(run,all);if(!feat.includes(k))feat.push(k)}
 const cheapest=all.slice().sort((a,b)=>ENEMY[a].cost-ENEMY[b].cost)[0];
 const list=[];let guard=0;
 while(bud>=.5&&list.length<SC.maxEnemiesPerFight&&guard++<80){const k=pick(run,feat),d=ENEMY[k];
  if(d.cost>bud){if(guard>40){if(bud>=1&&ENEMY.grunt){list.push('grunt');bud-=1}else if(ENEMY.swarm){list.push('swarm');bud-=.5}else break}continue}
  if(d.pack){const n=Math.min(2+(rnd(run)*3|0),Math.floor(bud/d.cost),SC.maxEnemiesPerFight-list.length);for(let i=0;i<n;i++)list.push(k);bud-=n*d.cost}else{list.push(k);bud-=d.cost}}
 if(!list.length)list.push(cheapest);
 const enc={list};const EL=ELITE;if(T>=EL.fromTier&&list.length&&rnd(run)*100<EL.chancePercent){const c=list.map((k,i)=>i).filter(i=>list[i]!=='swarm');if(c.length)enc.elite={i:pick(run,c),mod:pick(run,ELITE_MODS)}}
 return enc;
}
function augCost(run,id){if(run.shop&&run.shop.free)return 0;return Math.max(1,COST[AUG[id].rar]-(has(run,'coupon')?TROPHY.coupon.v.discount:0)-(has(run,'couponL')?TROPHY.couponL.v.discount:0))}   // shop.free: a Free Shop Ticket was used on this shop
function sellValue(run,id){const c=COST[AUG[id].rar];return has(run,'recycleL')?Math.floor(c*TROPHY.recycleL.v.percent/100):has(run,'recycle')?c:Math.floor(c*RULES.economy.sellPercent/100)}
function itemCost(run,id){return run.shop&&run.shop.free?0:ITEM[id].cost}
function bagSize(run){return CONS.bagSize+((run&&run.bagX)||0)}   // the Big Satchel adds slots
function tuneCost(run,k){if(run.shop&&run.shop.free)return 0;return(TUNE[k].cost!=null?TUNE[k].cost:RULES.economy.tuneUpBaseCost)+(TUNE[k].costStep!=null?TUNE[k].costStep:RULES.economy.tuneUpCostStep)*(run.tune[k]||0)}   // cap tune-ups can set their own starting "cost"
/* needs "blade" (augments and tune-ups in the data): only offered to weapons with a blade or bow, not Bare Fists, where Spin, Reach and Knockback do nothing. */
const fits=(run,d)=>!(d&&((d.needs==='blade'&&WEAPONS[run.weapon].fist)||(d.needs==='ranged'&&!(WEAPONS[run.weapon].type==='bow'||run.augs.some(x=>x.id==='sidearm'||x.id==='multi')))));   // ranged: Bow, or Sidearm or Multishot owned
function rollShop(run,keepReroll){
 const n=RULES.run.shopAugments+run.shelf,owned=new Set(run.augs.map(a=>a.id).concat((run.bag||[]).filter(x=>x.aug).map(x=>x.aug))),offers=[],ids=Object.keys(AUG).filter(k=>fits(run,DATA.augments[k])&&!isVoid(k)&&!(run.questsDone&&run.questsDone[k]));   // a finished quest is not offered again
 const w=DATA.rarities.map(r=>r.shopWeight+r.shopWeightPerTier*run.tier);if(has(run,'taste'))for(let i=2;i<w.length;i++)w[i]*=TROPHY.taste.v.mult;if(has(run,'tasteL'))for(let i=2;i<w.length;i++)w[i]*=TROPHY.tasteL.v.mult;   // Rare Taste: the third rarity (Rare) and every rarity above it
 let tot=0;for(const x of w)tot+=x;
 const first=run.tier===1&&run.stage===0&&!run.endless,afford=c=>!first||c<=run.gold;   // the first shop only offers what you can afford
 for(let i=0;i<n;i++){let x=rnd(run)*tot,r=0;while(r<w.length-1&&x>=w[r]){x-=w[r];r++}
  const free=k=>!owned.has(k)&&!offers.some(o=>o.id===k)&&afford(augCost(run,k));
  let c=ids.filter(k=>AUG[k].rar===r&&free(k));
  if(!c.length)c=ids.filter(free);
  if(!c.length)c=ids.filter(k=>!owned.has(k)&&!offers.some(o=>o.id===k));
  if(c.length)offers.push({id:pick(run,c),sold:false})}
 const tk=Object.keys(TUNE).filter(k=>TUNE[k].weight>0&&fits(run,DATA.tuneUps[k])&&!(TUNE[k].cap&&uncapped(run,TUNE[k].cap))&&!(TUNE[k].cap==='armor'&&capRaise(run,'armor')>=95-baseCap('armor'))&&afford(tuneCost(run,k))),tunes=[],nt=Math.min(tk.length,RULES.run.shopTuneUps);
 while(tunes.length<nt){const left=tk.filter(k=>!tunes.some(t=>t.k===k));let tw=0;for(const k of left)tw+=TUNE[k].weight;let x=rnd(run)*tw,k=left[0];for(const q of left){x-=TUNE[q].weight;if(x<0){k=q;break}}tunes.push({k,sold:false})}   // weighted: Hatchling is rarer
 const base=rerollBase(run);
 const ik=Object.keys(ITEM).filter(k=>ITEM[k].weight>0&&fits(run,DATA.consumables[k])&&afford(ITEM[k].cost)),items=[];   // weight 0: never in the shop (the Free Shop Ticket)
 for(let i=0;i<Math.min(CONS.shopItems,ik.length);i++){const left=ik.filter(k=>!items.some(x=>x.id===k)&&!(k==='crystal'&&!voidPool(run).length));if(!left.length)break;let tw=0;for(const k of left)tw+=ITEM[k].weight;let x=rnd(run)*tw,k=left[0];for(const q of left){x-=ITEM[q].weight;if(x<0){k=q;break}}items.push({id:k,sold:false})}   // weighted (items' "weight", default 1)
 run.shop={offers,tunes,items,reroll:keepReroll?run.shop.reroll+RULES.economy.rerollCostStep:base};
}
/* Shop lock: a locked shop comes back after the next fight instead of a new one (sold slots stay sold). A shop that came back (kept) can't be
   locked again; the next new shop can. Rerolling makes a new shop, so it drops the lock. */
function rerollBase(run){return has(run,'couponL')?TROPHY.couponL.v.rerollBase:has(run,'coupon')?TROPHY.coupon.v.rerollBase:RULES.economy.rerollBaseCost}
function toggleLock(run){const sh=run.shop;if(!sh||sh.kept)return false;sh.locked=!sh.locked;return true}
function buyOffer(run,i){const o=run.shop.offers[i];if(!o||o.sold||run.augs.length>=run.slots)return false;const c=augCost(run,o.id);if(run.gold<c)return false;run.gold-=c;o.sold=true;   // cap Legendaries: the cap is gone for the rest of the run
 run.augs.push({id:o.id,n:0,f:{}});return true}
function buyTune(run,i){const t=run.shop.tunes[i];if(!t||t.sold)return false;const c=tuneCost(run,t.k);if(run.gold<c)return false;run.gold-=c;t.sold=true;run.tune[t.k]=(run.tune[t.k]||0)+1;return true}
function reroll(run){const c=run.shop.reroll;if(run.gold<c)return false;run.gold-=c;rollShop(run,true);return true}
function sellAug(run,i){const a=run.augs[i];if(!a)return false;run.gold+=sellValue(run,a.id);run.augs.splice(i,1);return true}
/* Moves the augment at socket i so it ends up at socket j (drag and drop). */
function moveAugTo(run,i,j){const n=run.augs.length;if(i===j||i<0||j<0||i>=n||j>=n)return false;const a=run.augs.splice(i,1)[0];run.augs.splice(j,0,a);return true}
function moveAug(run,i,d){const j=i+d;if(j<0||j>=run.augs.length)return false;const t=run.augs[i];run.augs[i]=run.augs[j];run.augs[j]=t;return true}
/* Pays out after a won fight. Returns the lines shown on the payout sheet. Call before advance(). */
function payout(run,S){
 const st=run.stage,E=RULES.economy,TX=DATA.text,lines=[[st===2?TX.payBossBeaten:TX.payFightWon,[E.payoutFight1,E.payoutFight2,E.payoutBoss][st]]];
 const f=S.player.hp/S.player.maxhp*100;if(f>=E.hpBonusHighAtPercent)lines.push([tpl(TX.payHpHigh,{percent:E.hpBonusHighAtPercent}),E.hpBonusHighGold]);else if(f>=E.hpBonusLowAtPercent)lines.push([tpl(TX.payHpLow,{percent:E.hpBonusLowAtPercent}),E.hpBonusLowGold]);
 if(S.gold)lines.push([TX.payJackpot,S.gold]);
 if(run.enc&&run.enc.elite)lines.push([TX.payElite||'Elite defeated',ELITE.gold]);
 fire(S,'onWin',lines);
 const int=Math.min(run.intCap,Math.floor(run.gold/E.interestPerGold));if(int)lines.push([tpl(TX.payInterest,{gold:run.gold}),int]);
 let total=0;for(const l of lines)total+=l[1];run.gold+=total;
 const s=run.stats;s.fights++;s.kills+=S.kills;s.dmg+=S.dmg;if(S.bestHit>s.bestHit)s.bestHit=S.bestHit;
 const rc=run.count||(run.count={});for(const k in S.count)rc[k]=(rc[k]||0)+S.count[k];   // run-long counters
 return{lines,total};
}
/* Moves the run to the next fight. After a boss it also queues three trophies to pick from. */
/* Endless mode starts (after the final boss): +endlessSlots sockets, past the socket cap. */
function startEndless(run){if(run.endless)return false;run.endless=true;run.slots+=RULES.run.endlessSlots==null?1:RULES.run.endlessSlots;return true}
function advance(run){
 run.active=[];
 if(run.stage===2){
  const have=new Set(run.trophies),L=!!run.endless,opts=Object.keys(TROPHY).filter(k=>TROPHY[k].legendary===L&&(k==='socket'?run.slots<RULES.run.maxSlots:TROPHY[k].many||!have.has(k))),p=[];   // after an endless boss: legendary trophies only
  while(p.length<3&&opts.length){let tw=0;for(const q of opts)tw+=TROPHY[q].weight;let x=rnd(run)*tw,i=0;for(;i<opts.length-1;i++){x-=TROPHY[opts[i]].weight;if(x<0)break}p.push(opts.splice(i,1)[0])}   // weighted: Spare Socket shows up a little more often
  run.pending=p.length?p:null;run.pendingL=L&&!!p.length;run.tier++;run.stage=0;run.grown=(run.grown||0)+1;if(!run.bosses[run.tier-1])run.bosses[run.tier-1]=pick(run,BOSS_POOL.concat(FINAL_BOSS));
 }else run.stage++;
 if(run.plan&&run.planTier===run.tier)run.enc=run.plan[run.stage];else planTier(run);
 if(run.shop&&run.shop.locked){run.shop.locked=false;run.shop.kept=true;run.shop.reroll=rerollBase(run)}else rollShop(run);   // a locked shop comes back once
}
function pickTrophy(run,id){
 if(!run.pending||!run.pending.includes(id))return false;
 run.trophies.push(id);run.pending=null;run.pendingL=false;const tv=TROPHY[id]&&TROPHY[id].v||{};
 if(id==='socketL')run.slots+=tv.slots;if(id==='chest')run.gold+=tv.gold;if(id==='satchel')run.bagX=(run.bagX||0)+tv.slots;
 if(id==='ticket'){run.bag=run.bag||[];for(let k=0;k<(tv.count||1);k++)run.bag.push({id:'ticket',use:false})}   // goes in the bag even if it is full
 if(id==='bankerL')run.intCap=Math.max(run.intCap,tv.cap);if(id==='couponL')run.shop.reroll=Math.min(run.shop.reroll,tv.rerollBase);
 if(id==='shelfL'){run.shelf+=tv.count-1;id='shelf'}
 if(id==='socket')run.slots++;if(id==='shelf'){run.shelf++;if(run.shop.locked||run.shop.kept){const keep=run.shop;rollShop(run);const extra=run.shop.offers.find(o=>!keep.offers.some(x=>x.id===o.id));run.shop=keep;if(extra)keep.offers.push(extra)}else{const r=run.shop.reroll;rollShop(run);run.shop.reroll=r}}   // a locked or kept shop just gains the extra slot
 if(id==='banker')run.intCap=TROPHY.banker.v.cap;if(id==='coupon')run.shop.reroll=Math.min(run.shop.reroll,TROPHY.coupon.v.rerollBase);
 return true;
}

const CORE={startEndless,bagAug,unbagAug,canBag,bagOwned,useTicket,bagSize,itemCost,nHas,toggleLock,rerollBase,statView,shopState,openMarket,pickVoid,voidPool,isVoid,VOID_RAR,rampWith,statusesApplied,LTN,capOf,baseCap,CAP_KEYS,shownMult,shopMult,ITEM,CONS,buyItem,toggleItem,sellItem,ENEMY_CODE,ELITE,isOff,setOff,DATA,RULES,AW,AH,TAU,WEAPONS,ENEMY,BOSS,AUG,TUNE,TROPHY,RAR,COST,CORE_PROBLEMS,tpl,rnd,newRun,newFight,step,calcPlayer,genEnc,planTier,encAt,endlessScale,short,addSourceKind,addChill,freeze,srcState,sourceLists,fire,inc,more,hasTag,count,rollShop,buyOffer,buyTune,reroll,sellAug,moveAug,moveAugTo,payout,advance,pickTrophy,augCost,sellValue,tuneCost,bossFor,seg,enemies,minis};
if(typeof module!=='undefined')module.exports=CORE;
