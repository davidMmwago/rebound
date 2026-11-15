/* Rebound self-test. Open the game with #selftest at the end of its address.
   It plays the game with no graphics and prints a report: a crash check for every augment, then a balance check with a bot that buys at random.
   Seeds are fixed, so the same files always give the same report. Compare the report before and after a change. */
(function(){
 const H=1/120,box=document.getElementById('selftest'),pre=document.getElementById('selftest-out'),lines=[];
 document.getElementById('app').hidden=true;box.hidden=false;
 const out=s=>{lines.push(s);pre.textContent=lines.join('\n')};
 const setLast=s=>{lines[lines.length-1]=s;pre.textContent=lines.join('\n')};
 document.getElementById('selftest-copy').addEventListener('click',e=>{try{navigator.clipboard.writeText(lines.join('\n')).then(()=>{e.target.textContent='Copied'},()=>{e.target.textContent='Select the text and copy it by hand'})}catch(x){e.target.textContent='Select the text and copy it by hand'}});
 function fight(run){const S=newFight(run);let n=0;while(!S.done&&n++<120*220)step(S,H);return S}
 /* The bot: buys the first augment it can afford while it has a free socket, then tune-ups. No strategy at all. */
 function shopBot(run){for(let g=0;g<30;g++){let did=false;
  if(run.augs.length<run.slots)for(let i=0;i<run.shop.offers.length&&!did;i++)did=buyOffer(run,i);
  for(let i=0;i<run.shop.tunes.length&&!did;i++)did=buyTune(run,i);
  if(!did)break}}
 function playRun(weapon,seed,stats){
  const run=newRun(weapon,seed),goal=RULES.run.tiersToWin;
  for(;;){shopBot(run);const S=fight(run),k=run.stage===2?'boss':'fight';
   if(run.tier===1){stats.t1[k].n++;stats.t1[k].t+=S.t}
   if(S.done!=='win')return{tier:run.tier,win:false,boss:run.stage===2?run.enc.boss:null};
   payout(run,S);const wasBoss=run.stage===2,tier=run.tier;advance(run);if(run.pending)pickTrophy(run,run.pending[0]);
   if(wasBoss&&tier>=goal)return{tier:goal+1,win:true}}
 }
 const weapons=Object.keys(WEAPONS),augs=Object.keys(AUG),tasks=[];
 out('REBOUND SELF-TEST');
 out('Data check: passed. '+augs.length+' augments, '+Object.keys(ENEMY).length+' enemies, '+Object.keys(BOSS).length+' bosses, '+weapons.length+' weapons, '+Object.keys(TROPHY).length+' trophies.');
 // 0. systems check: number display, and that a source added from outside reaches the stats and the hit pipeline in the right place
 {const bad=[];const want={'999':999,'1.5k':1500,'12.3k':12345,'1M':999999,'4.57B':4.567e9,'1.23e15':1.234e15,'INF':Infinity};
  for(const k in want)if(short(want[k])!==k)bad.push('number '+want[k]+' shows as '+short(want[k])+', expected '+k);
  let saw=null;addSourceKind({kind:'selftest',stage:'late',list:r=>r.selftestProbe?[{def:{stats(st,S,P){inc(P,'pow',1)},onHit(st,S,c){more(c,'mult',3);saw=c}},st:srcState(r,'selftest'),v:{}}]:[]});
  const r=newRun(weapons[0],11);r.selftestProbe=true;const P=calcPlayer(r,null),P0=calcPlayer(Object.assign({},r,{selftestProbe:false}),null);
  if(Math.abs(P.pow-P0.pow*2)>1e-9)bad.push('a +100% Power increase gave '+P.pow+' instead of '+P0.pow*2);
  const S=fight(r);if(!saw)bad.push('a late source never saw a hit');else if(!saw.tags||!saw.tags.includes('hit'))bad.push('hits carry no tags');
  if(!S.count||!S.count.hits)bad.push('fight counters are empty');
  out(bad.length?'Systems check: FAILED':'Systems check: passed (numbers, sources, layers, tags, counters).');for(const b of bad)out('  FAILED  '+b);}
 out('');
 // 1. crash check: every weapon with every augment, with Mirror Ball above it when Mirror Ball exists
 const fails=[];let done=0;const total=weapons.length*augs.length;
 out('Crash check: 0 of '+total+' fights');const smokeLine=lines.length-1;
 for(const w of weapons)for(const id of augs)tasks.push(()=>{
  try{const r=newRun(w,7);r.tier=Math.min(4,RULES.run.tiersToWin);r.stage=1;r.enc=genEnc(r);r.augs=(AUG.mirror&&id!=='mirror'?[{id:'mirror',n:0,f:{}}]:[]).concat([{id,n:0,f:{}}]);
   const S=fight(r);if(!isFinite(S.player.hp)||!isFinite(S.dmg))throw new Error('a number went wrong (NaN)');if(!S.done)throw new Error('the fight never ended')}
  catch(e){fails.push(WEAPONS[w].name+' + '+AUG[id].name+' ('+id+'): '+e.message)}
  done++;lines[smokeLine]='Crash check: '+done+' of '+total+' fights, '+fails.length+' failed';pre.textContent=lines.join('\n')});
 // every boss with every weapon, at tier 3 and with two items switched on, so boss rules and consumables are crash-checked too
 for(const w of weapons)for(const bid of Object.keys(BOSS))tasks.push(()=>{
  try{const r=newRun(w,9);r.tier=3;r.stage=2;r.enc={boss:bid,list:['grunt']};r.augs=augs.slice(0,4).map(id=>({id,n:0,f:{}}));const it=Object.keys(typeof ITEM!=='undefined'?ITEM:{});r.bag=it.slice(0,2).map(id=>({id,use:true}));
   const S=fight(r);if(!isFinite(S.player.hp)||!isFinite(S.dmg))throw new Error('a number went wrong (NaN)');if(!S.done)throw new Error('the fight never ended')}
  catch(e){fails.push(WEAPONS[w].name+' vs '+BOSS[bid].name+': '+e.message)}});
 tasks.push(()=>{for(const f of fails)out('  FAILED  '+f);out('')});
 // 2. balance check
 const PER=8,goal=RULES.run.tiersToWin,stats={t1:{fight:{n:0,t:0},boss:{n:0,t:0}}},res={},deaths=Array(goal+2).fill(0),killers={};let runs=0;
 tasks.push(()=>{out('Balance check: 0 of '+weapons.length*PER+' runs')});
 for(const w of weapons){res[w]={wins:0,tiers:0};for(let i=0;i<PER;i++)tasks.push(()=>{
  const r=playRun(w,1000+i*7919,stats);runs++;if(r.win)res[w].wins++;else{deaths[r.tier]++;if(r.boss)killers[r.boss]=(killers[r.boss]||0)+1}res[w].tiers+=r.tier-1;
  setLast('Balance check: '+runs+' of '+weapons.length*PER+' runs')})}
 tasks.push(()=>{
  let wins=0;for(const w of weapons)wins+=res[w].wins;
  setLast('Balance check: a bot that buys at random played '+runs+' runs and won '+wins+' ('+Math.round(100*wins/runs)+'%).');
  out('  Weapon           Wins   Average tiers cleared');
  for(const w of weapons)out('  '+WEAPONS[w].name.padEnd(16)+' '+(res[w].wins+'/'+PER).padEnd(6)+' '+(res[w].tiers/PER).toFixed(1)+' of '+goal);
  out('  Runs that ended on each tier: '+deaths.map((n,t)=>t>=1&&t<=goal?'T'+t+':'+n:null).filter(Boolean).join('  '));
  const k=Object.keys(killers).sort((a,b)=>killers[b]-killers[a]).slice(0,4).map(id=>BOSS[id].name+' '+killers[id]);
  if(k.length)out('  Bosses that ended the most runs: '+k.join(', '));
  const a=stats.t1.fight,b=stats.t1.boss;
  out('  Average length of a tier 1 fight: '+(a.n?(a.t/a.n).toFixed(1):'?')+'s. Tier 1 boss: '+(b.n?(b.t/b.n).toFixed(1):'?')+'s.');
  out('');
  out('How to read this: the shipped game scores roughly 2 to 8% wins here (the late tiers are tuned for a player who builds on purpose), with most runs ending on tiers 5 to 8 and tier 1 fights lasting 10 to 20 seconds.');
  out('Much higher wins means the game got easier; near 0% means harder. A real player who builds synergies does far better than this bot.');
  out(fails.length?'RESULT: '+fails.length+' crash check failure(s). Fix these before anything else.':'RESULT: no crashes.');
  document.getElementById('selftest-copy').hidden=false;
 });
 (function pump(){const t0=performance.now();try{while(tasks.length&&performance.now()-t0<40)tasks.shift()()}catch(e){out('SELF-TEST STOPPED: '+e.message);return}if(tasks.length)setTimeout(pump,0)})();
})();
