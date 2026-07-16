// The worlds, as authored vector scenery.
//
// Each world is built from four silhouette layers plus sky and foreground.
// Depth comes from atmospheric perspective: distant layers are lighter, hazier
// and lower-contrast; near layers are dark and sharp. That — not palette — is
// what makes these read as places rather than gradients.
//
// Crucially, each world uses a different *silhouette generator*, so the
// geometry itself differs: jagged peaks vs flat-topped mesas vs hard
// rectilinear towers vs rounded canopy. Recolor any of them and they'd still
// be obviously different places, which is the whole point.
//
// Scenery is deterministic per puzzle number — everyone climbing today's
// ladder sees the same mountain, and it's stable across reloads.

/* ---------------- deterministic noise ---------------- */

/** Mulberry32 — small, fast, seedable. Same seed, same landscape, forever. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1000; // layer viewBox width; height varies per layer

/* ---------------- silhouette generators ---------------- */
// Each returns { path, accents } in a 0..W × 0..H box, baseline at H.

/** Sharp alpine peaks. Irregular, asymmetric, snow-capped. */
function jagged(rand, H, { peaks = 5, roughness = 0.55, snow = false } = {}) {
  const pts = [[0, H]];
  const step = W / peaks;
  const accents = [];
  let x = 0;
  pts.push([0, H * (0.45 + rand() * 0.3)]);

  for (let i = 0; i < peaks; i++) {
    const peakX = x + step * (0.3 + rand() * 0.4);
    const peakY = H * (0.04 + rand() * roughness * 0.5);
    const valleyX = x + step * (0.75 + rand() * 0.2);
    const valleyY = H * (0.5 + rand() * 0.35);

    // a shoulder partway up keeps ridges from being clean triangles
    pts.push([peakX - step * 0.16, H * (peakY / H + 0.16 + rand() * 0.1)]);
    pts.push([peakX, peakY]);
    if (snow && peakY < H * 0.3) {
      const w = step * 0.13;
      accents.push(
        `<path d="M${peakX} ${peakY} L${peakX + w} ${peakY + H * 0.11} ` +
        `L${peakX + w * 0.3} ${peakY + H * 0.08} L${peakX - w * 0.35} ${peakY + H * 0.12} ` +
        `L${peakX - w} ${peakY + H * 0.1} Z" fill="#eef2fa" opacity="0.82"/>`
      );
    }
    pts.push([peakX + step * 0.2, H * (peakY / H + 0.2 + rand() * 0.12)]);
    pts.push([valleyX, valleyY]);
    x += step;
  }
  pts.push([W, H * (0.4 + rand() * 0.3)]);
  pts.push([W, H]);
  return { path: `M${pts.map((p) => p.map(Math.round).join(" ")).join(" L")} Z`, accents };
}

/** Desert mesas: flat tops, hard vertical cliff walls, talus at the base. */
function mesa(rand, H, { count = 4 } = {}) {
  const pts = [[0, H]];
  const accents = [];
  let x = 0;
  const step = W / count;

  for (let i = 0; i < count; i++) {
    const gap = step * (0.1 + rand() * 0.16);
    const width = step - gap;
    const top = H * (0.12 + rand() * 0.45);
    const x0 = x + gap * 0.5;
    const x1 = x0 + width;

    pts.push([x0, H]);
    pts.push([x0 + width * 0.03, top]);        // near-vertical cliff face
    pts.push([x1 - width * 0.03, top]);        // dead-flat plateau
    // a stepped ledge on some mesas
    if (rand() > 0.5) {
      const ledgeY = top + H * (0.14 + rand() * 0.12);
      pts.push([x1, ledgeY]);
      pts.push([x1 + width * 0.12, ledgeY]);
      pts.push([x1 + width * 0.14, H]);
      accents.push(
        `<rect x="${Math.round(x0 + width * 0.1)}" y="${Math.round(top + H * 0.06)}" ` +
        `width="${Math.round(width * 0.8)}" height="2" fill="#000" opacity="0.13"/>`
      );
    } else {
      pts.push([x1, H]);
    }
    x += step;
  }
  pts.push([W, H]);
  return { path: `M${pts.map((p) => p.map(Math.round).join(" ")).join(" L")} Z`, accents };
}

