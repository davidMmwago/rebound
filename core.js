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
const CORE_PROBLEMS=[];
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
const ST=Object.assign({chillSlowPercent:5,chillMax:10,chillFadePerSecond:1,freezeSeconds:1,bossFreezePercent:50},RULES.status||{});
/* Placeholders any text may use, on top of its own values. */
const GLOBALS={miniPower:RULES.minis.powerPercent,miniMax:RULES.minis.maxAlive,poisonDps:RULES.combat.poisonDamagePerStackPerSecond,burnDps:RULES.combat.burnDamagePerStackPerSecond,critMult:RULES.player.critMult,armorCap:RULES.combat.armorMaxReductionPercent,chillSlow:ST.chillSlowPercent,chillMax:ST.chillMax,freezeSeconds:ST.freezeSeconds,burnPower:RULES.combat.burnPowerPercentPerStack||0};
function tpl(s,vals){return String(s==null?'':s).replace(/\{(\w+)\}/g,(m,k)=>vals&&k in vals?f1v(vals[k]):k in GLOBALS?f1v(GLOBALS[k]):m)}
function f1v(v){return typeof v==='number'?f1(v):String(v)}

const WEAPONS={};
for(const k of dkeys(DATA.weapons)){const w=DATA.weapons[k];
 WEAPONS[k]={id:k,name:w.name,blurb:w.blurb,type:w.fists?null:w.type,pow:w.power,reach:w.reach,spin:w.spin,spd:w.speed,blades:w.blades,fist:!!w.fists,fireEvery:w.fireEvery||1.1,rampDef:w.ramp||{},ramp:tpl(w.rampText,w.ramp)}}
const WDEF={};
for(const k of dkeys(DATA.weaponTypes)){const d=DATA.weaponTypes[k];WDEF[k]={cd:d.hitCooldown,kb:d.knockback,th:d.thickness,stun:d.stun}}
function mkW(type,pow,len,spin,o){const d=WDEF[type];return Object.assign({type,pow,len,spin,dir:1,ang:0,cd:0,cdMax:d.cd,kb:d.kb,th:d.th,stun:d.stun||0,pcd:0,every:1.9,ft:1},o)}
function mkBall(o){const b=Object.assign({id:++UID,x:AW/2,y:AH/2,vx:0,vy:0,r:18,team:1,hp:10,spd:200,body:0,armor:0,ws:[],poison:0,burn:0,inv:0,stun:0,bcd:0,flash:0,aim:RULES.combat.homing,col:'#888899',alive:true},o);b.hp=Math.max(1,Math.round(b.hp));b.maxhp=b.hp;b.m=b.r*b.r/324;return b}
function launch(S,b){const a=rnd(S.rsrc)*TAU;b.vx=Math.cos(a)*b.spd;b.vy=Math.sin(a)*b.spd}

/* ---------- 2. enemies and bosses ---------- */
function unitFromData(d){return{name:d.name,cost:d.cost,min:d.minTier,pack:!!d.pack,hp:d.hp,r:d.radius,spd:d.speed,body:d.bodyDamage||0,armor:d.armor||0,col:d.color,
 w:(d.weapons||[]).map(w=>[w.type,w.power,w.reach,w.spin,w.fireEvery]),bomb:d.bombDamage||0,bombR:d.bombRadius||85,split:d.splitsInto||null,splitN:d.splitCount||2,heal:d.healPerSecond||0,spawns:d.spawns||null,v:d.values||{}}}
const ENEMY={};
for(const k of dkeys(DATA.enemies))ENEMY[k]=unitFromData(DATA.enemies[k]);
/* Special behaviour for bosses, by id. A boss in the data with no entry here is a plain big enemy.
   Hooks: onSpawn(S,b,v) once; tick(S,b,dt,v) every step; onDeath(S,b,v); onPlayerBounce(S,playerBall,v). v is the boss's "values". */
const BOSS_CODE={
 hydra:{onDeath(S,b,v){const g=b.gen||0;if(g<v.generations)for(let i=0;i<v.children;i++){const c=spawnEnemy(S,b.kind,b.x+(i%2?14:-14),b.y+(i>1?14:0),{hp:b.maxhp*v.childHpPercent/100,r:b.r*v.childSizePercent/100,gen:g+1,spd:b.spd*v.childSpeedPercent/100,body:b.body*v.childBodyDamagePercent/100,noBoss:true});c.boss=true}}},
 reflect:{onSpawn(S,b,v){const P=S.P,W=P.W;b.spd=P.spd*v.speedPercent/100;if(W.fist){b.body=Math.max(4,P.pow*v.fistBodyPercent/100)}else for(let i=0;i<P.blades;i++)b.ws.push(mkW(W.type,Math.max(3,P.pow*v.powerPercent/100),Math.min(P.reach,v.maxReach),Math.min(P.spin,v.maxSpin),{ang:Math.PI+i*TAU/P.blades,dir:-1,every:v.bowFireEvery}))}},
 magnet:{tick(S,b,dt,v){const p=S.player,dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy)||1;p.vx+=dx/d*v.pull*dt;p.vy+=dy/d*v.pull*dt}},
 nullb:{disablesTopAugment:true},
 glacier:{onPlayerBounce(S,p,v){S.chill=Math.max(v.slowestPercent/100,S.chill-v.slowPercent/100)}},
 queen:{tick(S,b,dt,v){b.st=(b.st||0)+dt;if(b.st>=v.spawnEvery){b.st=0;let n=0;for(const e of S.balls)if(e.alive&&e.team===1)n++;if(n<v.maxEnemiesAlive&&b.def.spawns)spawnEnemy(S,b.def.spawns,b.x,b.y+b.r)}}},
 furnace:{onPlayerBounce(S,p,v){if(p.inv>0)return;const d=p.maxhp*v.hpPercent/100;p.hp-=d;p.flash=.1;text(S,p.x,p.y-p.r,d,'burn');if(p.hp<=0)playerDown(S)}},
 storm:{tick(S,b,dt,v){b.st=(b.st||0)+dt;if(b.st>=v.strikeEvery){b.st=0;const p=S.player;S.marks.push({x:clamp(p.x+p.vx*.5+(rnd(S.rsrc)-.5)*90,40,AW-40),y:clamp(p.y+p.vy*.5+(rnd(S.rsrc)-.5)*90,40,AH-40),r:v.radius,t:v.warning,t0:v.warning,pow:v.damage*S.ds,src:b})}}},
 eight:{tick(S,b,dt,v){if(!b.rage&&b.hp<b.maxhp*v.rageAtHpPercent/100){b.rage=1;b.spd*=v.rageSpeedPercent/100;for(const w of b.ws)w.spin*=v.rageSpinPercent/100;
   if(b.def.spawns)for(let i=0;i<v.guardCount;i++)spawnEnemy(S,b.def.spawns,b.x+(i%2?40:-40),b.y+(i>1?30:0));fx(S,{k:'ring',x:b.x,y:b.y,r:120,col:DATA.theme.page.mult})}}},
};
const BOSS={};
for(const k of dkeys(DATA.bosses)){const d=DATA.bosses[k];BOSS[k]=Object.assign(unitFromData(d),{rule:tpl(d.rule,d.values),code:BOSS_CODE[k]||{}})}
const BOSS_POOL=DATA.bossPool.slice(),FINAL_BOSS=DATA.finalBoss;

