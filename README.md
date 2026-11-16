# Rebound: source files

These are the game's source files, mirrored from the published artifact. The game was called Ricochet Rogue until 15 November 2026; the handoff guide and backlog still use that name.

- **Mirrored from artifact version:** `1794790568-eff7` (15 November 2026, data file version 8)
- **Live game:** https://claude.ai/artifact/BYcf2LpJCXJFJxvMDP7jBq (slug `55656ac0-469b-4b9e-a7c0-7e221b0b84ac`, artifact title "Rebound")
- **Read first:** `claude/ricochet-rogue-handoff-guide.md` explains every file, the rules, and how to test. **`claude/rebound-systems.md` explains how damage, stats, sources, tags, counters, overflow, statuses and knockback work now; read it before writing any augment, trophy or new system.** `claude/ricochet-rogue-backlog.md` lists agreed work that is not done yet. `claude/augment-art-list.md` lists the art each augment needs. Where the guide disagrees with the systems doc or with "Changes since the guide" below, those are newer.

## What is here

| File | What it is |
| --- | --- |
| `index.html` | Page shell and loader |
| `style.css` | Styling, except augment cards |
| `cards.css` | The look of an augment card |
| `validate.js` | Checks `game-data.json` |
| `core.js` | Simulation and run logic |
| `ui.js` | Drawing, interface, sound, impact frames, admin panel |
| `selftest.js` | The `#selftest` page |
| `game-data.json` | Every number, sentence, color and asset path |
| `tools/card-frames.py` | Draws the five pixel-art card frames (not part of the game; run it to remake them) |
| `tools/card-fx.py` | Draws the tiny pixel textures for the Epic and Legendary card effects (pasted into `cards.css`) |
| `tools/weapons.py` | Draws the pixel-art weapon sprites and the character select pictures |
| `tools/fingerprint.js` | Seeded fingerprint of every weapon × augment fight and 36 bot runs; compare before and after any change that should not change gameplay |

`game-data-fallback.js` is not stored here because it is generated from `game-data.json`. Build it before publishing:

```bash
python3 -c "import json;d=json.load(open('game-data.json'));open('game-data-fallback.js','w').write('window.GAME_DATA_FALLBACK='+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n')"
```

Asset files are binary, so they are not mirrored here. The artifact currently holds these:

| File | Made by |
| --- | --- |
| `assets/cards/frame-common.png`, `-uncommon`, `-rare`, `-epic`, `-legendary` | `tools/card-frames.py` (456 x 192 each) |
| `assets/weapons/weapon-sword.png`, `-dagger`, `-spear`, `-hammer`, `-bow`, `-shield` | `tools/weapons.py` (pixel art saved 8x; arena sprites, `assets.images.weapons`) |
| `assets/weapons/icon-sword.png`, `-daggers`, `-spear`, `-hammer`, `-bow`, `-fists` | `tools/weapons.py` (saved 3x, shown at that size on the character select screen, `assets.images.icons.weapons`) |
| `assets/icons/augments/rubber.png`, `mirror.png`, `pinball.png` | The owner's ball drawings, cleaned to 20 x 20 pixel art (Pinball is the Mirror Ball recoloured) |
| `assets/icons/augments/glass.png`, `gyro.png` | Redrawn by hand as 20 x 20 pixel art from the owner's bomb and gyroscope pictures (Glass Cannon, Gyroscope) |
| `assets/fonts/pixel-game.otf` + `pixel-game-eula.txt` | Owner's upload, unaltered. Free for personal use only (1001fonts licence) |
| `assets/fonts/alpha-beta-brk.ttf` + `alpha-beta-brk-readme.txt` | Owner's upload, unaltered. Freeware by Brian Kent, who asks that his text file stays with the font |

## Changes since the guide

**Pixel-art balls (16 November 2026).** With `theme.ballLook.pixelArt` (on; `pixel` 1.5 arena units per pixel, so about 3 screen pixels like the card frames), `pixelPass()` in `ui.js` works out shadows and ball bodies pixel by pixel on a small layer and scales it up without smoothing: hard edges, stepped tones, a pixel highlight, a 1-pixel outline (2 for your ball and bosses), the light tint, the hit flash and squash and stretch, all with no blended in-between colours. Light pools are drawn on a second small layer, so the mouse light and flashes come out in pixel blocks too. Status rings, wind-up marks, HP numbers and weapons stay sharp on the arena (`drawTop()`). `pixelArt: false` brings back the smooth drawing (`drawBody()`, `drawShadows()`, `shadeBall()`). Balls with their own sprite are drawn as before.

