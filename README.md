# Depths Unbound

A turn-based 3D roguelike dungeon crawler that runs in the browser (Three.js + TypeScript). Every run generates a new dungeon with its own layout, biomes, monster roster, loot, artifacts, bosses, UI theme and music.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run sim -- 40  # headless balance simulation (bot plays 40 runs per class)
```

Requires a WebGL2 browser. Settings has a **Low** quality mode for phones and older GPUs. It turns off shadows and anti-aliasing and uses smaller textures.

## What changes every run

| System | Per-run generation |
|---|---|
| Dungeon | 10 floors. Rooms (rect / circle / cave), corridors with loops, hazard pools, pillars, traps, chests, shrines, fountains, a merchant on floors 3, 6 and 8 |
| Look | 3 of 6 biomes (Crypt, Frozen Depths, Infernal Forge, Fungal Grotto, Sunken Temple, Abyssal Rift), color drift, procedural stone, brick, ice and cave textures with normal maps |
| UI | Accent palette, heading and body fonts, panel frame style (gothic / runic / arcane / bone), ornaments, dungeon and floor names |
| Monsters | ~19 generated types per run: archetype × body plan × traits × abilities, with names, colors and procedural 3D models. Elites with affixes and mimics |
| Bosses | Generated bosses on floors 5 and 10 with telegraphed slams, beams, ruin rain, summons and enrage phases |
| Loot | Base types × rarity × affixes, named rares and epics, 12 unique artifact effects with generated names |
| Audio | Procedural WebAudio music in a biome-specific scale, a combat percussion layer and synthesized sound effects |

## Classes

Warrior, Rogue and Mage are available from the start. Cleric is unlocked at the Soul Altar. Each class has 4 abilities (unlocked at levels 1, 1, 3 and 6) and picks a perk from 3 random choices on every level-up.

## Difficulty

The game is meant to be hard but beatable. Balance was tuned with `npm run sim`, where a scripted bot plays complete runs. The bot dodges telegraphs and uses abilities and potions, but never uses scrolls or bombs, never buys gear and never kites. It wins about **15–27%** of runs depending on class. Most deaths happen at the depth-5 boss and the final boss. Things that make the game harder:

- Permadeath. The run is saved at the start of each floor.
- Resting only heals up to 50% life. Potions, fountains, level-ups and heals are the only way to recover further.
- Telegraphed boss and brute attacks (red tiles) must be stepped out of.

The Soul Altar's meta-progression (extra life, potions, loot quality, a 4th perk choice) makes later runs a bit easier.

These numbers come from bot simulations, not human playtesting. Expect to tune after real play. The main levers are in `src/game/game.ts` (`spawnMonster` depth scaling), `src/game/dungeon.ts` (spawn budget) and `src/game/monsters.ts` (archetype and boss stats).

## Controls

| Input | Action |
|---|---|
| Click / tap | Move, attack, interact. Click the stairs while standing on them to descend |
| W A S D / arrows | Move relative to the camera. Press two keys together for diagonals. Numpad works too |
| Q / E | Rotate camera. Wheel or pinch to zoom, two-finger twist to rotate |
| 1–4 | Abilities. Press again to auto-target the nearest enemy |
| 5 / H, 6 / G | Healing / mana draught |
| Space | Wait |
| R | Rest |
| X | Auto-explore |
| I / Tab | Inventory and character sheet |
| M | Large map |
| Enter | Descend |
| Esc | Cancel / menu |

## Code layout

```
src/game/      pure game logic (no DOM): generation, turn engine, AI, combat, items, perks
src/render/    Three.js renderer, procedural textures, models, effects, fog-of-war shaders
src/ui/        HUD, menus, input controller
src/audio.ts   procedural music and sound effects
scripts/sim.ts headless balance simulation
```

There are no art or audio asset files. Everything is generated at runtime.
