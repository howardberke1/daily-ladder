// The climber, as data rather than markup.
//
// Every visible part is driven by a cosmetics object, so adding an option is a
// catalog entry — never a markup edit. renderClimber() returns SVG markup with
// the class names the animation CSS hooks into (.rig, .c-arm-l, .c-leg-r, etc),
// so poses/animations keep working regardless of what's being worn.
//
// Coordinate space is viewBox "0 0 42 62": head around y=8, hips y=38, feet y=58.

/* ---------------- palettes ---------------- */

const SKIN = ["#f4d5b8", "#e8bd94", "#d19d6f", "#a9714b", "#7a4a2e", "#4e2f1c"];
const HAIR_COLORS = ["#2b2118", "#5c3a21", "#9c6b3f", "#d4a94f", "#b04a2f", "#8a8f98"];
const GARMENT = ["#c0503a", "#3d5a80", "#4a7a4e", "#8458c9", "#d8a02c", "#2f3640", "#c96f9c", "#2d8a8f"];
const PANTS = ["#3a4250", "#5c4a38", "#2b2f38", "#6b5a7a", "#4a5c3a", "#7a4a3a"];
const BOOTS = ["#26221c", "#5a3a24", "#3a3f4a", "#7a2f2f"];
const GLOVES = ["#3a3f4a", "#26221c", "#c0503a", "#d8a02c"];
const PACK = ["#c9603f", "#3a5a44", "#2c3e5e", "#6b4a7a", "#8a7a3a", "#4a4a52"];

/**
 * The customization catalog. `kind: "style"` options change shape;
 * `kind: "color"` options change a fill. Everything the UI renders comes
 * from here — the customizer has no hardcoded knowledge of the character.
 */
export const CATALOG = [
  { id: "skin",        label: "Skin",      kind: "color", colors: SKIN },
  { id: "hair",        label: "Hair",      kind: "style", options: [
      { id: "short",    label: "Short" },
      { id: "swept",    label: "Swept" },
      { id: "long",     label: "Long" },
      { id: "ponytail", label: "Ponytail" },
      { id: "bun",      label: "Bun" },
      { id: "buzz",     label: "Buzz" },
      { id: "bald",     label: "None" },
    ] },
  { id: "hairColor",   label: "Hair color", kind: "color", colors: HAIR_COLORS },
  { id: "headgear",    label: "Headgear",  kind: "style", options: [
      { id: "helmet",   label: "Climb helmet" },
      { id: "lamp",     label: "Headlamp helmet" },
      { id: "brim",     label: "Wide brim" },
      { id: "beanie",   label: "Beanie" },
      { id: "cap",      label: "Cap" },
      { id: "none",     label: "Bare head" },
    ] },
  { id: "headgearColor", label: "Headgear color", kind: "color", colors: GARMENT },
  { id: "top",         label: "Top",       kind: "style", options: [
      { id: "jacket",   label: "Jacket" },
      { id: "vest",     label: "Vest" },
      { id: "tee",      label: "Tee" },
      { id: "hoodie",   label: "Hoodie" },
    ] },
  { id: "topColor",    label: "Top color", kind: "color", colors: GARMENT },
  { id: "pantsColor",  label: "Pants",     kind: "color", colors: PANTS },
  { id: "bootsColor",  label: "Boots",     kind: "color", colors: BOOTS },
  { id: "glovesColor", label: "Gloves",    kind: "color", colors: GLOVES },
  { id: "pack",        label: "Pack",      kind: "style", options: [
      { id: "backpack", label: "Backpack" },
      { id: "roll",     label: "Roll top" },
      { id: "sling",    label: "Sling" },
      { id: "none",     label: "No pack" },
    ] },
  { id: "packColor",   label: "Pack color", kind: "color", colors: PACK },
  { id: "accessory",   label: "Extra",     kind: "style", options: [
      { id: "none",     label: "None" },
      { id: "goggles",  label: "Goggles" },
      { id: "scarf",    label: "Scarf" },
      { id: "beard",    label: "Beard" },
      { id: "shades",   label: "Shades" },
      { id: "flag",     label: "Summit flag" },
    ] },
];