/** City towers: pure rectangles, varied heights, lit window grids. */
function city(rand, H, { count = 9, lit = true } = {}) {
  const pts = [[0, H]];
  const accents = [];
  let x = 0;

  while (x < W) {
    const width = W / count * (0.55 + rand() * 0.75);
    const top = H * (0.06 + rand() * 0.68);
    pts.push([x, H], [x, top], [x + width, top], [x + width, H]);

    if (lit && rand() > 0.25) {
      const cols = Math.max(1, Math.floor(width / 22));
      const rows = Math.max(1, Math.floor((H - top) / 26));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rand() > 0.62) {
            accents.push(
              `<rect x="${Math.round(x + 8 + c * 22)}" y="${Math.round(top + 12 + r * 26)}" ` +
              `width="6" height="8" fill="var(--w-accent)" opacity="${(0.25 + rand() * 0.5).toFixed(2)}"/>`
            );
          }
        }
      }
    }
    // antenna + aircraft warning light on the tall ones
    if (top < H * 0.22 && rand() > 0.5) {
      const ax = Math.round(x + width / 2);
      accents.push(
        `<rect x="${ax}" y="${Math.round(top - H * 0.1)}" width="2" height="${Math.round(H * 0.1)}" fill="currentColor" opacity="0.7"/>`,
        `<circle class="beacon" cx="${ax + 1}" cy="${Math.round(top - H * 0.1)}" r="3" fill="#ff5a5a"/>`
      );
    }
    x += width + W / count * (0.06 + rand() * 0.1);
  }
  pts.push([W, H]);
  return { path: `M${pts.map((p) => p.map(Math.round).join(" ")).join(" L")} Z`, accents };
}

/** Forest canopy: overlapping conifer cones, organic and soft-edged. */
function canopy(rand, H, { count = 14 } = {}) {
  let d = `M0 ${H} L0 ${Math.round(H * 0.72)}`;
  const step = W / count;
  for (let i = 0; i < count; i++) {
    const cx = i * step + step * (0.2 + rand() * 0.6);
    const top = H * (0.1 + rand() * 0.5);
    const half = step * (0.4 + rand() * 0.35);
    d += ` L${Math.round(cx - half)} ${Math.round(H * (0.62 + rand() * 0.2))}`;
    d += ` L${Math.round(cx - half * 0.5)} ${Math.round(top + H * 0.16)}`;
    d += ` L${Math.round(cx)} ${Math.round(top)}`;
    d += ` L${Math.round(cx + half * 0.5)} ${Math.round(top + H * 0.16)}`;
    d += ` L${Math.round(cx + half)} ${Math.round(H * (0.62 + rand() * 0.2))}`;
  }
  d += ` L${W} ${Math.round(H * 0.7)} L${W} ${H} Z`;
  return { path: d, accents: [] };
}

/** Volcanic: broken, fractured shards with lava fissures. */
function volcanic(rand, H, { peaks = 4, glow = false } = {}) {
  const base = jagged(rand, H, { peaks, roughness: 0.9 });
  const accents = [];
  if (glow) {
    for (let i = 0; i < 5; i++) {
      const x = rand() * W;
      const y = H * (0.4 + rand() * 0.5);
      accents.push(
        `<path d="M${Math.round(x)} ${Math.round(y)} q${Math.round(rand() * 24 - 12)} ${Math.round(H * 0.14)} ` +
        `${Math.round(rand() * 30 - 15)} ${Math.round(H * 0.3)}" stroke="#ff7a3a" stroke-width="${(1 + rand() * 2).toFixed(1)}" ` +
        `fill="none" opacity="${(0.35 + rand() * 0.4).toFixed(2)}"/>`
      );
    }
  }
  return { path: base.path, accents };
}