function spawnEnemy(S,id,x,y,o){
 const d=BOSS[id]||ENEMY[id],boss=!!BOSS[id];o=o||{};
 const b=mkBall({team:1,def:d,kind:id,name:d.name,col:d.col,x,y,r:o.r||d.r,hp:o.hp||(boss?d.hp*BH0*S.bhs:d.hp*S.hs),spd:o.spd||d.spd,body:o.body!=null?o.body:(d.body||0)*S.ds,armor:(d.armor||0)*S.ds,boss,gen:o.gen||0});
 d.w.forEach((w,i)=>b.ws.push(mkW(w[0],w[1]*S.ds,w[2],w[3],{ang:rnd(S.rsrc)*TAU+i*Math.PI,dir:rnd(S.rsrc)<.5?1:-1,ft:.8+rnd(S.rsrc),every:w[4]||1.9})));
 b.x=clamp(b.x,b.r+2,AW-b.r-2);b.y=clamp(b.y,b.r+2,AH-b.r-2);
 if(b.maxhp>S.refHp)S.refHp=b.maxhp;   // strongest enemy seen this fight: the yardstick for impact frames
 launch(S,b);S.balls.push(b);
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
const topEvent=S=>{const C=S.count||{};return Math.max(C.hits||0,C.bounces||0,C.crits||0,(C.collisions||0)+(C.enemyCollisions||0),C.kills||0)};
const minis=S=>S.balls.filter(b=>b.alive&&b.mini).length;
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
 twin:{stats(a,S,P,v){if(P.W.fist)P.pow+=v.fistPower;else P.blades+=v.blades}},
 centri:{onHit(a,S,c,v){const w=S.player.ws[0];if(w&&w.spin>0){c.power+=w.spin*v.power;return true}}},
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
 big:{stats(a,S,P,v){P.hp+=v.hp;P.size*=1+v.sizePercent/100}},
 spike:{onTouch(a,S,e,v){playerHit(S,e,'aoe',1,S.player.maxhp*v.hpPercent/100);return true}},
 thorn:{onHurt(a,S,x,v){if(x.att&&x.att.alive&&x.att.team===1){damage(S,x.att,x.raw*v.percent/100,'shock');return true}}},
 jugg:{stats(a,S,P,v){P.pow+=Math.floor(P.hp/v.hpPer)}},
 heavy:{onHit(a,S,c,v){c.power+=S.player.maxhp/v.hpPer;return true},live:(a,S,v)=>'+'+f1(S.player.maxhp/v.hpPer)},   // reads Max HP at the moment of the hit, so socket order does not matter
 fang:{afterHit(a,S,c,v){if(c.dealt>0){heal(S,S.player,Math.min(c.dealt*v.percent/100,S.player.maxhp*v.maxHealPercentOfMaxHpPerHit/100));return true}}},
 wind:{onLethal(a,S,x,v){if(!a.f.u&&!x.saved){a.f.u=1;x.saved=true;const p=S.player;p.hp=Math.ceil(p.maxhp*v.hpPercent/100);p.inv=v.seconds;fx(S,{k:'ring',x:p.x,y:p.y,r:90,col:DATA.theme.page.gold});return true}}},
 bers:{onHit(a,S,c,v){const p=S.player,m=1+(v.maxMult-1)*(1-p.hp/p.maxhp);if(m>1.02){c.mult*=m;return true}}},
 under:{onHit(a,S,c,v){if(enemies(S).length>1+minis(S)){c.mult*=v.mult;return true}}},
 // swarm
 mitosis:{onStart(a,S,x,v){for(let i=0;i<v.count;i++)spawnMini(S);return true}},
 brood:{onKill(a,S,e){if(minis(S)<RULES.minis.maxAlive){spawnMini(S,e.x,e.y);return true}}},
 hive:{onHit(a,S,c,v){const n=minis(S);if(n){c.mult+=v.mult*n;return true}}},
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
 /* Earthquake: a wall bounce of the player's ball at or above speedPercent of the weapon's listed speed hits every enemy. The hits go through playerHit as 'aoe', so Mult and the other augments apply. */
 quake:{onBounce(a,S,b,v){if(!b.player)return;const need=S.P.W.spd*v.speedPercent/100;
   if(Math.hypot(b.vx,b.vy)<need||S.t-(a.f.t==null?-99:a.f.t)<v.cooldown)return;
   a.f.t=S.t;const dl=b.x,dr=AW-b.x,dt=b.y,db=AH-b.y,m=Math.min(dl,dr,dt,db);   // the nearest wall is the one it just hit
   fx(S,{k:'quake',x:m===dl?0:m===dr?AW:b.x,y:m===dt?0:m===db?AH:b.y,shake:v.shake});snd(S,'boom');
   for(const e of enemies(S))playerHit(S,e,'aoe',v.percent/100);return true},
  live(a,S,v){const left=v.cooldown-(S.t-(a.f.t==null?-99:a.f.t));if(left>0)return f1(Math.ceil(left*10)/10)+'s';
   const p=S.player,sp=Math.hypot(p.vx,p.vy),need=S.P.W.spd*v.speedPercent/100;return sp>=need?DATA.text.ready:Math.round(sp)+'/'+Math.round(need)}},

 /* ---------- added 15 Nov 2026 (augment draft 1). Shared helpers: addChill, freeze, knockBy, count, inc, more (section 4 and 5). ---------- */
 // collisions and knockback
 bumper:{onTouch(a,S,e,v){a.f.p=v.power;return true},onHit(a,S,c){if(a.f.p&&c.src!=='aoe'){c.power+=a.f.p;a.f.p=0;return true}},live:a=>a.f.p?'+'+f1(a.f.p):''},
 lead:{stats(a,S,P,v){P.size*=1+v.sizePercent/100;P.armor+=v.armor}},
 heavyswing:{stats(a,S,P,v){inc(P,'knock',v.percent/100);P.pow+=v.power}},
 wallslam:{onEnemyWall(a,S,x,v){const b=x.ball;if(b.knockT==null||S.t-b.knockT>v.window)return;b.knockT=null;
   fx(S,{k:'ring',x:b.x,y:b.y,r:b.r+18,col:DATA.theme.effects.spark});snd(S,'impact');playerHit(S,b,'aoe',v.percent/100);return true}},
 chainrx:{onCollide(a,S,x,v){const p=x.a,q=x.b;if(p.team!==1||q.team!==1||x.impact<v.minImpact||S.t<(p.crT||0)||S.t<(q.crT||0))return;
   p.crT=q.crT=S.t+v.cooldown;fx(S,{k:'spark',x:(p.x+q.x)/2,y:(p.y+q.y)/2});playerHit(S,p,'aoe',v.percent/100);playerHit(S,q,'aoe',v.percent/100);return true}},
 undertow:{onTick(a,S,dt,v){const p=S.player;for(const e of enemies(S)){const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy);if(d<v.radius&&d>1){e.vx+=dx/d*v.pull*dt;e.vy+=dy/d*v.pull*dt}}}},
 breakshot:{onCollide(a,S,x,v){const p=x.a.player?x.a:x.b.player?x.b:null;if(!p)return;const e=p===x.a?x.b:x.a;if(e.team!==1)return;
   playerHit(S,e,'aoe',v.percent/100*x.impact/100);return true}},
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
 afterburner:{onBounce(a,S,b,v){if(!b.player)return;const e=nearestEnemy(S);if(e){addBurn(S,e,v.stacks);return true}}},
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
 maw:{beforeFight(a,S,i,v){const run=S.run,nb=run.augs[i+1];if(!nb||S.disabled===a)return;const d=AUG[nb.id];if(!d)return;
   const gain=COST[d.rar]*v.perGold+(nb.id==='maw'?(nb.n||0):0);a.n=(a.n||0)+gain;run.augs.splice(i+1,1);S.ate.push({id:nb.id,gain});
   fx(S,{k:'eat',by:AUG.maw.name,name:d.name,gain})},
  onHit(a,S,c){if(a.n){c.mult*=1+a.n;return true}},info:a=>tpl(DATA.text.currently,{value:'×'+f1(1+(a.n||0))+' '+DATA.text.statNames.mult})},
 // legendary
 mirror:{},   // handled inside fire(): it runs the hooks of the augment below it
 perpetual:{stats(a,S,P,v){P.rampX*=v.mult}},
 catalyst:{stats(a,S,P,v){P.cat={mult:v.mult,both:v.bothMult}}},
 mass:{preHit(a,S,c,v){S.ramp.crit+=v.percent/100;S.ramp.critOver=v.critMultPerOverflow}},
};
const RAR=DATA.rarities.map(r=>r.name),COST=DATA.rarities.map(r=>r.cost);
const AUG={};
for(const id of dkeys(DATA.augments)){const d=DATA.augments[id];
 if(!AUG_CODE[id])CORE_PROBLEMS.push('augments.'+id+' is in game-data.json but has no code in core.js (AUG_CODE). A new augment needs code as well as data.');
 AUG[id]=Object.assign({id,name:d.name,rar:Math.max(0,RAR.indexOf(d.rarity)),tags:d.tags||[],desc:tpl(d.text,d.values),v:d.values||{}},AUG_CODE[id]||{})}