export const DEFAULTS = {
  skin: SKIN[0],
  hair: "short",
  hairColor: HAIR_COLORS[0],
  headgear: "helmet",
  headgearColor: GARMENT[4],
  top: "jacket",
  topColor: GARMENT[1],
  pantsColor: PANTS[0],
  bootsColor: BOOTS[0],
  glovesColor: GLOVES[0],
  pack: "backpack",
  packColor: PACK[0],
  accessory: "none",
};

/** Fills gaps and drops unknown keys, so old saves never render a broken climber. */
export function normalize(cos = {}) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (cos[key] != null) out[key] = cos[key];
  }
  return out;
}

export function randomCosmetics() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const out = {};
  for (const part of CATALOG) {
    out[part.id] = part.kind === "color"
      ? pick(part.colors)
      : pick(part.options).id;
  }
  return out;
}

/* ---------------- part renderers ---------------- */

const INK = "#20222e";

function hair(c) {
  const f = c.hairColor;
  switch (c.hair) {
    case "buzz":
      return `<path d="M14.4 7.4 A6.6 6.6 0 0 1 27.6 7.4 Z" fill="${f}" opacity="0.9"/>`;
    case "swept":
      return `<path d="M14.4 7.6 A6.6 6.6 0 0 1 27.6 7.2 Q24 3.4 18 4.6 Q15 5.2 14.4 7.6 Z" fill="${f}"/>
              <path d="M27.4 6.2 Q31.4 4.6 30.2 2.2 Q28 4.4 25.6 4.4 Z" fill="${f}"/>`;
    case "long":
      return `<path d="M13.6 8 Q13 18 15.4 21 L17.6 21 Q15.6 16.4 16 9 Z" fill="${f}"/>
              <path d="M28.4 8 Q29 18 26.6 21 L24.4 21 Q26.4 16.4 26 9 Z" fill="${f}"/>
              <path d="M14.4 7.8 A6.6 6.6 0 0 1 27.6 7.8 Z" fill="${f}"/>`;
    case "ponytail":
      return `<path d="M14.4 7.6 A6.6 6.6 0 0 1 27.6 7.6 Z" fill="${f}"/>
              <path d="M27.8 6.6 Q33.4 8.4 32.6 15 Q31.6 18.4 29.4 18.6 Q31.6 14 30.2 9.6 Q29.4 7.6 27.4 8.6 Z" fill="${f}"/>`;
    case "bun":
      return `<path d="M14.4 7.6 A6.6 6.6 0 0 1 27.6 7.6 Z" fill="${f}"/>
              <circle cx="29.6" cy="3.6" r="2.8" fill="${f}"/>`;
    case "bald":
      return "";
    default: // short
      return `<path d="M14.2 8 A6.8 6.8 0 0 1 27.8 8 Q27.4 4.6 21 4.2 Q14.8 4.4 14.2 8 Z" fill="${f}"/>`;
  }
}

