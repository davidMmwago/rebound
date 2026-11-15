# Rebound

A roguelike where your ball fights on its own. Pick a weapon, watch it bounce and battle in the arena, and build it up with augments between fights. Eight tiers, a boss every third fight, then endless mode.

**Play:** open `index.html` through a web server (GitHub Pages works; see below). Opening the file straight from your computer may not load the game data, because browsers block that for local files.

## Hosting on GitHub Pages

1. Create a new **public** repository on GitHub (for example `rebound`).
2. On the repository page choose **Add file → Upload files**, and drag in **everything inside this folder** (not the folder itself): `index.html` must sit at the top of the repository, next to the `assets` folder. Commit.
3. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the branch **main** and the folder **/ (root)**, then **Save**.
4. After a minute or two the game is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Send that link to your friends.

To update the game later, upload the changed files the same way; Pages republishes on its own.

## Notes

- **Admin panel:** hidden in this copy. To show the Admin button again, set `"showToggle": true` under `"admin"` in `game-data.json` (and in `game-data-fallback.js`, which is a copy of the same data).
- **Self-test:** add `#selftest` to the end of the address to run the built-in crash and balance check.
- **Everything is data:** numbers, text, colours and art paths live in `game-data.json`.

## Credits and licences

- Game by David Mwago.
- **Pixel Game** font (title text): free for personal use only, under the 1001Fonts Free For Personal Use licence in `assets/fonts/pixel-game-eula.txt`. Using it in a game that earns money needs the author's permission.
- **Alpha Beta** font (body text) by Brian Kent: freeware; his notes are in `assets/fonts/alpha-beta-brk-readme.txt`.