const TUNE={};
for(const k of['hp','pow','spd','spin','reach','armor','crit','regen']){const d=DATA.tuneUps[k];TUNE[k]={name:d.name,desc:tpl(d.text,{amount:d.amount}),amount:d.amount}}
/* Trophy behaviour by id. Trophies are a source (section 4): they can use any hook an augment can, with the same signature, and run before
   every augment. stats(t,S,P,v) runs when the player's stats are worked out. Rule changes (weak, coupon...) are checked by id where they apply. */
const TROPHY_CODE={
 socket:{many:1},shelf:{},banker:{},coupon:{},weak:{},recycle:{},taste:{},
 engine:{stats(t,S,P,v){P.spd*=1+v.percent/100;P.spin*=1+v.percent/100}},
 hide:{stats(t,S,P,v){P.hp+=v.hp;P.armor+=v.armor}},
 edge:{stats(t,S,P,v){P.mult+=v.mult}},
 tonic:{stats(t,S,P,v){P.crit+=v.critPercent/100;P.regen+=v.regen}},
};
const TROPHY={};
for(const id of dkeys(DATA.trophies)){const d=DATA.trophies[id];
 if(!TROPHY_CODE[id])CORE_PROBLEMS.push('trophies.'+id+' is in game-data.json but has no code in core.js (TROPHY_CODE).');
 TROPHY[id]=Object.assign({id,name:d.name,desc:tpl(d.text,d.values),v:d.values||{},tags:d.tags||[]},TROPHY_CODE[id]||{})}
const has=(run,id)=>run.trophies.includes(id)&&!!TROPHY[id];

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
addSourceKind({kind:'trophy',stage:'early',list:run=>run.trophies.filter(id=>TROPHY[id]).map(id=>({def:TROPHY[id],st:srcState(run,'trophy:'+id),v:TROPHY[id].v}))});
/* The non-augment entries of a run, split by stage. Built once per fight and cached on S (trophies and the like do not change mid-fight). */
function sourceLists(run){const L={early:[],late:[]};for(const k of SOURCE_KINDS)for(const e of k.list(run))L[k.stage==='late'?'late':'early'].push(e);return L}
/* Calls one hook on every source in order. S.cur is the definition whose hook is running, so a hit it causes knows where it came from (tags, below).
   Mirror Ball borrows the hooks of the augment below it. */