function headgear(c) {
  const f = c.headgearColor;
  const dark = shade(f, -0.28);
  switch (c.headgear) {
    case "none":
      return "";
    case "brim":
      return `<ellipse cx="21" cy="6.4" rx="10.6" ry="2.4" fill="${dark}"/>
              <path d="M15.6 6.4 A5.6 5.6 0 0 1 26.4 6.4 Z" fill="${f}"/>
              <rect x="15.4" y="5.4" width="11.2" height="1.6" rx="0.8" fill="${dark}"/>`;
    case "beanie":
      return `<path d="M14 7.4 A7 7 0 0 1 28 7.4 Z" fill="${f}"/>
              <rect x="13.6" y="6.6" width="14.8" height="2.6" rx="1.3" fill="${dark}"/>
              <circle cx="21" cy="0.6" r="1.8" fill="${dark}"/>`;
    case "cap":
      return `<path d="M14.2 7 A6.8 6.8 0 0 1 27.8 7 Z" fill="${f}"/>
              <path d="M27.4 7 Q33.6 7 33.4 5.2 L27.4 5.2 Z" fill="${dark}"/>
              <rect x="14" y="6.2" width="14" height="1.6" rx="0.8" fill="${dark}"/>`;
    case "lamp":
      return `<path d="M14 7 A7 7 0 0 1 28 7 L28 8 L14 8 Z" fill="${f}"/>
              <rect x="13.6" y="6.6" width="14.8" height="2.4" rx="1.2" fill="${dark}"/>
              <polygon class="lamp-cone" points="28,7 42,0 42,14" fill="rgba(255,244,200,0.22)"/>
              <circle class="c-lamp" cx="28" cy="7" r="1.9" fill="#fff8dc"/>`;
    default: // helmet
      return `<path d="M14 7 A7 7 0 0 1 28 7 L28 8 L14 8 Z" fill="${f}"/>
              <rect x="13.6" y="6.6" width="14.8" height="2.4" rx="1.2" fill="${dark}"/>
              <path d="M17.4 1.8 L18.6 6.8 M24.6 1.8 L23.4 6.8" stroke="${dark}" stroke-width="0.8" opacity="0.7"/>`;
  }
}

function top(c) {
  const f = c.topColor;
  const dark = shade(f, -0.22);
  switch (c.top) {
    case "vest":
      return `<rect x="15" y="14" width="12" height="24" rx="5" fill="${c.skin}"/>
              <path d="M15 19 Q15 14 20 14 L22 14 Q27 14 27 19 L27 33 Q27 38 22 38 L20 38 Q15 38 15 33 Z" fill="${f}"/>
              <rect x="20" y="14" width="2" height="24" fill="${dark}" opacity="0.5"/>`;
    case "tee":
      return `<rect x="15" y="14" width="12" height="24" rx="5" fill="${c.skin}"/>
              <path d="M15 19 Q15 14 21 14 Q27 14 27 19 L27 28 L15 28 Z" fill="${f}"/>`;
    case "hoodie":
      return `<rect x="15" y="13.4" width="12" height="24.6" rx="5" fill="${f}"/>
              <path d="M15.6 14 Q21 19.4 26.4 14 Q26.4 11.6 21 11.6 Q15.6 11.6 15.6 14 Z" fill="${dark}"/>
              <rect x="18" y="28" width="6" height="4" rx="2" fill="${dark}" opacity="0.6"/>`;
    default: // jacket
      return `<rect x="15" y="14" width="12" height="24" rx="5" fill="${f}"/>
              <rect x="20.4" y="14" width="1.2" height="24" fill="${dark}"/>
              <rect x="15" y="24" width="12" height="1.4" fill="${dark}" opacity="0.55"/>`;
  }
}

function pack(c) {
  const f = c.packColor;
  const light = shade(f, 0.22);
  switch (c.pack) {
    case "none":
      return "";
    case "sling":
      return `<path d="M16 15 L26 34 L23 35.4 L13.6 17 Z" fill="${f}"/>
              <rect x="23" y="30" width="8" height="9" rx="3" fill="${f}"/>`;
    case "roll":
      return `<rect x="11" y="16" width="20" height="22" rx="4" fill="${f}"/>
              <rect x="11" y="14.4" width="20" height="4.4" rx="2.2" fill="${light}"/>
              <rect x="14" y="26" width="14" height="1.6" rx="0.8" fill="${light}" opacity="0.7"/>`;
    default: // backpack
      return `<rect x="11" y="17" width="20" height="21" rx="6" fill="${f}"/>
              <rect x="14" y="20" width="14" height="7" rx="3" fill="${light}"/>`;
  }
}