Then: your ball's outline is 1 pixel (bosses keep 2); shadows reach further (`shadowLength` 0.5 of the radius, was 0.32; weapon shadows 7, was 5). The "Some files did not load" card could list pictures that were fine: redrawing the side panel while pictures load can cancel a download and report an error, so a failed card picture is now tried once more on its own before it is listed.

Then: impact frames are back to how they looked before the lighting (no `impact` flash, and `drawLightPass` steps aside while one plays; real hits now look like the Admin test buttons). Shadows are cast, not one shape turned around: `shadowsFor(b)` stretches each shadow away from its light by how far the light is to the side compared with its height (round under the ball with the mouse right above, up to 2.8 radii long and fainter when far), with a darker core and lighter edge; flash and glow shadows work the same way. Each shadow is a single shape (the core-and-edge version was dropped at the owner's request).

Then: every ball outline is 1 pixel, bosses included (gold), and the elite ring is thinner. Particles, rings, lightning, Earthquake cracks and the speed trail are pixel art (`pxRing`, `pxLine`, `pxDisc`, `pxFill` in `ui.js`): squares on the pixel grid, each square drawn once per shape so fades stay even. With `pixelArt` off they draw smooth as before.

**Lighting system (16 November 2026).** One lighting model in `ui.js` (`theme.lighting`), with a **Lighting: Full / Simple** button in the header (`#light` in `index.html`, remembered per device). Simple is the previous look: one light at the mouse. Full adds:

- **Flashes** (`addFlash(kind, x, y, scale, colour)`): strikes from the sky (`lightning`, which also dims the whole arena up to `maxDim` so its light and the shadows it throws stand out), other zaps (`spark`: Tesla Node, Static Coil, Capacitor), big rings and explosions (`blast`, in the ring's colour: shockwaves, Bomber and Flashpoint blasts, boss phase changes), small rings (`glint`), Earthquake (`quake`), impact frames (`impact`). They come from the events `drain()` already handles, so new effects that use those events light up for free.
- **Glows** that follow things while they last: burning balls (stronger with more Burn), Frozen balls, warning marks (The Storm's strikes, Crusher and Gavel slams, growing as they charge), and bosses in `bossGlow` (The Furnace, The Glacier, The Storm).
- **Per ball** (`sampleLight(b)`, cached per frame): shading turns toward the combined light, the mouse light weakens while lightning dims the room, the strongest nearby light adds a second, longer shadow (longer the lower the light) and a coloured tint on the facing side. Weapons take their shadow and glint from the same sample.
- **Light pass** (`drawLightPass()`): after balls and projectiles, the dim overlay, then each light added as a soft pool of its colour. Rings, zaps, particles and numbers are drawn after it, so they stay bright.
- **Cost:** about 0.3 ms per frame in a headless test. If frames stay above `autoSimpleMs` (14 ms) for 3 seconds in a fight, the game switches to Simple once and says so in the notice bar (only if the player has not chosen a mode).

**Balls look round (16 November 2026, trial: the owner wanted to see all three ideas together).** `drawBall()` in `ui.js` now uses `shadeBall()`: three flat tones stepped toward the light, a hard highlight, and a light band that rolls with the distance travelled (`b.roll`, `b.rollA`, drawing-only fields). `drawShadows()` puts a floor shadow under every ball before the balls are drawn. The light follows the mouse anywhere on the page (the same pointer that lights the augment cards): balls are lit from the mouse's side and cast shadows away from it; with no mouse it sits top left. Each part can be switched off in `theme.ballLook` (`shading`, `shadow`, `stripe`, `mouseLight`, `highlight`, `shadowOpacity`, `stripeOpacity`). Balls with their own sprite keep it and only get the shadow.

Then (same night): the rolling stripe is off (`stripe` false); the light eases toward the mouse more slowly (`lightEase` 3, exponential) and hangs `lightHeight` 120 above the table, so a ball under the mouse is lit from above and the lighting turns smoothly instead of flipping; weapons cast a floor shadow (`weaponShadow`, `weaponShadowOffset`, using the canvas shadow) and get up to 25% brighter when they point toward the light (`weaponLight`, canvas `filter`, skipped where unsupported).

**Domino Effect is back, for projectiles (16 November 2026).** Legendary, `domino` (tags shot, scale): when one of your projectiles (arrows, Sidearm pellets, Mini-You arrows) kills an enemy, it flies on to the nearest enemy with +100% damage (`p.f` doubles each link), up to 12 links (`dominoArrow()` in `core.js`). From 2 links "Chain ×n" floats over the kill, 4 plays the Heavy impact frame and 6 Massive, a zap line shows the jump, the card shows the best chain this fight and the run's record ("Record ×n", kept in the augment's `n`). The breakdown credits the extra damage to Domino Effect. Counter `dominoChain`. 105 augments. Test: Bow at tier 3 with Domino Effect chains up to 6 to 7 kills per volley; it needs a build that can kill to start chains, so it is weak in a losing tier 6 fight.

**Recap types itself out (16 November 2026).** The payout, victory and game over sheets type their lines out one after another (`typeSheet()` in `ui.js`): each row appears with its first letter, letters click in (`assets.sounds.type`, a synthesised tick until a file is set), gold amounts chime when they finish, and the damage breakdown bars grow in (`@property --w` transition in `style.css`). Any mouse click anywhere except on a button shows everything at once. The title, buttons and a closed breakdown are not typed. Settings in `rules.feel.typewriter` (`enabled`, `charsPerSecond` 45 at 1x, `scaleWithSpeed` true so 2x/4x/8x game speed types 2/4/8 times as fast, `soundEvery` 2); off for reduced motion. Typed once per sheet (`G.sheetId`).

**Bow stats all count now (16 November 2026).** Knockback, Spin and Reach did little or nothing for the Bow. Now (`rules.bow`, the Bow branch of the weapon loop in `core.js`):

- **Spin sets the fire rate.** At the Bow's listed Spin it fires every `fireEvery` (1.1s); fire interval × (listed Spin / current Spin)^`spinPower` (0.7), never below `minFireEvery` (0.25s). Gyroscope, Grease, Twin Engines all speed it up; Chill slows it. Aiming speed is unchanged.
- **Reach sets arrow speed:** × current Reach / listed Reach, between `minSpeedX` 0.5 and `maxSpeedX` 2.5.
- **Arrows push enemies** with your Knockback (the Bow now has `knockback` 120), through `knockBy`, so Counterweight, Heavy Swing, Wall Slam, Follow-Through and Newton's Cradle work. Projectiles carry `arrow`, `kb` and `d` (distance flown).
- **Pike** counts Bow arrows (`S.arrow`); **Sweet Spot** counts arrows that have flown 150+ (`arrowRange`). Sidearm pellets are not arrows.
- Bow blurb: "Ranged, auto-aims. Spin: fire rate. Reach: arrow speed."
- Bot test (48 Bow runs): average bosses beaten 4.65 (was 4.50; with a linear fire rate it was 5.04, so `spinPower` 0.7 softens it). Tier 4 fights solo: Gyroscope 53% → 70% won, Wall Slam 53% → 70%.

**Boss and enemy mechanics, elites, consumable items (15 November 2026).** Everything in `claude/boss-enemy-draft-1.md` is built (with the tuning notes below), plus a consumable item shop the owner asked for. Catalyst is unchanged on purpose (owner's call). Details in sections 14 and 15 of `claude/rebound-systems.md`.

- **Planning:** the next-fight card shows "Coming up" with the next two tiers' bosses (hover for their rules), each boss's "At 50%:" line and "Weak to / Resists" keywords (`bosses.<id>.phase2`, `.weak`, `.resists`), each enemy type's behaviour (`enemies.<id>.about`), and any elite.
- **Bosses:** every boss has a new rule, and all but The Hydra a phase 2 at half HP (see the draft). Changes from the draft after testing: The Furnace's Burn immunity does not heal it (`burnHealPercent` 0; healing made it the top killer by far), its bounce cost is 1% and glowing walls ×2; The Storm's damage is 10 with at most +1 extra strike from Shock; The Eight Ball resists your top damage type by 40% (not immune); The Hydra only merges same-size heads, 4s after they appear, and split heads are +25% faster; The Brood Queen's grown Grunts have 60% HP after 8s. The Reflection takes your top augment (switched off) and gets +15% damage per rarity step of it. The Bulwark's card says Resists: Small hits (its flat Armor punishes many weak hits, not Mult). Centrifuge is now Rare and capped at +8 Power (`values.max`); on Twin Daggers it was far ahead of Whetstone (87% vs 80% tier 4 fights won solo, 97% with Gyroscope).
- **Enemies:** Swarmlings flock, Slashers flash and lunge, Stabbers sidestep your blade (outlined when ready), braced Lancer spears glow and hit double, Brutes stamp then charge and are stunned by walls, Archers back away, Bombers light a fuse near you and their blast hurts enemies, your blade cuts a Medic's heal beam for 3s, Guards rush to stand between you and an ally below 70% HP, turning their shield toward you at 1.6 rad/s (a first version always faced you and made a lone Guard unbeatable for the Bow: arrows hit the shield every time; fixed 16 November, alone its shield spins as before), Crushers slam the floor after a ring warning.
- **Elites** (`rules.elites`): from tier 3, 35% of normal fights give one enemy Armored, Swift, Vampiric, Volatile or Warded; gold ring in the arena, named on the card, +$2 payout.
- **Items** (`consumables`, `rules.consumables`): 2 per shop (rerolled with the shop), a bag of 3 shown on the next-fight card. Click an item to switch it on; switched-on items are used up when the next fight starts (`run.bag`, `run.active`). Right-click sells for half. Padlock (no socket can be switched off or eaten), Power Tonic (+50% Power), Iron Draught (+50% Max HP), Quickstep (+30% Speed), Aegis Potion (immune 4s once below 30% HP), Smoke Bomb (Freeze every enemy 2s), Mini Crate (+2 Minis).
- **Tests:** boss fights at tiers 3 and 6 with fixed random builds, before and after: most bosses a little harder, The Bulwark a little easier (cracks), The Furnace and The Storm hardest. Random bot over 288 runs: average bosses beaten 4.0 (was 4.3), tier 1 boss deaths 5%. The bot never uses items or plans for bosses, so a real player gains more than it does. `#selftest` now also crash-checks every boss with every weapon and two items; 0 failed.

**Mini augments round 2 (15 November 2026).**

- **Mini Me now transforms during a fight** (owner's correction): a Mini that stays alive 6s (`seconds`) becomes a Mini-You on the spot, up to 3 at once. Nothing carries over between fights any more. Minis record `b.born`.
- **Hatchling** tune-up (`tuneUps.mini`, the eleventh id): +1 Mini at fight start per purchase. Tune-ups can now have a `weight` (default 1); Hatchling has 0.35, so it shows up about a third as often. The shop picks tune-ups by weight.
- **Pack Training** (Rare, the first Quest): spawn 10 Minis while you own it (Mitosis, Brood, Hatchling, Nursery all count; Afterimage clones and Mini-Yous do not), then Minis get your Speed (`P.miniSpd`) and their rams knock with your full Knockback (`P.miniKb`). Progress shows on the card ("Quest: 3/10") and live in fights; it can complete mid-fight. New glossary keyword Quest.
- **Afterimage** (Rare): every 5s each Mini makes a clone (`b.clone`, `b.life` 2.5s, up to 6) that counts as a Mini (Hive Mind, Underdog, on-hit effects of its rams) and fades.
- **Nursery** (Uncommon): each Mini that ends a won fight above 90% HP adds +1 Mini at the start of every later fight, up to +4.
- **Pack Bounce**, **Pack Contact**, **Pack Hunt** (Uncommon): at fight start and every 8s, for 3s, Minis' wall bounces count as your bounces (`S.miniBounce`, `bounceEvent` with the Mini), Minis' rams trigger your On contact effects (`S.miniTouch`), or Minis ram for 100% Power instead of 45% (`S.miniHunt`). Minis' rams already trigger On hit effects (Venom Gland, Matchstick, Rubber Core...) at all times, since they go through the hit pipeline.
- 104 augments. Self-test 624 crash fights, 0 failed.

**Post-fight damage breakdown (15 November 2026).** Playtesters could not tell how much each augment was worth. The payout, victory and game over sheets now end with a collapsible "Damage breakdown" (`breakdown()` in `ui.js`, styles at the end of `style.css`; open or closed is remembered per device):

- **Dealt by:** who dealt each point of damage, with a bar and its share of the total: the weapon, Body hits, Projectiles, Minis, Mini-Yous, Effects, Poison, Burn, and each augment or trophy whose hook caused a hit (Echo Chamber, Tesla Node, Newton's Cradle...).
- **Added by:** how much damage each boost put on top of the hits it touched, worked out per hit as damage × (1 − 1/its factor). This covers stats hooks (Whetstone, Juggernaut...), on-hit hooks (Bank Shot, Glass Cannon...), and the built-in Crits and Ramp. Boosts overlap, so this column can add up to more than the total (hover the heading for that note). Mirror Ball and Resonator are credited with what they copy or repeat.
- **Triggers:** "9×" beside an augment is how often its card flashed this fight. Owned augments that neither dealt nor added damage (Armor, Speed, crit chance and the like) are listed at the end as "No damage counted".
- **Code:** `fire()` wraps each hook in `call()`, which records `x.bst` (the factor a hook gave a hit, or the player's stats in `stats`) and `S.trig`. `playerHit()` sets `S.hitKey` so `damage()` can file every point in `S.dmgBy` under `src:<kind>`, `aug:<id>` or `boost:<id>`. `S.hitOwner` marks Mini-You hits. Text in `text.breakdown*` and `text.sourceNames`.

**Mini Me, Mini support, Newton's Cradle chains (15 November 2026).** Domino Effect was built and then removed at the owner's request; its chain counter and impact frames moved to Newton's Cradle.

- **Mini Me** (Legendary, `minime`): Minis lose 50% Max HP (`P.miniHpX`). (First version: Minis alive after a win came back next fight as Mini-Yous. Replaced the same evening by the in-fight transform above.) A Mini-You (`spawnMiniYou` in `core.js`) has your weapon and blades at 70% Reach, your Speed, 35% of your Max HP, radius 14, your colour; its blade hits go through `playerHit` as `weapon` hits for 40% damage, so your augments apply, but never feed the ramp. Bow Mini-Yous shoot for 40%; Bare Fists Mini-Yous ram for 40%. They count as Minis (Hive Mind, Underdog) but ignore the Mini cap. `miniDamagePercent` (100) can nerf ordinary Minis' rams while you hold it, if it proves too strong.
- **Support augments that also work without Minis:** Lifeline (Uncommon, +1 HP/s, Minis heal at your Regen: `P.miniRegen`), Pack Armor (Uncommon, +2 Armor, Minis get all your Armor instead of 50%: `P.miniArmor`), Second Skin (Rare, immune for 0.5s after taking damage, Minis too: `P.hurtInv`, applied in `enemyHit`).
- **Newton's Cradle buffed:** 75% Power per pass (was 50%), passes on 85% of your Knockback (was 70%), window 0.9s. It now counts the chain (`t.ncN`; a knock from you starts a new one): from 2 passes "Chain ×n" floats over the hit (`text.chainStreak`), 4 passes play the Heavy impact frame, 6 play Massive, and the card shows the longest chain this fight (`text.chainBest`). Counter `cradleChain`.
- New hook `onKnock` (from `knockBy`) stays; Cradle uses it to reset its chain.
- 98 augments. Tests: Mini Me alone is a downgrade (weaker Minis); with Mitosis or Brood plus Lifeline or Pack Armor it wins 33 to 40 of 40 tier 3 fights once 3 Mini-Yous are kept. Self-test 588 crash fights, 0 failed.

**Difficulty curve, 6 slots, Spear and Reach (15 November 2026).** From playtest feedback (runs either died at the first boss or won easily) and the owner's answers.

- **Start with 6 augment slots** (`rules.run.startSlots`; max still 8). Back to 5 on 16 November 2026 at the owner's request.
- **Easier opening.** Bosses can have `minTier` (data, optional): The Storm from tier 2, The Bulwark and The Gavel from tier 3. `newRun()` never puts a boss before its tier. The Bulwark at tier 1 caused about half of all tier 1 boss deaths (4 Armor against Twin Daggers' 3 Power).
- **Harder late game.** `lateScale(T)` in `core.js`: from `rules.scaling.lateFromTier` (5) every tier multiplies enemy and boss HP by `lateHpPerTier` (1.2) once more, on top of the normal growth (×1.2 at tier 5, ×1.73 at tier 7, ×2.07 at tier 8, and it carries into endless). Optional `lateDamagePerTier` (unset) and `firstBossHpPercent` (unset) exist too.
- **Result** (random bot, 288 runs): tier 1 boss deaths 13% → 2%, most runs now end on tiers 5 to 8, tier 7 to 8 fights about 40% longer. The bot wins about 3%, by design: the late tiers are tuned for a player who builds on purpose. `#selftest` now says 2 to 8% is normal.
- **Spear** Power 8 → 9, Spin 4.2 → 5.
- **Reach augments** (new tag `reach`; Long Handle also has it now): Pike (Uncommon, weapon hits +1 Power per 10 Reach, reads the live blade so the Spear's ramp feeds it), Sweet Spot (Uncommon, weapon hits landing 35+ Reach away: ×1.6 Mult), Sweep (Rare, your blade hits every enemy it passes; each enemy has its own cooldown per blade), Horizon (Epic, ×Mult +0.1 per 15 Reach above the weapon's). 94 augments in all. Glossary entry and colour for Reach. Details in section 11 of `claude/rebound-systems.md`.
- **Spear now** averages 4.2 bosses beaten in the bot test, level with the others (it was 2.9).
- **Next:** `claude/boss-enemy-draft-1.md` proposes deeper boss and enemy mechanics; waiting for the owner's choices.

**Knockback, Impact and The Gavel (15 November 2026).** Owner's request: give the Hammer real knockback, make knockback a stat you can invest in, with blade knockback and ball (collision) knockback separate, add a knockback boss, and let Max HP resist knockback. Also Earthquake was simplified. Full details in section 10 of `claude/rebound-systems.md`.

- **Stats.** `P.kb` (Knockback, from each weapon's new `knockback`: Hammer 650, Sword 230, Spear 200, Daggers 110) and `P.impact` (Impact, the ball's shove on collision: Bare Fists 180, others 0). The old `P.knock` multiplier is gone. Shown on the Your ball card, the character select weapon card and in the Admin panel.
- **Tune-ups.** Ten ids now: `knock` "Counterweight" (+15% Knockback) and `impact` "Bumper Pads" (+40 Impact) were added. The validator checks all ten.
- **Knock resistance.** `rules.knockback` (`resistHp` 150, `enemyReferenceHp` 40, `playerReferenceHp` 100): more Max HP is pushed less, for enemies and for your ball.
- **Augments.** Battering Ram (Common, +120 Impact), Follow-Through (Uncommon, +0.6 Mult on recently knocked enemies), Wrecking Ball (Rare, Knockback and Impact per 25 Max HP), Newton's Cradle (Epic, knocked enemies pass the knock on and take damage, chaining). 90 augments in all (21 Common, 35 Uncommon, 21 Rare, 8 Epic, 5 Legendary).
- **Boss.** The Gavel (`bosses.gavel`, in `bossPool`, 10 bosses): hammer with ×2.4 knockback; a wall hit within 0.7s of being knocked costs 6% Max HP.
- **Earthquake** now reads "Every 5 bounces: 120% Power to all enemies. Stuns them briefly." (no Speed check, no cooldown).
- **Testing.** Validator clean; self-test 540 crash fights, 0 failed. Random bot over 384 runs: about 5 to 6% wins against 10% for the previous version, but average bosses beaten is the same within noise (3.9 to 4.2 against 4.1 to 4.3). Neither the new tune-ups nor The Gavel explains the difference on its own.

**Augment draft 1 built (15 November 2026).** 28 new augments from `claude/augment-draft-1.md` plus Maw (eats the augment below it for permanent ×Mult, the owner's request): 86 augments at the time (20 Common, 34 Uncommon, 20 Rare, 7 Epic, 5 Legendary). The draft doc keeps the design reasoning; `game-data.json` holds the final numbers, which were tuned after testing (Kindling 3 stacks, Afterburner 2, Frost Edge 3, Heavy Swing also +2 Power, Glacial Core ×2, Inferno 12%/s, Burn's Power share 6%). New mechanics: the Chill/Freeze status (`rules.status`), Knockback, collision hits, Resonator retriggers, Maw's `beforeFight`, and Burn scaling with Power (`rules.combat.burnPowerPercentPerStack`; Flashpoint now `powerPercent` 80). All described in section 9 of `claude/rebound-systems.md`. Self-test: 516 crash-check fights, 0 failed; random bot 8 of 48 runs won (17%). Every tier 1 loss in that test was a bot holding build pieces with no damage source. Socket art is now drawn pixel-exact (`.framed .ac-art .icon`: pixelated, no round clip); the art list is `claude/augment-art-list.md` (20 x 20 pixel art per socket).

**Foundation (15 November 2026).** Sources, modifier layers, tags, counters, overflow and big-number display, all described in `claude/rebound-systems.md`. Gameplay is unchanged (fingerprint identical). Trophy `stats` hooks now take the augment signature `stats(t, S, P, v)`. `#selftest` begins with a systems check. New optional data: `rules.overflow` (all 0, off).

**Rebound update (15 November 2026).**

- **Name.** `text.logoFirst` is "Rebound"; `text.logoSecond` may now be empty (the validator allows it; when set it is drawn in the accent colour). Page title, artifact title, self-test and file headers say Rebound.
- **Power and Mult colours.** Power `#8c9eff` (periwinkle), Mult `#f2609f` (raspberry), in `theme.page.pow`/`mult` and `theme.keywordColors`. `--mult` is also the game's red accent (boss names, sell button, boss bar), so those moved to raspberry too.
- **Endless scaling.** `endlessScale(T)` in `core.js`: endless tier k (k = tier - tiersToWin) multiplies enemy and boss HP by `endlessHpPerTier^k` and damage by `endlessDamagePerTier^k`, both times `(1+endlessAcceleration)^(k(k-1)/2)`, on top of the normal per-tier growth. Numbers in `rules.scaling` (1.5, 1.15, 0.1): extra HP x1.5 at tier 9, x2.5 at 10, x9 at 12, x48 at 14. All three keys are optional (missing means no extra scaling).
- **Tier plan and fight previews.** `planTier(run)` builds all three fights of a tier when the tier starts (`run.plan`, `run.planTier`); `advance()` takes `run.enc` from the plan, so a preview is always the real fight. `encAt(run, i)` reads one. Old saved runs without a plan get one on load.
- **Tier tracker.** `nextCard()` in `ui.js` draws a bigger tracker (`.steps`, `.step`, styles at the end of `style.css`): two circles and the boss diamond with labels. In the shop, the current and later steps are buttons (`data-act="peek"`); pressing one sets `G.peek`, shows that fight on the card and in the warm-up arena (`previewFight()`), dashes the card's border, and turns the Fight button into "Jump to current" (`text.jumpToCurrent`). Normal fights no longer show the "Tier boss" line (`text.bossThisTier` is unused). The steps are `aria-pressed` buttons, so `button.step[aria-pressed="true"]` cancels the white pressed look that `style.css` gives the speed buttons.
- **Restart** goes back to the character select screen (`doRestart()` calls `toTitle()`), from the header button, holding R, and the game-over sheet. Admin overrides no longer carry over.
- **Click your ball.** In a fight, clicking the player's ball on the canvas opens or closes the live stats panel; in the shop it scrolls to the Your ball card (`#yourball`) and blinks it. Code: `onBall()` in `ui.js`.
- **Pixel-art weapons.** Every blade shape, the bow and the Guard's shield have sprites in `assets.images.weapons`; the character select screen shows weapon pictures from `assets.images.icons.weapons` (gauntlet fists for Bare Fists). `.weapon .icon` shows them at their own size with `image-rendering: pixelated`. Projectiles are still drawn by code.
- **Text.** The New run card shows only its title (`text.heroBody` is empty; the validator allows that and `titlePanel()` skips an empty one). The Sword's blurb is the owner's line "Perfectly balanced, as all things should be." Bare Fists no longer says "no blade" anywhere: its blurb lost it and its character select stat line shows only Power (`text.noBlade` is now unused but still required by the validator).

**Pixel fonts (15 November 2026).** Title text is Pixel Game, all other text is Alpha Beta BRK, replacing Bagel Fat One and Onest (no Google Fonts any more).

- Files are in `assets.fonts` (`display`, `body`); family names, sizes and metrics are in `theme.fonts`. `loadFonts()` in `ui.js` registers them with `FontFace`; a file that fails is listed on the title screen.
- Both are pixel fonts and are sharp only at sizes where one font pixel covers whole screen pixels. Alpha Beta's pixel is 1/13.333 of its size, so all small text uses `--bfs` (`theme.fonts.bodySize`, 13.333; 26.667 for a few big numbers). Pixel Game's pixel is 1/32.68 of its size, so every title uses `--dpx` (`theme.fonts.displaySize`, 32.68; the New run heading is 1.5x).
- Pixel Game below 32.68 px blurs its one-pixel gaps shut, so "The Glacier" read as "The Blacier" (seen by the owner on Windows with ClearType). Small titles therefore use Alpha Beta: card names, buy prices, socket numbers, stat numbers, tune-up names, the HP bar text, glossary terms and the needle price. A new rule must use `var(--dpx,32.68px)` (Pixel Game) or `var(--bfs,13.333px)` / `calc(var(--bfs,13.333px)*2)` (Alpha Beta), never another size.
- `theme.fonts.displayScale` (1.3) now only scales the numbers drawn on the arena canvas (`DFS` in `ui.js`). Pixel Game's reported cap height (680) is wrong (real: 519 of 1000), so `font-size-adjust` cannot be used. `theme.fonts.displayMetrics` (ascent 84%, descent 16%) centres it vertically.
- Faked bold and font smoothing are switched off (`font-synthesis:none`, `-webkit-font-smoothing:none`); text marked bold shows in the regular weight. Letter-spacing on Alpha Beta text is 0.
- Missing characters fall back to the system font: ▲ ▼ in both fonts, and the minus sign − in Alpha Beta.

**Pixel-art card frames (15 November 2026).** Every rarity now uses a frame picture from `assets.images.cardFrames`, redrawn as true pixel art from the owner's mock-up (Common is the mock-up's blue frame turned steel grey, at the owner's request). These lines replace the guide's "Card art" and "Hover and rarity effects" details where they differ:

- A frame is pixel art 76 x 32, saved 6x as 456 x 192, shown 96 px tall (3 screen px per pixel). It carries the metal, the dark text plate and a recessed socket for the augment art, so the CSS metal, plate and art ring are off for framed cards. Setting a rarity's frame to `null` brings the CSS metal back for that rarity.
- Its measurements live in `assets.cardFrameLayout` (picture pixels): `sliceLeft` 252 and `sliceRight` 102 never stretch; the art circle is at `artX` 42, `artY` 36, `artSize` 120 (60 px on screen); the text starts at `plateLeft` 228 with `plateTop` 24; `endCenter` 96 places the Buy button. `FRAME_VARS` in `ui.js` turns these into CSS variables. A new frame with a different layout only needs new numbers there. The validator checks they are numbers.
- All framed-card CSS is the last section of `cards.css`. The frame is drawn with `border-image` and `image-rendering: pixelated`. The pointer shine is stepped rings and `--mx`/`--my` are pixels on a 3 px grid. The trigger flash, dragging and the needle use 3 px pixel outlines (stacked `drop-shadow` on `.ac-frame`). Epic: violet pixel sparkles drift on hover. Legendary: stepped gold stripes drift and a pixel shine crosses the card every 3 s on hover, moving in steps. Glows are unchanged. All of it still switches off for reduced motion.
- The effects layer `.ac-fx` is cut to the pill with `clip-path` (inset 3 px on framed cards, so effects stay inside the black outline). Do not rely on `overflow: hidden` with `border-radius` alone there: browsers drop that rounded clip for animated layers, and the textures then showed past the round ends.
- The text plate is 72 px tall: the name (line-height 1), two description lines and the tags line, each at whole-pixel line heights.

## The one rule: the artifact is the game, this folder is a copy

Players and the owner open the artifact. Changing a file in this project does **not** change the game. Any chat that changes the game must leave the artifact and this folder identical.

1. Check the artifact's current version (`get_artifact`). If it differs from the version at the top of this file, another chat published without updating this folder. Read the files from the artifact (`list_files`, `read_file`) and trust those, not these.
2. Make the change and test it (see Testing in the guide; ask the owner to open the game with `#selftest`).
3. Publish the changed files to the artifact with `publish_files`, mode `patch`, `base_version` set to the current version. If `game-data.json` changed, publish a regenerated `game-data-fallback.js` with it.
4. Write the same changed files back to this folder with `project_write`, and update the version line at the top of this file to the new artifact version.

If you have no artifact tools in your chat, you cannot change the live game. Say so plainly. You may still update the files here, but then tell the owner the live game is unchanged and write "NOT YET PUBLISHED" with a one-line description at the top of this file, so the next chat publishes it.

## Starting over

If the artifact is ever lost, publish these eight game files plus a generated `game-data-fallback.js` as a new artifact with `index.html` at the top level, the frames made by `tools/card-frames.py` under `assets/cards/`, the weapons made by `tools/weapons.py` under `assets/weapons/`, the augment icons under `assets/icons/augments/`, and the owner's two font files (with their licence texts) under `assets/fonts/`. There is no build step.