function fire(S,hook,x){
 const L=S.src||(S.src=sourceLists(S.run)),prev=S.cur;
 for(const e of L.early){const fn=e.def[hook];if(fn){S.cur=e.def;fn(e.st,S,x,e.v)}}
 const augs=S.run.augs;
 for(let i=0;i<augs.length;i++){
  let a=augs[i];if(S.disabled===a)continue;
  let def=AUG[a.id];if(!def)continue;
  if(a.id==='mirror'){const nb=augs[i+1];if(!nb||nb.id==='mirror'||S.disabled===nb||!AUG[nb.id])continue;def=AUG[nb.id];if(!a.sh||a.sh.id!==nb.id)a.sh={id:nb.id,n:0,f:{}};a=a.sh}
  const fn=def[hook];if(!fn)continue;
  const rep_=i>0&&augs[i-1].id==='resonator'&&S.disabled!==augs[i-1]?2:1;   // Resonator: the augment below it triggers twice
  for(let r=0;r<rep_;r++){S.cur=def;if(fn(a,S,x,def.v)&&S.pulses){S.pulses[i]=S.t||0;if(r)S.pulses[i-1]=S.t||0}}
 }
 for(const e of L.late){const fn=e.def[hook];if(fn){S.cur=e.def;fn(e.st,S,x,e.v)}}
 S.cur=prev;
}
/* Modifier layers. Inside a stats hook, a plain change (P.pow += 4, P.spin *= 1.3) applies at once, in hook order.
   inc(P,'pow',.2) adds +20% to that stat's increases; all increases on a stat are added together. more(P,'pow',1.5) multiplies; all are multiplied.
   After every stats hook: stat = (result of the plain changes) × (1 + sum of increases) × (product of multipliers). Admin overrides and caps come last.
   The same helpers work on a hit inside preHit/onHit, for 'power' and 'mult': c.power and c.mult are adjusted after every onHit hook, before the crit. */
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
 const P={W,hp:pr.baseHp+TUNE.hp.amount*t.hp+pr.hpPerBossBeaten*(run.grown||0),pow:W.pow+TUNE.pow.amount*t.pow,mult:1,spd:W.spd*(1+TUNE.spd.amount/100*t.spd),spin:W.spin*(1+TUNE.spin.amount/100*t.spin),reach:W.reach*(1+TUNE.reach.amount/100*t.reach),size:pr.radius,armor:TUNE.armor.amount*t.armor,
  crit:pr.critChancePercent/100+TUNE.crit.amount/100*t.crit,critMult:pr.critMult,regen:TUNE.regen.amount*t.regen,blades:W.blades,bounceX:1,rampX:1,projBounce:0,projExtra:0,poisonX:1,burnX:1,burnDecay:1,cat:null,knock:1,frozenX:1,burnGrow:0};
 P.inc={};P.more={};
 fire(S||{run,disabled:null},'stats',P);   // trophies and other early sources first, then augments top to bottom
 applyLayers(P);
 // admin overrides (Admin panel in ui.js): absolute values that replace the computed stat
 if(run.override)for(const k of Object.keys(run.override)){const v=run.override[k];if(typeof v==='number'&&isFinite(v)&&typeof P[k]==='number')P[k]=v}
 P.raw={spd:P.spd,spin:P.spin,blades:P.blades};   // before the caps, for overflow
 P.over={spd:Math.max(0,P.spd-560),spin:Math.max(0,P.spin-RULES.combat.maxSpin),blades:Math.max(0,P.blades-4)};
 P.hp=Math.max(1,Math.round(P.hp));P.spin=Math.min(P.spin,RULES.combat.maxSpin);P.spd=Math.min(P.spd,560);P.blades=Math.min(P.blades,4);P.bounceX=Math.max(1,Math.round(P.bounceX));
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
  ramp:{pow:0,mult:0,spin:1,reach:0,arrows:0,hits:0,spd:0,crit:0,critOver:2},count:{},over:{spd:0,spin:0},src:null,cur:null};
 const T=run.tier,enc=run.enc;
 {const wk=has(run,'weak')?1-TROPHY.weak.v.percent/100:1,E=endlessScale(T);S.hs=Math.pow(HS,T-1)*wk*E.hp;S.bhs=Math.pow(BHS,T-1)*wk*E.hp;S.ds=Math.pow(DS,T-1)*E.dmg}
 S.refHp=IMP?(IMP.minReferenceHp||0)*S.hs:0;S.hold=false;
 if(enc.boss&&BOSS[enc.boss]&&BOSS[enc.boss].code.disablesTopAugment&&!S.preview)S.disabled=run.augs[0]||null;
 for(const a of run.augs){a.f={};if(a.sh)a.sh.f={}}
 if(run.src)for(const k in run.src)run.src[k].f={};   // per-fight state of trophies and other sources
 S.ate=[];if(!S.preview)for(let i=0;i<run.augs.length;i++){const a=run.augs[i],d=AUG[a.id];if(d&&d.beforeFight)d.beforeFight(a,S,i,d.v)}   // Maw: may remove the augment below it
 S.src=sourceLists(run);
 const P=S.P=calcPlayer(run,S),W=P.W;
 const pl=S.player=mkBall({team:0,player:true,kind:'player',x:AW*.2,y:AH/2,r:P.size,hp:P.hp,spd:P.spd,armor:P.armor,col:DATA.theme.balls.player});
 for(let i=0;i<P.blades;i++)pl.ws.push(mkW(W.type,0,P.reach,P.spin,{ang:i*TAU/P.blades,every:W.fireEvery,ft:.5+i*.35}));
 launch(S,pl);S.balls.push(pl);
 const spots=[];
 const place=r=>{for(let k=0;k<40;k++){const x=AW*.45+r+rnd(S.rsrc)*(AW*.55-2*r-6),y=r+6+rnd(S.rsrc)*(AH-2*r-12);if(spots.every(s=>Math.hypot(s[0]-x,s[1]-y)>s[2]+r+4)||k===39){spots.push([x,y,r]);return[x,y]}}};
 if(enc.boss&&BOSS[enc.boss]){const r=BOSS[enc.boss].r;spots.push([AW*.75,AH/2,r]);spawnEnemy(S,enc.boss,AW*.75,AH/2)}
 for(const id of enc.list){if(!ENEMY[id])continue;const p=place(ENEMY[id].r);spawnEnemy(S,id,p[0],p[1])}
 if(!S.preview)fire(S,'onStart',null);
 return S;
}
function spawnMini(S,x,y){
 const M=RULES.minis;if(minis(S)>=M.maxAlive){count(S,'overflowMinis');return}const p=S.player;count(S,'minis');
 const b=mkBall({team:0,mini:true,kind:'mini',x:x==null?p.x+(rnd(S.rsrc)-.5)*50:x,y:y==null?p.y+(rnd(S.rsrc)-.5)*50:y,r:M.radius,hp:S.P.hp*M.hpPercent/100,spd:M.speed,armor:S.P.armor*M.armorPercent/100,col:DATA.theme.balls.mini});
 b.x=clamp(b.x,12,AW-12);b.y=clamp(b.y,12,AH-12);launch(S,b);S.balls.push(b);
}
function shoot(S,from,ang,f,main,vol){
 const P=S.P,PR=RULES.projectiles,want=(vol||1)+P.projExtra,n=Math.min(PR.maxPerVolley,want);
 if(want>n)count(S,'overflowShots',want-n);count(S,'shots',n);
 for(let i=0;i<n;i++){const a=ang+(i-(n-1)/2)*PR.spread,c=Math.cos(a),s=Math.sin(a);
  S.projs.push({x:from.x+c*(from.r+6),y:from.y+s*(from.r+6),vx:c*PR.playerSpeed,vy:s*PR.playerSpeed,r:4,team:0,f,main,bn:P.projBounce,life:PR.lifetime,ang:a})}
 snd(S,'shot');
}
function addPoison(S,t,n){if(t.alive){t.poison+=n;count(S,'poison',n)}}
/* Chill stacks on an enemy. At ST.chillMax it is Frozen. Frozen enemies take no more Chill until they thaw. */
function addChill(S,t,n){if(!t.alive||t.team!==1||t.frozen>0||n<=0)return;t.chill=(t.chill||0)+n;count(S,'chill',n);if(t.chill>=ST.chillMax){t.chill=0;freeze(S,t,ST.freezeSeconds)}}
function freeze(S,t,secs){if(!t.alive||t.team!==1)return;const d=secs*(t.boss?ST.bossFreezePercent/100:1);if(d<=(t.frozen||0))return;
 t.frozen=d;count(S,'freezes');fx(S,{k:'ring',x:t.x,y:t.y,r:t.r+14,col:DATA.theme.effects.freeze||'#d9f4ff'});fire(S,'onFreeze',t)}
