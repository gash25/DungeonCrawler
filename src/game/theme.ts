import { RNG } from './rng';

export type HazardKind = 'lava' | 'water' | 'acid' | 'void' | 'ice' | 'none';
export type WallStyle = 'brick' | 'cave' | 'block' | 'ice';
export type FloorStyle = 'tiles' | 'cobble' | 'rough' | 'slab';
export type DecorKind = 'bones' | 'rubble' | 'crystal' | 'mushroom' | 'candles' | 'coral' | 'rune' | 'urn' | 'chains' | 'skull';

export interface Biome {
  key: string;
  name: string;
  fog: number;
  fogDensity: number;
  ambient: number;
  hemiSky: number;
  hemiGround: number;
  torch: number;
  accent: number;
  wall: number;
  floor: number;
  hazard: HazardKind;
  hazardColor: number;
  wallStyle: WallStyle;
  floorStyle: FloorStyle;
  decor: DecorKind[];
  adjectives: string[];
  placeNouns: string[];
  placeAdj: string[];
  particles: number; // ambient particle color
  cave: boolean;
}

export const BIOMES: Biome[] = [
  {
    key: 'crypt', name: 'Crypt', fog: 0x0a0f10, fogDensity: 0.045, ambient: 0x223338, hemiSky: 0x3a5a5f, hemiGround: 0x0b0806,
    torch: 0xff9a4a, accent: 0x6fe3c4, wall: 0x7c7a74, floor: 0x5e5a54, hazard: 'acid', hazardColor: 0x6cff3a,
    wallStyle: 'brick', floorStyle: 'slab', decor: ['bones', 'skull', 'urn', 'candles', 'chains', 'rubble'],
    adjectives: ['Bone', 'Grave', 'Rot', 'Hollow', 'Ashen', 'Gaunt', 'Pale'],
    placeNouns: ['Ossuary', 'Catacombs', 'Sepulcher', 'Charnel Halls', 'Tombs', 'Barrows'],
    placeAdj: ['Weeping', 'Forgotten', 'Silent', 'Rotting', 'Nameless', 'Hungering'],
    particles: 0x9fffe0, cave: false,
  },
  {
    key: 'frost', name: 'Frozen Depths', fog: 0x08121c, fogDensity: 0.04, ambient: 0x2a3d55, hemiSky: 0x7fb4ff, hemiGround: 0x101620,
    torch: 0x8fd0ff, accent: 0x9fdcff, wall: 0x9fb8cc, floor: 0x6e8396, hazard: 'ice', hazardColor: 0x9fe6ff,
    wallStyle: 'ice', floorStyle: 'rough', decor: ['crystal', 'rubble', 'bones', 'crystal', 'rune'],
    adjectives: ['Frost', 'Rime', 'Glacial', 'Pale', 'Hoar', 'Winter', 'Shiver'],
    placeNouns: ['Caverns', 'Glacier Halls', 'Rimeworks', 'Hollows', 'Icewell', 'Crevasse'],
    placeAdj: ['Frozen', 'Howling', 'Bitter', 'Shattered', 'Everwinter', 'Silent'],
    particles: 0xdff4ff, cave: true,
  },
  {
    key: 'forge', name: 'Infernal Forge', fog: 0x140806, fogDensity: 0.042, ambient: 0x3a1a10, hemiSky: 0xff7a3a, hemiGround: 0x120403,
    torch: 0xff7a2a, accent: 0xffa040, wall: 0x5a4a44, floor: 0x3e3430, hazard: 'lava', hazardColor: 0xff5a10,
    wallStyle: 'block', floorStyle: 'tiles', decor: ['rubble', 'chains', 'skull', 'rune', 'urn'],
    adjectives: ['Ember', 'Cinder', 'Molten', 'Slag', 'Scorch', 'Brimstone', 'Ash'],
    placeNouns: ['Foundry', 'Forge', 'Furnace', 'Crucible', 'Smelteries', 'Anvil Halls'],
    placeAdj: ['Burning', 'Infernal', 'Blackened', 'Searing', 'Damned', 'Iron'],
    particles: 0xffa060, cave: false,
  },
  {
    key: 'fungal', name: 'Fungal Grotto', fog: 0x0c0814, fogDensity: 0.045, ambient: 0x2a1c3a, hemiSky: 0xb070ff, hemiGround: 0x0a1206,
    torch: 0xc080ff, accent: 0xd38bff, wall: 0x5c5266, floor: 0x433a3c, hazard: 'acid', hazardColor: 0x9dff4a,
    wallStyle: 'cave', floorStyle: 'rough', decor: ['mushroom', 'mushroom', 'mushroom', 'rubble', 'bones', 'crystal'],
    adjectives: ['Spore', 'Mold', 'Blight', 'Myco', 'Fester', 'Gloom', 'Lichen'],
    placeNouns: ['Grotto', 'Mycelium Deep', 'Sporelands', 'Rotgarden', 'Hollows', 'Undergrowth'],
    placeAdj: ['Glowing', 'Breathing', 'Whispering', 'Fevered', 'Teeming', 'Dreaming'],
    particles: 0xc8ff90, cave: true,
  },
  {
    key: 'temple', name: 'Sunken Temple', fog: 0x061214, fogDensity: 0.04, ambient: 0x1a3436, hemiSky: 0x4ad6c8, hemiGround: 0x0a0806,
    torch: 0xffc46a, accent: 0xf0c060, wall: 0x8a8068, floor: 0x6a6252, hazard: 'water', hazardColor: 0x1f7f8a,
    wallStyle: 'block', floorStyle: 'tiles', decor: ['coral', 'urn', 'rune', 'rubble', 'candles'],
    adjectives: ['Drowned', 'Tide', 'Coral', 'Brine', 'Silt', 'Deep', 'Kelp'],
    placeNouns: ['Sanctum', 'Temple', 'Reliquary', 'Cloisters', 'Aqueducts', 'Shrines'],
    placeAdj: ['Sunken', 'Drowned', 'Gilded', 'Sacred', 'Flooded', 'Abandoned'],
    particles: 0x9ff0e0, cave: false,
  },
  {
    key: 'void', name: 'Abyssal Rift', fog: 0x0a0612, fogDensity: 0.05, ambient: 0x221438, hemiSky: 0x7a4aff, hemiGround: 0x050208,
    torch: 0xb06aff, accent: 0xff5ad8, wall: 0x4a4458, floor: 0x332e3e, hazard: 'void', hazardColor: 0x8a3aff,
    wallStyle: 'block', floorStyle: 'slab', decor: ['rune', 'crystal', 'chains', 'skull', 'rubble'],
    adjectives: ['Null', 'Star', 'Rift', 'Umbral', 'Void', 'Eldritch', 'Dusk'],
    placeNouns: ['Rift', 'Abyss', 'Maw', 'Expanse', 'Nexus', 'Threshold'],
    placeAdj: ['Endless', 'Screaming', 'Starless', 'Shattered', 'Unseen', 'Final'],
    particles: 0xe0a0ff, cave: false,
  },
];

