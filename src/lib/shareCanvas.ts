import { APP_NAME } from './config';
import type { CategoryWithCount } from './api';
import type { MyBrainData } from './types';

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:\s]+$/, '')}...`;
  }
  return lines;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string) {
  ctx.fillStyle = '#070B14';
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createRadialGradient(w * 0.82, h * 0.22, 20, w * 0.82, h * 0.22, w * 0.55);
  grad.addColorStop(0, `${accent}33`);
  grad.addColorStop(1, 'rgba(7, 11, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, w - 64, h - 64);
}

export function downloadEntryShareCardPng(opts: {
  slug: string;
  title: string;
  intro: string;
  categoryLabel: string;
  brainRegion: string;
  accentColor: string;
  authorName: string;
  type: 'experiment' | 'riddle';
}) {
  const w = 1200;
  const h = 630;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  drawBackdrop(ctx, w, h, opts.accentColor);

  ctx.fillStyle = opts.accentColor;
  ctx.font = '600 20px ui-monospace, SFMono-Regular, monospace';
  const kindLabel = opts.type === 'riddle' ? 'LATERAL RIDDLE' : 'THOUGHT EXPERIMENT';
  ctx.fillText(`${APP_NAME.toUpperCase()}  ·  ${kindLabel}  ·  ${opts.categoryLabel.toUpperCase()}`, 72, 92);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 50px Georgia, serif';
  const titleLines = wrapLines(ctx, opts.title, w - 144, 3);
  titleLines.forEach((line, i) => {
    ctx.fillText(line, 72, 178 + i * 62);
  });

  const introY = 178 + titleLines.length * 62 + 26;
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '400 25px system-ui, -apple-system, sans-serif';
  const introLines = wrapLines(ctx, opts.intro, w - 144, 3);
  introLines.forEach((line, i) => {
    ctx.fillText(line, 72, introY + i * 36);
  });

  ctx.strokeStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(72, h - 108);
  ctx.lineTo(w - 72, h - 108);
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 20px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`By ${opts.authorName}  ·  ${opts.brainRegion}`, 72, h - 66);

  ctx.fillStyle = opts.accentColor;
  ctx.textAlign = 'right';
  ctx.fillText(opts.type === 'riddle' ? 'Answer sealed on server' : 'strangetheory', w - 72, h - 66);
  ctx.textAlign = 'left';

  downloadCanvas(canvas, `strangetheory-${opts.slug}.png`);
}

export function downloadRiddleResultCardPng(opts: {
  slug: string;
  title: string;
  difficulty: string;
  riddleType: string;
  hintsUsed: number;
  pointsAwarded: number;
  accentColor: string;
}) {
  const w = 1200;
  const h = 630;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  drawBackdrop(ctx, w, h, opts.accentColor);

  ctx.fillStyle = '#34D399';
  ctx.font = '600 22px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`${APP_NAME.toUpperCase()}  ·  RIDDLE SOLVED`, 72, 92);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 46px Georgia, serif';
  const titleLines = wrapLines(ctx, opts.title, w - 144, 2);
  titleLines.forEach((line, i) => {
    ctx.fillText(line, 72, 168 + i * 58);
  });

  const statsY = 330;
  const boxes = [
    { label: 'DIFFICULTY', value: `${opts.difficulty} · ${opts.riddleType}`, color: '#A78BFA' },
    { label: 'HINTS USED', value: `${opts.hintsUsed}`, color: '#FBBF24' },
    { label: 'SYNAPSE EARNED', value: `+${opts.pointsAwarded} Syn`, color: '#22D3EE' },
  ];
  const boxW = (w - 144 - 48) / 3;
  boxes.forEach((b, idx) => {
    const bx = 72 + idx * (boxW + 24);
    ctx.fillStyle = '#0E1525';
    ctx.fillRect(bx, statsY, boxW, 148);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, statsY, boxW, 148);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 16px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(b.label, bx + 24, statsY + 42);

    ctx.fillStyle = b.color;
    ctx.font = '700 32px system-ui, -apple-system, sans-serif';
    ctx.fillText(b.value, bx + 24, statsY + 102);
  });

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 18px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText('Spoiler-free result card — official answer remains sealed until reveal.', 72, h - 66);

  downloadCanvas(canvas, `strangetheory-result-${opts.slug}.png`);
}

export function downloadMyBrainCardPng(opts: {
  displayName: string;
  username: string;
  brainData: MyBrainData;
  categories: CategoryWithCount[];
}) {
  const w = 1200;
  const h = 680;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  drawBackdrop(ctx, w, h, '#22D3EE');

  ctx.fillStyle = '#22D3EE';
  ctx.font = '600 20px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`${APP_NAME.toUpperCase()}  ·  MY COGNITIVE BRAIN MAP`, 72, 86);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 42px Georgia, serif';
  ctx.fillText(opts.displayName, 72, 140);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 20px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`@${opts.username}`, 72, 174);

  // Left side: stylized 10-region cortex diagram
  const cx = 300;
  const cy = 415;
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 178, 152, 0, 0, Math.PI * 2);
  ctx.stroke();

  const activityBySlug = new Map(opts.brainData.region_activity.map((r) => [r.slug, r]));
  const total = Math.max(1, opts.categories.length);
  const pts = opts.categories.map((cat, idx) => {
    const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
    const rx = 128 + (idx % 2 === 0 ? 18 : -14);
    const ry = 108 + (idx % 3 === 0 ? 14 : -10);
    const act = activityBySlug.get(cat.slug);
    return {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      color: cat.color,
      glow: act?.glow || 0,
      label: cat.brain_region,
    };
  });

  ctx.strokeStyle = 'rgba(34, 211, 238, 0.22)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    const opp = pts[(i + 5) % pts.length];
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(opp.x, opp.y);
    ctx.stroke();
  }

  for (const p of pts) {
    if (p.glow > 0) {
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 24 + p.glow * 24);
      g.addColorStop(0, `${p.color}AA`);
      g.addColorStop(1, `${p.color}00`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + p.glow * 24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.glow > 0 ? p.color : '#334155';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 + p.glow * 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Right side: 5 core stats
  const { stats } = opts.brainData;
  const statBoxes = [
    { label: 'ENTRIES READ', value: String(stats.entries_read), color: '#22D3EE' },
    { label: 'RIDDLES SOLVED', value: String(stats.riddles_solved), color: '#A78BFA' },
    { label: 'HINTS USED', value: String(stats.hints_used), color: '#FBBF24' },
    { label: 'CURRENT STREAK', value: `${stats.current_streak}d`, color: '#34D399' },
    { label: 'REGIONS EXPLORED', value: `${stats.regions_explored} / ${stats.total_regions}`, color: '#F8FAFC' },
  ];

  const startX = 560;
  const startY = 230;
  const colW = 272;
  const rowH = 112;
  statBoxes.forEach((sb, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const bx = startX + col * (colW + 20);
    const by = startY + row * (rowH + 18);
    const width = idx === 4 ? colW * 2 + 20 : colW;

    ctx.fillStyle = '#0E1525';
    ctx.fillRect(bx, by, width, rowH);
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, width, rowH);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(sb.label, bx + 20, by + 36);

    ctx.fillStyle = sb.color;
    ctx.font = '700 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(sb.value, bx + 20, by + 84);
  });

  ctx.fillStyle = '#64748B';
  ctx.font = '500 17px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`${APP_NAME} · ${stats.weekly_reads}/${stats.reading_goal_per_week} weekly reading goal`, 72, h - 54);

  downloadCanvas(canvas, `strangetheory-brain-${opts.username}.png`);
}