/* Your side knocks an enemy: Knockback stat applies, and the enemy is marked so a wall it hits soon after counts as a slam. */
function knockBy(S,t,fx_,fy_,kb){knock(t,fx_,fy_,kb*S.P.knock);t.knockT=S.t}
function addBurn(S,t,n){if(t.alive){t.burn+=n;count(S,'burn',n);fire(S,'onBurn',t)}}
function heal(S,b,amt,quiet){if(!b.alive||amt<=0)return;const h=Math.min(amt,b.maxhp-b.hp);if(h<=0)return;b.hp+=h;if(!quiet&&h>=1)text(S,b.x,b.y-b.r,h,'heal')}
function wave(S,x,y,r,f,col){fx(S,{k:'ring',x,y,r,col});snd(S,'boom');for(const e of enemies(S))if(Math.hypot(e.x-x,e.y-y)<r+e.r)playerHit(S,e,'aoe',f)}
function knock(t,fx_,fy_,kb){const dx=t.x-fx_,dy=t.y-fy_,d=Math.hypot(dx,dy)||1,k=kb/Math.max(.6,t.m);t.vx+=dx/d*k;t.vy+=dy/d*k}

/* Deals damage to an enemy. kind decides the colour of the number; poison and burn ignore armor. */
function damage(S,t,amt,kind){
 if(!t.alive||t.inv>0||S.done)return 0;
 if(amt!==amt)return 0;   // never let a broken number (NaN) into HP; Infinity is fine and simply kills
 if(t.frozen>0&&S.P&&S.P.frozenX!==1)amt*=S.P.frozenX;   // Glacial Core
 const status=kind==='poison'||kind==='burn';
 if(!status)amt=Math.max(1,amt-t.armor);
 // a hit worth a big share of the strongest enemy's Max HP asks the interface for an impact frame
 if(IMP&&S.juice&&!status&&t.team===1&&S.refHp>0){const pct=amt/S.refHp*100;if(pct>=IMP_MIN){S.fx.push({k:'impact',pct,x:t.x,y:t.y,dmg:amt,crit:kind==='crit'});S.hold=true}}
 t.hp-=amt;t.flash=.12;S.dmg+=amt;
 text(S,t.x,t.y-t.r,amt,kind);
 if(t.hp<=0)kill(S,t);
 return amt;
}
function kill(S,t){
 if(!t.alive)return;t.alive=false;t.hp=0;
 fx(S,{k:'burst',x:t.x,y:t.y,col:t.col,n:t.boss?30:12});snd(S,t.boss?'bossdie':'pop');
 if(t.team!==1)return;
 S.kills++;count(S,'kills');const d=t.def;
 if(d.split&&ENEMY[d.split])for(let i=0;i<d.splitN;i++)spawnEnemy(S,d.split,t.x+(i%2?10:-10),t.y+(i>1?10:0));
 if(d.bomb){fx(S,{k:'ring',x:t.x,y:t.y,r:d.bombR,col:t.col});snd(S,'boom');for(const b of S.balls)if(b.alive&&b.team===0&&Math.hypot(b.x-t.x,b.y-t.y)<d.bombR+b.r)enemyHit(S,null,b,d.bomb*S.ds)}
 if(d.code&&d.code.onDeath)d.code.onDeath(S,t,d.v);
 fire(S,'onKill',t);
}
function playerDown(S){
 const p=S.player;if(!p.alive)return;
 const x={saved:false};fire(S,'onLethal',x);
 if(!x.saved){p.alive=false;p.hp=0;S.done='lose';fx(S,{k:'burst',x:p.x,y:p.y,col:p.col,n:30});snd(S,'lose')}
}
/* An enemy source hits a ball on the player's side. */
function enemyHit(S,att,t,pow){
 if(!t.alive||t.inv>0||S.preview||S.done)return;
 const raw=pow*S.overtime,d=Math.max(1,raw*(1-RULES.combat.armorMaxReductionPercent/100),raw-t.armor);
 if(t.player)fire(S,'onHurt',{att,raw,d});
 count(S,'hurt');
 t.hp-=d;t.flash=.12;text(S,t.x,t.y-t.r,d,'hurt');snd(S,'hurt');
 if(t.hp<=0){if(t.player)playerDown(S);else{t.alive=false;fx(S,{k:'burst',x:t.x,y:t.y,col:t.col,n:8})}}
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
 fire(S,'preHit',c);
 const cc=P.crit+R.crit;
 if(!c.crit)c.crit=rnd(S.rsrc)<cc;
 fire(S,'onHit',c);
 applyLayers(c);   // % increases and multipliers that hooks added with inc() and more()
 if(c.crit){c.mult*=P.critMult+Math.max(0,cc-1)*R.critOver;count(S,'crits')}
 let dmg=c.power*c.mult*S.overtime;
 if(c.kill)dmg=Math.max(dmg,t.hp+t.armor+1);
 c.dealt=damage(S,t,dmg,c.crit?'crit':src);
 S.last={p:c.power,m:c.mult,d:c.dealt,c:c.crit,n:S.hitCount};
 if(c.dealt>S.bestHit)S.bestHit=c.dealt;
 if(S.juice&&src!=='aoe')S.freeze=c.crit?RULES.feel.critHitStop:RULES.feel.hitStop;
 snd(S,c.crit?'crit':'hit');
 if(main){const x=P.rampX,D=P.W.rampDef;R.hits++;
  if(D.power)R.pow+=D.power*x;
  if(D.mult)R.mult+=D.mult*x;
  if(D.spinPercent)R.spin=Math.min(D.maxSpinMultiplier||4,R.spin+D.spinPercent/100*x);
  if(D.reach)R.reach=Math.min(D.maxReach||220,R.reach+D.reach*x);
  if(D.hitsPerArrow)R.arrows+=x/D.hitsPerArrow}
 fire(S,'afterHit',c);
 if(c.crit)fire(S,'onCrit',c);
 return c.dealt;
}
function bounceEvent(S,b){
 S.lastBounce=S.t;const D=S.P.W.rampDef;
 for(let k=0;k<S.P.bounceX;k++){S.bounces++;count(S,'bounces');fire(S,'onBounce',b);if(D.speedPercentPerBounce&&b.player)S.ramp.spd=Math.min((D.maxSpeedBonusPercent||180)/100,S.ramp.spd+D.speedPercentPerBounce/100*S.P.rampX)}
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
  fire(S,'onTick',dt);
  if(S.boss&&S.boss.alive&&S.bossDef.code.tick)S.bossDef.code.tick(S,S.boss,dt,S.bossDef.v);
  if(P.regen>0)heal(S,pl,P.regen*dt,true);
  S.statusAcc+=dt;
  if(S.statusAcc>=.5){S.statusAcc-=.5;
   for(const e of S.balls){if(!e.alive||e.team!==1)continue;
    const cx=P.cat?(e.poison>0&&e.burn>0?P.cat.both:P.cat.mult):1;
    if(e.poison>0)damage(S,e,e.poison*.5*CB.poisonDamagePerStackPerSecond*P.poisonX*cx*S.overtime,'poison');
    if(e.alive&&e.burn>0){damage(S,e,e.burn*.5*(CB.burnDamagePerStackPerSecond+(P.pow+S.ramp.pow)*(CB.burnPowerPercentPerStack||0)/100)*P.burnX*cx*S.overtime,'burn');   // Burn: a flat part plus a share of Power
     e.burn=Math.max(0,e.burn-.5*CB.burnStacksLostPerSecond*P.burnDecay);if(P.burnGrow&&e.burn>0)e.burn*=Math.sqrt(1+P.burnGrow)}   // Inferno: Burn grows each second
    if(e.alive&&e.chill>0)e.chill=Math.max(0,e.chill-.5*ST.chillFadePerSecond)}}
  for(let i=S.marks.length-1;i>=0;i--){const m=S.marks[i];m.t-=dt;if(m.t<=0){S.marks.splice(i,1);fx(S,{k:'zap',x1:m.x,y1:0,x2:m.x,y2:m.y});fx(S,{k:'ring',x:m.x,y:m.y,r:m.r,col:m.src.col});snd(S,'zap');
   for(const b of S.balls)if(b.alive&&b.team===0&&Math.hypot(b.x-m.x,b.y-m.y)<m.r+b.r)enemyHit(S,m.src,b,m.pow)}}
  if(S.done)return;
 }
 pl.spd=Math.min(CB.maxPlayerSpeed,P.spd*(1+S.ramp.spd)*S.chill);
 S.over.spd=Math.max(0,P.raw.spd*(1+S.ramp.spd)*S.chill-CB.maxPlayerSpeed);S.over.spin=Math.max(0,P.raw.spin*S.ramp.spin*S.chill-CB.maxSpin);
 for(const w of pl.ws){w.spin=Math.min(CB.maxSpin,P.spin*S.ramp.spin*S.chill);w.len=P.reach+S.ramp.reach}
 // move
 for(const b of S.balls){
  if(!b.alive)continue;
  if(b.inv>0)b.inv-=dt;if(b.bcd>0)b.bcd-=dt;if(b.flash>0)b.flash-=dt;
  let sm=1;if(b.stun>0){b.stun-=dt;sm=.15}
  if(b.frozen>0){b.frozen-=dt;sm=0}else if(b.chill>0)sm*=Math.max(0,1-b.chill*ST.chillSlowPercent/100);   // Freeze stops the ball, Chill slows it
  b.x+=b.vx*dt*sm;b.y+=b.vy*dt*sm;
  let hit=false;
  if(b.x<b.r){b.x=b.r;b.vx=Math.abs(b.vx);hit=true}else if(b.x>AW-b.r){b.x=AW-b.r;b.vx=-Math.abs(b.vx);hit=true}
  if(b.y<b.r){b.y=b.r;b.vy=Math.abs(b.vy);hit=true}else if(b.y>AH-b.r){b.y=AH-b.r;b.vy=-Math.abs(b.vy);hit=true}
  if(hit){const j=(rnd(S.rsrc)-.5)*CB.wallBounceJitter,c=Math.cos(j),s=Math.sin(j),vx=b.vx*c-b.vy*s,vy=b.vx*s+b.vy*c;
   // keep heading into the arena after the nudge
   b.vx=(b.x<=b.r)?Math.abs(vx):(b.x>=AW-b.r)?-Math.abs(vx):vx;b.vy=(b.y<=b.r)?Math.abs(vy):(b.y>=AH-b.r)?-Math.abs(vy):vy;
   if(b.player){snd(S,'wall');if(live){count(S,'wallHits');bounceEvent(S,b)}if(S.done)return}
   else if(live&&b.team===1){count(S,'enemyWallHits');fire(S,'onEnemyWall',{ball:b,speed:Math.hypot(b.vx,b.vy)});if(S.done)return}}
  const sp=Math.hypot(b.vx,b.vy);
  if(sp<5){if(!(b.frozen>0))launch(S,b)}else{const ns=sp+(b.spd-sp)*Math.min(1,4*dt);b.vx*=ns/sp;b.vy*=ns/sp}
  if(b.aim&&b.stun<=0&&!(b.frozen>0)){const tg=nearestFoe(S,b);if(tg){let d=Math.atan2(tg.y-b.y,tg.x-b.x)-Math.atan2(b.vy,b.vx);d=Math.atan2(Math.sin(d),Math.cos(d));const q=clamp(d,-b.aim*dt,b.aim*dt),c=Math.cos(q),s=Math.sin(q),vx=b.vx*c-b.vy*s;b.vy=b.vx*s+b.vy*c;b.vx=vx}}
  for(const w of b.ws){
   if(w.cd>0)w.cd-=dt;if(w.pcd>0)w.pcd-=dt;
   if(w.type==='bow'){
    const tg=nearestFoe(S,b);
    if(tg){let d=Math.atan2(tg.y-b.y,tg.x-b.x)-w.ang;d=Math.atan2(Math.sin(d),Math.cos(d));const mx=Math.max(1.5,w.spin)*1.6*dt*sm;w.ang+=clamp(d,-mx,mx)}
    if(live&&!(b.frozen>0)){w.ft-=dt;if(w.ft<=0){w.ft=w.every;
     if(b.team===0)shoot(S,b,w.ang,1,true,1+Math.floor(S.ramp.arrows));
     else{const c=Math.cos(w.ang),s=Math.sin(w.ang),PR=RULES.projectiles;S.projs.push({x:b.x+c*(b.r+6),y:b.y+s*(b.r+6),vx:c*PR.enemySpeed,vy:s*PR.enemySpeed,r:5,team:1,pow:w.pow,owner:b,bn:0,life:PR.lifetime,ang:w.ang});snd(S,'shot')}}}
   }else w.ang+=w.spin*w.dir*dt*sm;
  }
  if(live&&b.def&&b.def.heal&&b.alive){let m=null;for(const o of S.balls)if(o.alive&&o.team===1&&o!==b&&o.hp<o.maxhp&&(!m||o.hp/o.maxhp<m.hp/m.maxhp))m=o;if(m){heal(S,m,b.def.heal*S.hs*dt,true);b.healT=m}else b.healT=null}
 }
 // ball vs ball
 const B=S.balls,n=B.length;
 for(let i=0;i<n;i++){const a=B[i];if(!a.alive)continue;
  for(let j=i+1;j<n;j++){const b=B[j];if(!b.alive||!a.alive)continue;
   const dx=b.x-a.x,dy=b.y-a.y,min=a.r+b.r,d2=dx*dx+dy*dy;if(d2>=min*min||d2===0)continue;
   const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,ov=min-d,tm=a.m+b.m;
   a.x-=nx*ov*b.m/tm;a.y-=ny*ov*b.m/tm;b.x+=nx*ov*a.m/tm;b.y+=ny*ov*a.m/tm;
   const vn=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
   if(vn>0){const imp=2*vn/tm;a.vx-=imp*b.m*nx;a.vy-=imp*b.m*ny;b.vx+=imp*a.m*nx;b.vy+=imp*a.m*ny;if(a.player||b.player)snd(S,'clack')
    if(live&&(a.team===1||b.team===1)){count(S,a.team===b.team?'enemyCollisions':'collisions');fire(S,'onCollide',{a,b,impact:vn});if(S.done)return}}
   if(live&&a.team!==b.team){
    const p=a.team===0?a:b,e=a.team===0?b:a;
    if(p.bcd<=0){p.bcd=CB.bodyHitCooldown;if(p.player){if(P.W.fist)playerHit(S,e,'body',1,null,true);fire(S,'onTouch',e)}else playerHit(S,e,'mini',RULES.minis.powerPercent/100)}
    if(e.alive&&p.alive&&e.body>0&&e.bcd<=0&&!(e.frozen>0)){e.bcd=CB.enemyBodyHitCooldown;enemyHit(S,e,p,e.body)}
    if(S.done)return;
   }}}
 // weapons
 const segs=[];
 for(const b of S.balls)if(b.alive)for(const w of b.ws)segs.push({b,w,s:seg(b,w)});
 if(live)for(const A_ of segs){const w=A_.w,b=A_.b;
  if(w.type==='shield'||w.type==='bow'||w.cd>0||!b.alive||b.frozen>0)continue;
  for(const t of S.balls){if(!t.alive||t.team===b.team)continue;
   if(dSegPt(A_.s,t.x,t.y)<t.r+w.th){
    w.cd=w.cdMax;if(b.team===0)knockBy(S,t,b.x,b.y,w.kb);else knock(t,b.x,b.y,w.kb);if(w.stun)t.stun=t.boss?w.stun*.4:w.stun;
    if(b.team===0)playerHit(S,t,'weapon',1,null,true);else enemyHit(S,b,t,w.pow);
    if(S.done)return;break}}}
 for(let i=0;i<segs.length;i++){const a=segs[i];if(a.w.pcd>0||!a.b.alive)continue;
  for(let j=i+1;j<segs.length;j++){const b=segs[j];if(b.b.team===a.b.team||b.w.pcd>0||!b.b.alive)continue;
   if(segX(a.s,b.s)){a.w.dir*=-1;b.w.dir*=-1;a.w.pcd=b.w.pcd=CB.parryCooldown;if(live&&(a.b.team===0||b.b.team===0))count(S,'parries');
    fx(S,{k:'spark',x:(a.s[2]+b.s[2])/2,y:(a.s[3]+b.s[3])/2});snd(S,'parry');
    if(live){const pw=a.b.team===0?a:b,ew=a.b.team===0?b:a;if(pw.b.player)fire(S,'onParry',ew.b)}
    break}}}
 // projectiles
 for(const p of S.projs){
  if(p.dead)continue;p.life-=dt;if(p.life<=0){p.dead=true;continue}
  p.x+=p.vx*dt;p.y+=p.vy*dt;
  let out=false;
  if(p.x<p.r||p.x>AW-p.r){out=true;if(p.bn>0){p.vx=-p.vx;p.x=clamp(p.x,p.r,AW-p.r)}}
  if(p.y<p.r||p.y>AH-p.r){out=true;if(p.bn>0){p.vy=-p.vy;p.y=clamp(p.y,p.r,AH-p.r)}}
  if(out){if(p.bn>0){p.bn--;p.ang=Math.atan2(p.vy,p.vx);if(p.team===0&&P.projBounce>0)bounceEvent(S,p)}else{p.dead=true;continue}}
  for(const sg of segs)if(sg.b.alive&&sg.b.team!==p.team&&dSegPt(sg.s,p.x,p.y)<p.r+sg.w.th+1){p.dead=true;fx(S,{k:'spark',x:p.x,y:p.y});snd(S,'parry');break}
  if(p.dead)continue;
  for(const t of S.balls){if(!t.alive||t.team===p.team)continue;
   if(Math.hypot(t.x-p.x,t.y-p.y)<t.r+p.r){p.dead=true;if(p.team===0)playerHit(S,t,'proj',p.f,null,p.main);else enemyHit(S,p.owner,t,p.pow);break}}
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
 const run={seed,rs:seed|0,weapon,tier:1,stage:0,gold:RN.startGold,augs:[],slots:RN.startSlots,shelf:0,intCap:RULES.economy.interestCap,tune:{hp:0,pow:0,spd:0,spin:0,reach:0,armor:0,crit:0,regen:0},trophies:[],bosses:[],
  shop:null,enc:null,pending:null,endless:false,grown:0,stats:{fights:0,kills:0,bestHit:0,dmg:0}};
 const pool=BOSS_POOL.slice();for(let i=pool.length-1;i>0;i--){const j=rnd(run)*(i+1)|0;[pool[i],pool[j]]=[pool[j],pool[i]]}
 const need=RN.tiersToWin-1;run.bosses=[];for(let i=0;i<need;i++)run.bosses.push(pool[i%pool.length]);run.bosses.push(FINAL_BOSS);
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
 return{list};
}
function augCost(run,id){return Math.max(1,COST[AUG[id].rar]-(has(run,'coupon')?TROPHY.coupon.v.discount:0))}
function sellValue(run,id){const c=COST[AUG[id].rar];return has(run,'recycle')?c:Math.floor(c*RULES.economy.sellPercent/100)}
function tuneCost(run,k){return RULES.economy.tuneUpBaseCost+RULES.economy.tuneUpCostStep*run.tune[k]}
function rollShop(run,keepReroll){
 const n=RULES.run.shopAugments+run.shelf,owned=new Set(run.augs.map(a=>a.id)),offers=[],ids=Object.keys(AUG);
 const w=DATA.rarities.map(r=>r.shopWeight+r.shopWeightPerTier*run.tier);if(has(run,'taste'))for(let i=2;i<w.length;i++)w[i]*=TROPHY.taste.v.mult;   // Rare Taste: the third rarity (Rare) and every rarity above it
 let tot=0;for(const x of w)tot+=x;
 for(let i=0;i<n;i++){let x=rnd(run)*tot,r=0;while(r<w.length-1&&x>=w[r]){x-=w[r];r++}
  let c=ids.filter(k=>AUG[k].rar===r&&!owned.has(k)&&!offers.some(o=>o.id===k));
  if(!c.length)c=ids.filter(k=>!owned.has(k)&&!offers.some(o=>o.id===k));
  if(c.length)offers.push({id:pick(run,c),sold:false})}
 const tk=Object.keys(TUNE),tunes=[],nt=Math.min(tk.length,RULES.run.shopTuneUps);while(tunes.length<nt){const k=pick(run,tk);if(!tunes.some(t=>t.k===k))tunes.push({k,sold:false})}
 const base=has(run,'coupon')?TROPHY.coupon.v.rerollBase:RULES.economy.rerollBaseCost;
 run.shop={offers,tunes,reroll:keepReroll?run.shop.reroll+RULES.economy.rerollCostStep:base};
}
function buyOffer(run,i){const o=run.shop.offers[i];if(!o||o.sold||run.augs.length>=run.slots)return false;const c=augCost(run,o.id);if(run.gold<c)return false;run.gold-=c;o.sold=true;run.augs.push({id:o.id,n:0,f:{}});return true}
function buyTune(run,i){const t=run.shop.tunes[i];if(!t||t.sold)return false;const c=tuneCost(run,t.k);if(run.gold<c)return false;run.gold-=c;t.sold=true;run.tune[t.k]++;return true}
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
 fire(S,'onWin',lines);
 const int=Math.min(run.intCap,Math.floor(run.gold/E.interestPerGold));if(int)lines.push([tpl(TX.payInterest,{gold:run.gold}),int]);
 let total=0;for(const l of lines)total+=l[1];run.gold+=total;
 const s=run.stats;s.fights++;s.kills+=S.kills;s.dmg+=S.dmg;if(S.bestHit>s.bestHit)s.bestHit=S.bestHit;
 const rc=run.count||(run.count={});for(const k in S.count)rc[k]=(rc[k]||0)+S.count[k];   // run-long counters
 return{lines,total};
}
/* Moves the run to the next fight. After a boss it also queues three trophies to pick from. */
function advance(run){
 if(run.stage===2){
  const have=new Set(run.trophies),opts=Object.keys(TROPHY).filter(k=>TROPHY[k].many?run.slots<RULES.run.maxSlots:!have.has(k)),p=[];
  while(p.length<3&&opts.length){const k=opts.splice(rnd(run)*opts.length|0,1)[0];p.push(k)}
  run.pending=p.length?p:null;run.tier++;run.stage=0;run.grown=(run.grown||0)+1;if(!run.bosses[run.tier-1])run.bosses[run.tier-1]=pick(run,BOSS_POOL.concat(FINAL_BOSS));
 }else run.stage++;
 if(run.plan&&run.planTier===run.tier)run.enc=run.plan[run.stage];else planTier(run);
 rollShop(run);
}
function pickTrophy(run,id){
 if(!run.pending||!run.pending.includes(id))return false;
 run.trophies.push(id);run.pending=null;
 if(id==='socket')run.slots++;if(id==='shelf'){run.shelf++;const r=run.shop.reroll;rollShop(run);run.shop.reroll=r}if(id==='banker')run.intCap=TROPHY.banker.v.cap;if(id==='coupon')run.shop.reroll=Math.min(run.shop.reroll,TROPHY.coupon.v.rerollBase);
 return true;
}

const CORE={DATA,RULES,AW,AH,TAU,WEAPONS,ENEMY,BOSS,AUG,TUNE,TROPHY,RAR,COST,CORE_PROBLEMS,tpl,rnd,newRun,newFight,step,calcPlayer,genEnc,planTier,encAt,endlessScale,short,addSourceKind,addChill,freeze,srcState,sourceLists,fire,inc,more,hasTag,count,rollShop,buyOffer,buyTune,reroll,sellAug,moveAug,moveAugTo,payout,advance,pickTrophy,augCost,sellValue,tuneCost,bossFor,seg,enemies,minis};
if(typeof module!=='undefined')module.exports=CORE;
