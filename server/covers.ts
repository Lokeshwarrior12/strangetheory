import { CATEGORIES, CATEGORY_BY_ID } from '../src/lib/categories.js';

function hashStr(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRand(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a 100% unique, deterministic neural/geometric SVG cover per post slug.
 * Never uses stock placeholders; always dark obsidian/navy with brain-region accents.
 */
export function renderProceduralCoverSvg(opts: {
  slug: string;
  title: string;
  categoryId?: string;
  kind: 'experiment' | 'riddle';
  isOg?: boolean;
}): string {
  const cat = (opts.categoryId && CATEGORY_BY_ID.get(opts.categoryId)) || CATEGORIES[0];
  const rand = seededRand(hashStr(opts.slug));
  const width = opts.isOg ? 1200 : 960;
  const height = opts.isOg ? 630 : 540;

  const secondaryColors = ['#22D3EE', '#A78BFA', '#F59E0B', '#38BDF8', '#34D399'];
  const accent2 = secondaryColors[Math.floor(rand() * secondaryColors.length)];
  const patternMode = Math.floor(rand() * 3); // 0: orbital lattice, 1: neural constellation, 2: geometric interference

  const cx = width * (0.45 + rand() * 0.25);
  const cy = height * (0.42 + rand() * 0.16);

  const elements: string[] = [];

  // Concentric calibration rings
  const ringCount = 3 + Math.floor(rand() * 4);
  for (let i = 1; i <= ringCount; i++) {
    const r = 55 * i + rand() * 35;
    const opacity = (0.08 + rand() * 0.14).toFixed(2);
    const dash = i % 2 === 0 ? `stroke-dasharray="${4 + Math.floor(rand() * 8)} ${6 + Math.floor(rand() * 10)}"` : '';
    elements.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${i % 2 === 0 ? cat.color : accent2}" stroke-opacity="${opacity}" stroke-width="1.2" ${dash} />`
    );
  }

  // Constellation / neural nodes + synaptic edges
  const nodeCount = patternMode === 1 ? 26 : 18;
  const pts: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2 + rand() * 0.45;
    const dist = 45 + rand() * Math.min(width, height) * 0.38;
    const x = cx + Math.cos(angle) * dist * 1.25;
    const y = cy + Math.sin(angle) * dist * 0.85;
    pts.push({ x, y, r: 2 + rand() * 4.5 });
  }

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.hypot(dx, dy);
      if (d < 175) {
        const op = ((1 - d / 175) * 0.35).toFixed(2);
        elements.push(
          `<line x1="${pts[i].x.toFixed(1)}" y1="${pts[i].y.toFixed(1)}" x2="${pts[j].x.toFixed(1)}" y2="${pts[j].y.toFixed(1)}" stroke="${j % 2 === 0 ? cat.color : accent2}" stroke-opacity="${op}" stroke-width="1" />`
        );
      }
    }
  }

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const fill = i % 3 === 0 ? accent2 : cat.color;
    if (opts.kind === 'riddle' && i % 4 === 0) {
      const s = p.r * 2.2;
      elements.push(
        `<rect x="${(p.x - s / 2).toFixed(1)}" y="${(p.y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" transform="rotate(${Math.floor(rand() * 60)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})" fill="${fill}" fill-opacity="0.72" />`
      );
    } else {
      elements.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${fill}" fill-opacity="0.78" />`
      );
    }
  }

  // Wave interference curves
  if (patternMode === 2 || opts.kind === 'experiment') {
    for (let w = 0; w < 3; w++) {
      const yBase = height * (0.28 + w * 0.2);
      const amp = 22 + rand() * 32;
      const freq = 0.008 + rand() * 0.008;
      let d = `M 0 ${yBase.toFixed(1)}`;
      for (let x = 20; x <= width; x += 24) {
        const y = yBase + Math.sin(x * freq + w * 1.4) * amp;
        d += ` L ${x} ${y.toFixed(1)}`;
      }
      elements.push(
        `<path d="${d}" fill="none" stroke="${w % 2 === 0 ? cat.color : accent2}" stroke-opacity="0.22" stroke-width="1.3" />`
      );
    }
  }

  const ogOverlay = opts.isOg
    ? `
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#ogFade)" />
      <text x="64" y="96" font-family="ui-monospace, monospace" font-size="20" fill="${cat.color}" letter-spacing="2">STRANGETHEORY · ${escapeXml(cat.brain_region.toUpperCase())}</text>
      <text x="64" y="490" font-family="Georgia, serif" font-size="44" font-weight="600" fill="#F8FAFC">${escapeXml(opts.title.slice(0, 56))}${opts.title.length > 56 ? '...' : ''}</text>
      <text x="64" y="555" font-family="sans-serif" font-size="22" fill="#94A3B8">${escapeXml(cat.name)} · ${opts.kind === 'riddle' ? 'Lateral Riddle' : 'Thought Experiment'}</text>
    `
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <radialGradient id="g1" cx="${((cx / width) * 100).toFixed(0)}%" cy="${((cy / height) * 100).toFixed(0)}%" r="65%">
      <stop offset="0%" stop-color="${cat.color}" stop-opacity="0.28" />
      <stop offset="50%" stop-color="${accent2}" stop-opacity="0.09" />
      <stop offset="100%" stop-color="#070B14" stop-opacity="1" />
    </radialGradient>
    <linearGradient id="ogFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070B14" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#070B14" stop-opacity="0.88" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#070B14" />
  <rect width="${width}" height="${height}" fill="url(#g1)" />
  ${elements.join('\n  ')}
  ${ogOverlay}
</svg>`;
}