function accessory(c) {
  switch (c.accessory) {
    case "goggles":
      return `<rect x="14.2" y="6.6" width="13.6" height="3.6" rx="1.8" fill="#2f3640" opacity="0.9"/>
              <rect x="15.4" y="7.2" width="4.6" height="2.4" rx="1.2" fill="#7fd8e8"/>
              <rect x="22" y="7.2" width="4.6" height="2.4" rx="1.2" fill="#7fd8e8"/>`;
    case "shades":
      return `<rect x="15.4" y="7" width="4.8" height="3" rx="1.2" fill="#20222e"/>
              <rect x="21.8" y="7" width="4.8" height="3" rx="1.2" fill="#20222e"/>
              <rect x="20.2" y="8" width="1.6" height="0.8" fill="#20222e"/>`;
    case "scarf":
      return `<rect x="14.6" y="13" width="12.8" height="3.4" rx="1.7" fill="#c0503a"/>
              <path d="M25.6 15.4 L29.4 22 L26.4 22.8 L23.6 16.4 Z" fill="#c0503a"/>`;
    case "beard":
      return `<path d="M15.4 9.4 Q15.8 15.6 21 15.6 Q26.2 15.6 26.6 9.4 Q24 12.6 21 12.6 Q18 12.6 15.4 9.4 Z" fill="${shade("#3a2a1e", 0)}"/>`;
    case "flag":
      return `<rect x="30.4" y="14" width="1" height="16" fill="#8a8f98"/>
              <path d="M31.4 14.6 L38 17 L31.4 19.4 Z" fill="#c0503a"/>`;
    default:
      return "";
  }
}

/* ---------------- the rig ---------------- */

/**
 * @param {object} cos    cosmetics (partial is fine — gaps use defaults)
 * @param {object} [opts] { id, className } for the wrapping <svg>
 * @returns {string} SVG markup
 */
export function renderClimber(cos, opts = {}) {
  const c = normalize(cos);
  const id = opts.id ? ` id="${opts.id}"` : "";
  const cls = opts.className ?? "climber";

  return `<svg${id} class="${cls}" viewBox="0 0 42 62" aria-hidden="true">
  <g class="rig">
    ${pack(c)}
    <polyline class="c-limb c-arm-l" points="18,22 9,16 5,7" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline class="c-limb c-arm-r" points="24,22 33,16 37,7" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="c-glove c-glove-l" cx="5" cy="7" r="2.2" fill="${c.glovesColor}"/>
    <circle class="c-glove c-glove-r" cx="37" cy="7" r="2.2" fill="${c.glovesColor}"/>
    ${top(c)}
    <polyline class="c-limb c-leg-l" points="18.4,37 13,45 14.4,54" fill="none" stroke="${c.pantsColor}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline class="c-limb c-leg-r" points="23.6,37 29,45 27.6,54" fill="none" stroke="${c.pantsColor}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect class="c-boot c-boot-l" x="10.6" y="53" width="8" height="4.2" rx="2" fill="${c.bootsColor}"/>
    <rect class="c-boot c-boot-r" x="23.4" y="53" width="8" height="4.2" rx="2" fill="${c.bootsColor}"/>
    <circle class="c-head" cx="21" cy="8" r="6.6" fill="${c.skin}"/>
    ${hair(c)}
    <circle class="c-eye" cx="18.6" cy="8" r="1" fill="${INK}"/>
    <circle class="c-eye" cx="23.4" cy="8" r="1" fill="${INK}"/>
    <path class="c-mouth" d="M19.2 11.2 Q21 12.6 22.8 11.2" fill="none" stroke="${INK}" stroke-width="0.9" stroke-linecap="round"/>
    ${headgear(c)}
    ${accessory(c)}
  </g>
</svg>`;
}

/* ---------------- helpers ---------------- */

/** Lighten (+) or darken (−) a hex color. Used for straps, brims, seams. */
function shade(hex, amount) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amount >= 0) {
    r = clamp(r + (255 - r) * amount);
    g = clamp(g + (255 - g) * amount);
    b = clamp(b + (255 - b) * amount);
  } else {
    r = clamp(r * (1 + amount));
    g = clamp(g * (1 + amount));
    b = clamp(b * (1 + amount));
  }
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