export interface UITheme {
  accent: string;
  accent2: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  dim: string;
  headFont: string;
  bodyFont: string;
  frame: 'gothic' | 'runic' | 'arcane' | 'bone';
  ornament: string;
}

export interface RunTheme {
  biomes: Biome[]; // one per act (floors 1-3, 4-6, 7-10)
  ui: UITheme;
  dungeonName: string;
}

const HEAD_FONTS = ["'Cinzel', serif", "'Cinzel Decorative', serif", "'Uncial Antiqua', serif", "'IM Fell English SC', serif", "'Pirata One', serif", "'MedievalSharp', serif"];
const BODY_FONTS = ["'Cormorant Garamond', serif", "'IM Fell English', serif", "'EB Garamond', serif", "'Alegreya', serif"];
const ORNAMENTS = ['✦', '❖', '✠', '☩', '◈', '✧', '⚜', '❂'];

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shift(c: number, hueShift: number, sat = 1, light = 1): number {
  let r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + hueShift + 1) % 1;
  s = Math.min(1, s * sat);
  const L = Math.min(1, l * light);
  const q = L < 0.5 ? L * (1 + s) : L + s - L * s;
  const p = 2 * L - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) r = g = b = L;
  else {
    r = f(h + 1 / 3);
    g = f(h);
    b = f(h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export { shift as shiftColor, hex as hexColor };

/** Build the visual identity of a whole run: 3 biomes, UI palette, fonts, frame style. */
export function makeRunTheme(rng: RNG): RunTheme {
  const pool = rng.shuffle([...BIOMES]);
  const biomes = pool.slice(0, 3).map((b, i) => {
    // Small per-run hue drift so even repeated biomes look different.
    const drift = rng.range(-0.04, 0.04);
    return {
      ...b,
      fog: shift(b.fog, drift),
      ambient: shift(b.ambient, drift),
      hemiSky: shift(b.hemiSky, drift),
      torch: shift(b.torch, drift * 0.5),
      accent: shift(b.accent, drift),
      wall: shift(b.wall, drift * 0.5, 1, rng.range(0.9, 1.1)),
      floor: shift(b.floor, drift * 0.5, 1, rng.range(0.9, 1.1)),
      fogDensity: b.fogDensity * (1 + i * 0.08),
    };
  });
  const lead = biomes[0];
  const accent = shift(lead.accent, rng.range(-0.05, 0.05), 1.1, 1);
  const accent2 = shift(accent, rng.range(0.3, 0.6), 0.9, 0.9);
  const ui: UITheme = {
    accent: hex(accent),
    accent2: hex(accent2),
    bg: hex(shift(lead.fog, 0, 1, 1.2)),
    panel: hex(shift(lead.fog, 0, 0.8, 1.6)),
    border: hex(shift(accent, 0, 0.5, 0.55)),
    text: '#ece4d4',
    dim: '#9a9284',
    headFont: rng.pick(HEAD_FONTS),
    bodyFont: rng.pick(BODY_FONTS),
    frame: rng.pick(['gothic', 'runic', 'arcane', 'bone'] as const),
    ornament: rng.pick(ORNAMENTS),
  };
  const dungeonName = `The ${rng.pick(lead.placeAdj)} ${rng.pick(['Descent', 'Depths', 'Labyrinth', 'Spire Below', 'Undercroft', 'Pit', 'Warrens'])}`;
  return { biomes, ui, dungeonName };
}

export function biomeForDepth(theme: RunTheme, depth: number): Biome {
  return theme.biomes[depth <= 3 ? 0 : depth <= 6 ? 1 : 2];
}
