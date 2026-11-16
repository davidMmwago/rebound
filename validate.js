'use strict';
/* Rebound: checks game-data.json before the game uses it.
   validateGameData(data) returns a list of plain-English problems. An empty list means the file is usable.
   This file knows nothing about the game code; it only checks the shape of the data. */
function validateGameData(D){
 const out=[];
 const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const isNum=v=>typeof v==='number'&&isFinite(v);
 const isStr=v=>typeof v==='string';
 const show=v=>v===undefined?'nothing':JSON.stringify(v);
 const keys=o=>Object.keys(o).filter(k=>k[0]!=='_');
 const num=(o,k,path)=>{if(!isNum(o[k]))out.push(path+'.'+k+' must be a number (found '+show(o[k])+')')};
 const str=(o,k,path)=>{if(!isStr(o[k])||!o[k])out.push(path+'.'+k+' must be text in quotes (found '+show(o[k])+')')};
 const GLOBALS=['miniPower','miniMax','poisonDps','burnDps','critMult','armorCap','chillSlow','chillMax','freezeSeconds','burnPower'];
 const holes=(text,vals,path,extra)=>{if(!isStr(text))return;(text.match(/\{(\w+)\}/g)||[]).forEach(m=>{const k=m.slice(1,-1);
  if(!(vals&&k in vals)&&!GLOBALS.includes(k)&&!(extra||[]).includes(k))out.push(path+' uses the placeholder '+m+' but there is no "'+k+'" in its values')})};

 if(!isObj(D)){return['The file must be one JSON object: it should start with { and end with }']}
 for(const s of['rules','weaponTypes','weapons','augments','tuneUps','trophies','enemies','bosses','text','theme','assets'])if(!isObj(D[s]))out.push('The "'+s+'" section is missing or is not an object');
 if(!Array.isArray(D.rarities)||!D.rarities.length)out.push('"rarities" must be a list with at least one rarity');
 if(!Array.isArray(D.bossPool))out.push('"bossPool" must be a list of boss ids');
 if(out.length)return out;

 // rules
 const R=D.rules,need={arena:['size'],run:['tiersToWin','startGold','startSlots','maxSlots','shopAugments','shopTuneUps'],
  player:['baseHp','radius','critChancePercent','critMult','hpPerBossBeaten'],
  economy:['payoutFight1','payoutFight2','payoutBoss','hpBonusHighAtPercent','hpBonusHighGold','hpBonusLowAtPercent','hpBonusLowGold','interestPerGold','interestCap','rerollBaseCost','rerollCostStep','sellPercent','tuneUpBaseCost','tuneUpCostStep'],
  scaling:['enemyHpPerTier','enemyDamagePerTier','bossHpPerTier','bossHpFactor','fight1BudgetBase','fight1BudgetPerTier','fight2BudgetBase','fight2BudgetPerTier','bossAddsBudgetPerTier','bossAddsStartTier','bossAddsMax','maxEnemiesPerFight'],
  combat:['overtimeStartsAt','overtimePercentPerSecond','timeLimit','armorMaxReductionPercent','homing','poisonDamagePerStackPerSecond','burnDamagePerStackPerSecond','burnStacksLostPerSecond','maxSpin','maxPlayerSpeed','wallBounceJitter','bodyHitCooldown','enemyBodyHitCooldown','parryCooldown'],
  minis:['powerPercent','hpPercent','armorPercent','radius','speed'],
  projectiles:['playerSpeed','enemySpeed','spread','maxPerVolley','lifetime'],
  feel:['hitStop','critHitStop','shakePerHitTaken','maxShake']};
 for(const g in need){if(!isObj(R[g])){out.push('rules.'+g+' is missing');continue}for(const k of need[g])num(R[g],k,'rules.'+g)}
 if(isObj(R.arena)&&isNum(R.arena.size)&&R.arena.size<200)out.push('rules.arena.size is too small; keep it at 200 or more');
 if(isObj(R.run)&&isNum(R.run.tiersToWin)&&R.run.tiersToWin<1)out.push('rules.run.tiersToWin must be at least 1');
 if('knockback' in R){if(!isObj(R.knockback))out.push('rules.knockback must be an object in { }');else for(const k of keys(R.knockback))num(R.knockback,k,'rules.knockback')}
 if('overflow' in R){if(!isObj(R.overflow))out.push('rules.overflow must be an object in { }');else for(const k of keys(R.overflow))num(R.overflow,k,'rules.overflow')}
 if('bow' in R){if(!isObj(R.bow))out.push('rules.bow must be an object');else for(const k of keys(R.bow))num(R.bow,k,'rules.bow')}
 if('elites' in R){if(!isObj(R.elites))out.push('rules.elites must be an object in { }');else for(const k of keys(R.elites))num(R.elites,k,'rules.elites')}
 if(isObj(R.scaling))for(const k of['endlessHpPerTier','endlessDamagePerTier','endlessAcceleration','lateFromTier','lateHpPerTier','lateDamagePerTier','firstBossHpPercent'])if(k in R.scaling)num(R.scaling,k,'rules.scaling');
 if(isObj(R.economy)&&isNum(R.economy.interestPerGold)&&R.economy.interestPerGold<=0)out.push('rules.economy.interestPerGold must be more than 0');

 // rarities
 const rarNames=[];
 D.rarities.forEach((r,i)=>{const p='rarities['+i+']';if(!isObj(r)){out.push(p+' must be an object');return}str(r,'name',p);num(r,'cost',p);num(r,'shopWeight',p);num(r,'shopWeightPerTier',p);str(r,'color',p);rarNames.push(r.name);
  const hex=v=>isStr(v)&&/^#[0-9a-fA-F]{6}$/.test(v);
  if(isStr(r.color)&&!hex(r.color))out.push(p+'.color must be a 6-digit hex color like "#ff8a3d" (found '+show(r.color)+')');
  if('metal' in r&&!(Array.isArray(r.metal)&&r.metal.length===3&&r.metal.every(hex)))out.push(p+'.metal must be a list of exactly 3 hex colors: highlight, main tone, shadow')});

 // weapon types
 const wt=keys(D.weaponTypes);
 for(const k of wt){const p='weaponTypes.'+k,o=D.weaponTypes[k];if(!isObj(o)){out.push(p+' must be an object');continue}for(const f of['hitCooldown','knockback','thickness','stun'])num(o,f,p)}
 const checkWeaponList=(list,path)=>{if(list===undefined)return;if(!Array.isArray(list)){out.push(path+'.weapons must be a list in [ ]');return}
  list.forEach((w,i)=>{const p=path+'.weapons['+i+']';if(!isObj(w)){out.push(p+' must be an object');return}
   if(!wt.includes(w.type))out.push(p+'.type is '+show(w.type)+' but must be one of: '+wt.join(', '));for(const f of['power','reach','spin'])num(w,f,p);if('fireEvery' in w)num(w,'fireEvery',p)})};

 // weapons
 if(!keys(D.weapons).length)out.push('"weapons" needs at least one weapon');
 for(const k of keys(D.weapons)){const p='weapons.'+k,o=D.weapons[k];if(!isObj(o)){out.push(p+' must be an object');continue}
  str(o,'name',p);str(o,'blurb',p);str(o,'rampText',p);for(const f of['power','reach','spin','speed','blades'])num(o,f,p);for(const f of['knockback','impact'])if(f in o)num(o,f,p);
  if(!o.fists&&!wt.includes(o.type))out.push(p+'.type is '+show(o.type)+' but must be one of: '+wt.join(', ')+' (or set "fists": true)');
  if(!isObj(o.ramp))out.push(p+'.ramp must be an object');else{for(const f of keys(o.ramp))num(o.ramp,f,p+'.ramp');holes(o.rampText,o.ramp,p+'.rampText')}}

 // augments
 for(const k of keys(D.augments)){const p='augments.'+k,o=D.augments[k];if(!isObj(o)){out.push(p+' must be an object');continue}
  str(o,'name',p);str(o,'text',p);
  if(!rarNames.includes(o.rarity))out.push(p+'.rarity is '+show(o.rarity)+' but must be one of: '+rarNames.join(', '));
  if(!Array.isArray(o.tags))out.push(p+'.tags must be a list in [ ]');if('needs' in o&&o.needs!=='blade')out.push(p+'.needs can only be "blade"');
  if(!isObj(o.values))out.push(p+'.values must be an object in { } (use {} if it has no numbers)');else{for(const f of keys(o.values))num(o.values,f,p+'.values');holes(o.text,o.values,p+'.text')}}

 // tune-ups
 for(const k of['hp','pow','spd','spin','reach','armor','crit','regen','knock','impact','mini']){const p='tuneUps.'+k,o=D.tuneUps[k];if(!isObj(o)){out.push(p+' is missing. The eleven tune-up ids are fixed: hp, pow, spd, spin, reach, armor, crit, regen, knock, impact, mini');continue}if('weight' in o)num(o,'weight',p);if('needs' in o&&o.needs!=='blade')out.push(p+'.needs can only be "blade"');
  str(o,'name',p);str(o,'text',p);num(o,'amount',p);holes(o.text,{amount:1},p+'.text')}

 // consumables (optional)
 if('consumables' in D){if(!isObj(D.consumables))out.push('"consumables" must be an object');else for(const k of keys(D.consumables)){const p='consumables.'+k,o=D.consumables[k];if(!isObj(o)){out.push(p+' must be an object');continue}
  str(o,'name',p);str(o,'text',p);num(o,'cost',p);if(!isObj(o.values))out.push(p+'.values must be an object in { }');else{for(const f of keys(o.values))num(o.values,f,p+'.values');holes(o.text,o.values,p+'.text')}}}
 if('consumables' in R){if(!isObj(R.consumables))out.push('rules.consumables must be an object');else for(const k of keys(R.consumables))num(R.consumables,k,'rules.consumables')}
 // trophies
 for(const k of keys(D.trophies)){const p='trophies.'+k,o=D.trophies[k];if(!isObj(o)){out.push(p+' must be an object');continue}if('weight' in o)num(o,'weight',p);
  str(o,'name',p);str(o,'text',p);if(!isObj(o.values))out.push(p+'.values must be an object in { }');else{for(const f of keys(o.values))num(o.values,f,p+'.values');holes(o.text,o.values,p+'.text')}}

 // enemies and bosses
 const en=keys(D.enemies),bo=keys(D.bosses);
 if(!en.length)out.push('"enemies" needs at least one enemy');
 if(!en.some(k=>isObj(D.enemies[k])&&D.enemies[k].minTier<=1))out.push('At least one enemy needs "minTier": 1, or the first fight has nothing to spawn');
 const body=(o,p)=>{str(o,'name',p);for(const f of['hp','radius','speed','bodyDamage','armor'])num(o,f,p);str(o,'color',p);
  if(isStr(o.color)&&!/^#[0-9a-fA-F]{6}$/.test(o.color))out.push(p+'.color must be a 6-digit hex color like "#ff8a3d" (found '+show(o.color)+')');
  checkWeaponList(o.weapons,p);if(isNum(o.hp)&&o.hp<=0)out.push(p+'.hp must be more than 0');if(isNum(o.radius)&&o.radius<4)out.push(p+'.radius must be at least 4')};
 for(const k of en){const p='enemies.'+k,o=D.enemies[k];if(!isObj(o)){out.push(p+' must be an object');continue}
  body(o,p);num(o,'cost',p);num(o,'minTier',p);if(isNum(o.cost)&&o.cost<=0)out.push(p+'.cost must be more than 0');
  if('splitsInto' in o&&!en.includes(o.splitsInto))out.push(p+'.splitsInto is '+show(o.splitsInto)+' but that is not an enemy id');
  for(const f of['bombDamage','bombRadius','splitCount','healPerSecond'])if(f in o)num(o,f,p);if('values' in o){if(!isObj(o.values))out.push(p+'.values must be an object in { }');else for(const f of keys(o.values))num(o.values,f,p+'.values')}if('about' in o&&!isStr(o.about))out.push(p+'.about must be text in quotes')}
 for(const k of bo){const p='bosses.'+k,o=D.bosses[k];if(!isObj(o)){out.push(p+' must be an object');continue}
  body(o,p);str(o,'rule',p);if('minTier' in o)num(o,'minTier',p);if('phase2' in o){if(!isStr(o.phase2))out.push(p+'.phase2 must be text in quotes');else holes(o.phase2,o.values,p+'.phase2')}for(const f of['weak','resists'])if(f in o&&!(Array.isArray(o[f])&&o[f].every(isStr)))out.push(p+'.'+f+' must be a list of words in quotes');if(!isObj(o.values))out.push(p+'.values must be an object in { }');else{for(const f of keys(o.values))num(o.values,f,p+'.values');holes(o.rule,o.values,p+'.rule')}
  if('spawns' in o&&!en.includes(o.spawns))out.push(p+'.spawns is '+show(o.spawns)+' but that is not an enemy id')}
 D.bossPool.forEach(id=>{if(!bo.includes(id))out.push('bossPool lists '+show(id)+' but there is no boss with that id')});
 if(!D.bossPool.length)out.push('bossPool needs at least one boss id');
 if(!bo.includes(D.finalBoss))out.push('finalBoss is '+show(D.finalBoss)+' but there is no boss with that id');
 if(isObj(R.scaling)){const a=R.scaling.bossAddTypes;if(!Array.isArray(a)||!a.length)out.push('rules.scaling.bossAddTypes must be a list of enemy ids');else a.forEach(id=>{if(!en.includes(id))out.push('rules.scaling.bossAddTypes lists '+show(id)+' but that is not an enemy id')})}

 // text
 const T=D.text;
 for(const k of['logoFirst','heroHeadline','fightButton','shopTitle','augmentsTitle','yourBall','payoutTitle','overTitle','overTitleBoss','victoryTitle','newRun','keepGoing'])str(T,k,'text');
 for(const k of['logoSecond','heroBody'])if(k in T&&!isStr(T[k]))out.push('text.'+k+' must be text in quotes (it can be empty: "")');
 if(!Array.isArray(T.stageNames)||T.stageNames.length!==3)out.push('text.stageNames must be a list of exactly 3 names');
 if(!isObj(T.statNames))out.push('text.statNames must be an object');
 for(const k of['currently','noBlade','chilled','arrows','charge','ready'])str(T,k,'text');
 // keywords glossary (optional)
 if('keywords' in D){if(!isObj(D.keywords))out.push('"keywords" must be an object');else for(const k of keys(D.keywords)){if(!isStr(D.keywords[k]))out.push('keywords.'+k+' must be text in quotes');else holes(D.keywords[k],null,'keywords.'+k)}}

 // theme
 const Th=D.theme;
 for(const g of['fonts','page','arena','balls','weapons','projectiles','damageText','effects'])if(!isObj(Th[g]))out.push('theme.'+g+' is missing');
 if(isObj(Th.fonts)){str(Th.fonts,'display','theme.fonts');str(Th.fonts,'body','theme.fonts');for(const k of['displayScale','displaySize','bodySize'])if(k in Th.fonts)num(Th.fonts,k,'theme.fonts')}
 if('keywordColors' in Th){if(!isObj(Th.keywordColors))out.push('theme.keywordColors must be an object');else for(const k of keys(Th.keywordColors))if(!/^#[0-9a-fA-F]{6}$/.test(Th.keywordColors[k]))out.push('theme.keywordColors.'+k+' must be a 6-digit hex color like "#ff8a3d"')}

 // impact frames (optional section)
 if('impact' in D){const I=D.impact;if(!isObj(I))out.push('"impact" must be an object');else{
  for(const k of['minSecondsBetween','maxSpeed','minReferenceHp'])if(k in I)num(I,k,'impact');
  const st=isObj(I.styles)?I.styles:{};if(!isObj(I.styles))out.push('impact.styles must be an object');
  for(const k of keys(st)){const p='impact.styles.'+k,s=st[k];if(!isObj(s)||!Array.isArray(s.frames)||!s.frames.length){out.push(p+' needs a "frames" list with at least one frame');continue}
   s.frames.forEach((f,i)=>{const q=p+'.frames['+i+']';if(!isObj(f)){out.push(q+' must be an object');return}num(f,'ms',q);for(const n of['zoom','shake','overlayOpacity'])if(n in f)num(f,n,q);for(const n of['filter','overlay'])if(n in f&&!isStr(f[n]))out.push(q+'.'+n+' must be text in quotes')})}
  if(!Array.isArray(I.levels))out.push('impact.levels must be a list');else I.levels.forEach((l,i)=>{const p='impact.levels['+i+']';if(!isObj(l)){out.push(p+' must be an object');return}
   num(l,'minPercentOfMaxHp',p);num(l,'freeze',p);if(isNum(l.freeze)&&l.freeze>1)out.push(p+'.freeze is in seconds; keep it at 1 or less');if('shake' in l)num(l,'shake',p);
   if(!(l.style in st))out.push(p+'.style is '+show(l.style)+' but must be one of: '+keys(st).join(', '))})}}

 // assets
 const A=D.assets,slot=(v,p)=>{if(v===null||v===undefined)return;if(isStr(v)){if(/^(https?:)?\/\//.test(v))out.push(p+' points at another website ('+v+'). Assets must be files inside this artifact, like "assets/name.png"');return}
  out.push(p+' must be null or a file path in quotes (found '+show(v)+')')};
 const walk=(o,p)=>{for(const k of keys(o)){if(isObj(o[k]))walk(o[k],p+'.'+k);else slot(o[k],p+'.'+k)}};
 for(const g of['images','sounds','music'])if(!isObj(A[g]))out.push('assets.'+g+' is missing');else walk(A[g],'assets.'+g);
 if(!isObj(A.options))out.push('assets.options is missing');
 if(A.fonts!==undefined){if(!isObj(A.fonts))out.push('assets.fonts must be an object in { }');else walk(A.fonts,'assets.fonts')}
 if(A.cardFrameLayout!==undefined){if(!isObj(A.cardFrameLayout))out.push('assets.cardFrameLayout must be an object in { }');else for(const k of keys(A.cardFrameLayout))num(A.cardFrameLayout,k,'assets.cardFrameLayout')}
 return out;
}
if(typeof module!=='undefined')module.exports={validateGameData};