/** Cloud shelves for the sky world — soft, horizontal, stacked. */
function shelves(rand, H, { count = 5 } = {}) {
  const accents = [];
  for (let i = 0; i < count; i++) {
    const cy = H * (0.2 + rand() * 0.7);
    const cw = W * (0.22 + rand() * 0.4);
    const cx = rand() * (W - cw);
    const ch = H * (0.08 + rand() * 0.06);
    accents.push(
      `<rect x="${Math.round(cx)}" y="${Math.round(cy)}" width="${Math.round(cw)}" height="${Math.round(ch)}" ` +
      `rx="${Math.round(ch / 2)}" fill="currentColor" opacity="0.55"/>`,
      `<ellipse cx="${Math.round(cx + cw * 0.3)}" cy="${Math.round(cy + ch * 0.2)}" rx="${Math.round(cw * 0.2)}" ` +
      `ry="${Math.round(ch * 0.85)}" fill="currentColor" opacity="0.5"/>`,
      `<ellipse cx="${Math.round(cx + cw * 0.62)}" cy="${Math.round(cy + ch * 0.25)}" rx="${Math.round(cw * 0.15)}" ` +
      `ry="${Math.round(ch * 0.7)}" fill="currentColor" opacity="0.45"/>`
    );
  }
  return { path: "", accents };
}

const GENERATORS = { jagged, mesa, city, canopy, volcanic, shelves };

/* ---------------- world definitions ---------------- */

export const WORLDS = [
  {
    id: "summit",
    particle: "snow",
    sky: ["#101a36", "#38416e", "#8f5878", "#e29a72"],
    layers: [
      { gen: "jagged", opts: { peaks: 7, roughness: 0.4, snow: true }, fill: "#6b6894", opacity: 0.45, h: 300, depth: 0.12 },
      { gen: "jagged", opts: { peaks: 5, roughness: 0.6, snow: true }, fill: "#4a4676", opacity: 0.8, h: 380, depth: 0.24 },
      { gen: "jagged", opts: { peaks: 4, roughness: 0.75 }, fill: "#2c2950", opacity: 1, h: 440, depth: 0.42 },
      { gen: "jagged", opts: { peaks: 3, roughness: 0.9 }, fill: "#171530", opacity: 1, h: 380, depth: 0.68 },
    ],
  },
  {
    id: "skyreach",
    particle: "cloud",
    sky: ["#0d2f5c", "#2f6ea8", "#7fb4d8", "#e8d5a8"],
    layers: [
      { gen: "shelves", opts: { count: 6 }, fill: "#ffffff", opacity: 0.32, h: 420, depth: 0.1 },
      { gen: "jagged", opts: { peaks: 6, roughness: 0.35, snow: true }, fill: "#8fb2cf", opacity: 0.5, h: 260, depth: 0.22 },
      { gen: "shelves", opts: { count: 4 }, fill: "#ffffff", opacity: 0.55, h: 380, depth: 0.4 },
      { gen: "jagged", opts: { peaks: 3, roughness: 0.8, snow: true }, fill: "#3f5f80", opacity: 1, h: 400, depth: 0.66 },
    ],
  },
  {
    id: "neon",
    particle: "rain",
    sky: ["#04060e", "#0c1428", "#1b2c4e", "#2e4670"],
    layers: [
      { gen: "city", opts: { count: 13, lit: true }, fill: "#101a33", opacity: 0.7, h: 320, depth: 0.12 },
      { gen: "city", opts: { count: 9, lit: true }, fill: "#0c1428", opacity: 0.9, h: 400, depth: 0.26 },
      { gen: "city", opts: { count: 7, lit: true }, fill: "#070d1c", opacity: 1, h: 460, depth: 0.45 },
      { gen: "city", opts: { count: 5, lit: false }, fill: "#03060d", opacity: 1, h: 380, depth: 0.7 },
    ],
  },
  {
    id: "dunes",
    particle: "sand",
    sky: ["#4a2258", "#a84a52", "#e08447", "#f4c778"],
    layers: [
      { gen: "mesa", opts: { count: 6 }, fill: "#9c5a58", opacity: 0.45, h: 260, depth: 0.12 },
      { gen: "mesa", opts: { count: 4 }, fill: "#8a4448", opacity: 0.75, h: 340, depth: 0.25 },
      { gen: "mesa", opts: { count: 3 }, fill: "#5e2c38", opacity: 1, h: 420, depth: 0.44 },
      { gen: "mesa", opts: { count: 2 }, fill: "#341823", opacity: 1, h: 360, depth: 0.7 },
    ],
  },
  {
    id: "forest",
    particle: "firefly",
    sky: ["#0a1f2c", "#1c4a4e", "#4a7a5e", "#c8b06a"],
    layers: [
      { gen: "jagged", opts: { peaks: 6, roughness: 0.4 }, fill: "#5a8072", opacity: 0.4, h: 260, depth: 0.12 },
      { gen: "canopy", opts: { count: 18 }, fill: "#31614e", opacity: 0.8, h: 300, depth: 0.26 },
      { gen: "canopy", opts: { count: 12 }, fill: "#1c3f34", opacity: 1, h: 380, depth: 0.46 },
      { gen: "canopy", opts: { count: 8 }, fill: "#0d241f", opacity: 1, h: 420, depth: 0.72 },
    ],
  },
  {
    id: "ember",
    particle: "ember",
    sky: ["#1a0808", "#4a1410", "#8a2c18", "#d4552a"],
    layers: [
      { gen: "volcanic", opts: { peaks: 6 }, fill: "#7a3020", opacity: 0.45, h: 280, depth: 0.12 },
      { gen: "volcanic", opts: { peaks: 4, glow: true }, fill: "#4e1c14", opacity: 0.85, h: 380, depth: 0.26 },
      { gen: "volcanic", opts: { peaks: 3, glow: true }, fill: "#2a0e0c", opacity: 1, h: 440, depth: 0.46 },
      { gen: "volcanic", opts: { peaks: 2, glow: true }, fill: "#150605", opacity: 1, h: 380, depth: 0.72 },
    ],
  },
];

export function worldFor(number) {
  const i = ((number - 1) % WORLDS.length + WORLDS.length) % WORLDS.length;
  return WORLDS[i];
}

export function randomWorld() {
  return WORLDS[Math.floor(Math.random() * WORLDS.length)];
}

/* ---------------- rendering ---------------- */

/**
 * Builds the full scenery for a world.
 * @returns {{sky: string, layers: Array<{svg: string, depth: number}>}}
 */
export function renderWorld(world, seed = 1) {
  const rand = rng(seed * 7919 + world.id.charCodeAt(0) * 131);

  const sky =
    `<svg class="w-sky-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs><linearGradient id="sky-${world.id}" x1="0" y1="0" x2="0" y2="1">` +
    world.sky.map((c, i) =>
      `<stop offset="${(i / (world.sky.length - 1)).toFixed(2)}" stop-color="${c}"/>`
    ).join("") +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#sky-${world.id})"/></svg>`;

  const layers = world.layers.map((layer) => {
    const gen = GENERATORS[layer.gen];
    const { path, accents } = gen(rand, layer.h, layer.opts ?? {});
    const body = path
      ? `<path d="${path}" fill="${layer.fill}" opacity="${layer.opacity}"/>`
      : "";
    return {
      depth: layer.depth,
      svg:
        `<svg class="w-layer-svg" viewBox="0 0 ${W} ${layer.h}" preserveAspectRatio="none" ` +
        `style="color:${layer.fill}" aria-hidden="true">${body}` +
        `<g opacity="${layer.opacity}">${accents.join("")}</g></svg>`,
    };
  });

  return { sky, layers };
}
