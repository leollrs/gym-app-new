/**
 * ShareCardRenderer v4 — Premium viral share cards.
 *
 * Apple Fitness × Nike Run Club aesthetic.
 * One hero stat. One emotional hook. Brand stamp. Done.
 */

const STORY = { w: 1080, h: 1920 };
const FEED  = { w: 1080, h: 1080 };

const C = {
  bg:    '#050608',
  bg2:   '#0B0E14',
  gold:  '#D4AF37',
  gold2: '#C4A030',
  white: '#FFFFFF',
  t1:    '#F3F4F6',
  t2:    '#A0A8B8',
  t3:    '#4B5563',
  glow:  'rgba(212,175,55,',
};

const F = '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const ff = (w, s) => `${w} ${s}px ${F}`;

// ── Primitives ──────────────────────────────────────────────────────────────

function txt(ctx, t, x, y, o = {}) {
  ctx.font = o.font || ff(400, 16);
  ctx.fillStyle = o.color || C.white;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'top';
  o.maxW ? ctx.fillText(t, x, y, o.maxW) : ctx.fillText(t, x, y);
}

function spaced(ctx, t, x, y, o = {}) {
  const sp = o.spacing || 5;
  ctx.font = o.font || ff(600, 14);
  ctx.fillStyle = o.color || C.gold;
  ctx.textBaseline = 'top';
  const chars = t.split('');
  const total = chars.reduce((s, c) => s + ctx.measureText(c).width + sp, -sp);
  let cx = (o.align === 'left') ? x : x - total / 2;
  ctx.textAlign = 'left';
  chars.forEach(c => { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + sp; });
}

function trunc(t, n) { return !t ? '' : t.length > n ? t.slice(0, n - 1) + '…' : t; }
function fmtV(v) { if (!v) return '0'; return v >= 10000 ? `${(v/1000).toFixed(1)}k` : v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${Math.round(v)}`; }
function fmtD(s) { if (!s) return '0m'; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h ? `${h}h ${m}m` : `${m}m`; }

function loadImg(url) {
  return new Promise(r => {
    if (!url) return r(null);
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => r(i); i.onerror = () => r(null); i.src = url;
  });
}

// ── Background ──────────────────────────────────────────────────────────────

function drawBg(ctx, w, h) {
  // Base
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.bg2); g.addColorStop(0.4, '#070A10'); g.addColorStop(1, C.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Cinematic top glow
  const g1 = ctx.createRadialGradient(w * 0.5, h * 0.22, 0, w * 0.5, h * 0.22, w * 0.7);
  g1.addColorStop(0, C.glow + '0.09)');
  g1.addColorStop(0.4, C.glow + '0.03)');
  g1.addColorStop(1, 'transparent');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, w, h);

  // Vignette
  const v = ctx.createRadialGradient(w/2, h/2, w*0.25, w/2, h/2, w);
  v.addColorStop(0, 'transparent'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

// ── Visual element: abstract glow pulse behind hero ─────────────────────────

function drawHeroGlow(ctx, cx, cy, size) {
  // Outer ring
  ctx.save();
  ctx.strokeStyle = C.glow + '0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, size * 1.3, 0, Math.PI * 2); ctx.stroke();
  // Inner ring
  ctx.strokeStyle = C.glow + '0.10)';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.95, 0, Math.PI * 2); ctx.stroke();
  // Core glow
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
  rg.addColorStop(0, C.glow + '0.14)');
  rg.addColorStop(0.5, C.glow + '0.04)');
  rg.addColorStop(1, 'transparent');
  ctx.fillStyle = rg;
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.restore();
}

// ── Visual element: subtle abstract wave ────────────────────────────────────

function drawWave(ctx, w, h, yPos) {
  ctx.save();
  ctx.strokeStyle = C.glow + '0.05)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, yPos);
  for (let x = 0; x <= w; x += 4) {
    const y = yPos + Math.sin(x * 0.006) * 20 + Math.sin(x * 0.015) * 8;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ── Hero stat render ────────────────────────────────────────────────────────

function drawHero(ctx, value, label, cx, y, fontSize) {
  // Glow behind text
  ctx.save();
  ctx.font = ff(900, fontSize);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.shadowColor = C.gold; ctx.shadowBlur = 40;
  ctx.fillStyle = C.gold; ctx.globalAlpha = 0.3;
  ctx.fillText(value, cx, y);
  ctx.fillText(value, cx, y); // double pass for stronger glow
  ctx.restore();
  // Crisp text
  txt(ctx, value, cx, y, { font: ff(900, fontSize), color: C.white });
  // Label below
  const labelY = y + fontSize * 0.85 + 8;
  spaced(ctx, label, cx, labelY, { font: ff(700, 18), color: C.gold, spacing: 8 });
  return labelY + 30;
}

// ── Stat row: minimal, clean ────────────────────────────────────────────────

function drawStats(ctx, cx, y, stats) {
  const count = stats.length;
  const gap = 100;
  const slotW = 120;
  const totalW = count * slotW + (count - 1) * gap;
  const startX = cx - totalW / 2;

  stats.forEach((s, i) => {
    const sx = startX + i * (slotW + gap) + slotW / 2;
    // Value
    txt(ctx, s.value, sx, y, { font: ff(700, 40), color: C.t1 });
    // Label
    txt(ctx, s.label, sx, y + 50, { font: ff(500, 18), color: C.t3 });

    // Gold dot divider
    if (i < count - 1) {
      const dx = sx + slotW / 2 + gap / 2;
      ctx.beginPath();
      ctx.arc(dx, y + 26, 3, 0, Math.PI * 2);
      ctx.fillStyle = C.glow + '0.35)';
      ctx.fill();
    }
  });

  return y + 80;
}

// ── Achievement pill ────────────────────────────────────────────────────────

function drawAchievement(ctx, cx, y, text, w) {
  const pillW = Math.min(w - 100, 760);
  const px = cx - pillW / 2;
  const ph = 68;

  // Pill bg
  ctx.save();
  const prr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  };
  prr(px, y, pillW, ph, ph / 2);
  ctx.fillStyle = C.glow + '0.08)';
  ctx.fill();
  prr(px, y, pillW, ph, ph / 2);
  ctx.strokeStyle = C.glow + '0.20)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Text
  txt(ctx, text, cx, y + 20, { font: ff(600, 24), color: C.gold, maxW: pillW - 48 });

  return y + ph + 24;
}

// ── Brand stamp footer ──────────────────────────────────────────────────────

function drawBrand(ctx, w, h, { gymName, gymLogo, userName }) {
  let y = h - 48;

  // "Tracked with TuGymPR"
  txt(ctx, 'Tracked with TuGymPR', w / 2, y, { font: ff(400, 13), color: C.t3 });
  y -= 36;

  // User name
  if (userName) {
    txt(ctx, userName, w / 2, y, { font: ff(500, 18), color: C.t2 });
    y -= 32;
  }

  // Gym name
  if (gymName) {
    txt(ctx, gymName, w / 2, y, { font: ff(700, 24), color: C.t1 });
    y -= 40;
  }

  // Gym logo
  if (gymLogo) {
    const lh = 56;
    const lw = (gymLogo.width / gymLogo.height) * lh;
    const lx = (w - lw) / 2;
    // Glow
    ctx.save();
    ctx.shadowColor = C.gold; ctx.shadowBlur = 25; ctx.globalAlpha = 0.2;
    ctx.drawImage(gymLogo, lx, y - lh, lw, lh);
    ctx.restore();
    // Logo
    ctx.drawImage(gymLogo, lx, y - lh, lw, lh);
  }
}

// ── Headline generator ──────────────────────────────────────────────────────

function getHeadline(routineName, sessionPRs, completedSets, totalSets) {
  // PR is the biggest flex
  if (sessionPRs && sessionPRs.length > 0) {
    return sessionPRs.length === 1 ? 'New Personal Record.' : `${sessionPRs.length} New Records.`;
  }
  // Completed all sets
  if (completedSets > 0 && completedSets >= totalSets) {
    const name = routineName?.replace(/day/i, 'Day');
    if (name && name.length <= 20) return `${name} ✓`;
    return 'Every. Single. Set.';
  }
  // Has some data
  if (completedSets > 0) return 'Work Put In.';
  // Empty/minimal
  return 'You Showed Up.';
}

function getHeroStat(totalVolume, completedSets, totalExercises, sessionPRs) {
  // If PRs, hero is PR count
  if (sessionPRs && sessionPRs.length > 0) {
    return { value: `${sessionPRs.length}`, label: sessionPRs.length === 1 ? 'PERSONAL RECORD' : 'PERSONAL RECORDS' };
  }
  // Volume is the default flex
  if (totalVolume > 0) {
    return { value: fmtV(totalVolume), label: 'LBS MOVED' };
  }
  // Fallback to sets
  if (completedSets > 0) {
    return { value: `${completedSets}`, label: 'SETS COMPLETED' };
  }
  // Empty state
  return { value: null, label: null };
}

function getAchievementText(sessionPRs, streak) {
  // Best PR
  if (sessionPRs && sessionPRs.length > 0) {
    const pr = sessionPRs[0];
    const name = trunc(pr.exerciseName || pr.exercise || pr.exercise_name || '', 16);
    const weight = pr.weight_lbs || pr.weight || 0;
    return `🏆  ${name}  ${weight} × ${pr.reps}`;
  }
  // Streak
  if (streak && streak > 1) {
    return `🔥  ${streak} Day Streak`;
  }
  return null;
}

// ── 2×2 metric grid (small, clean, low emphasis) ────────────────────────────

function drawMetricGrid(ctx, cx, y, w, metrics) {
  const colW = w / 2;
  const rowH = 90;
  const grid = metrics.slice(0, 4);

  grid.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = cx - w / 2 + col * colW + colW / 2;
    const cellY = y + row * rowH;

    txt(ctx, m.value, cellX, cellY, { font: ff(700, 42), color: C.t1 });
    txt(ctx, m.label, cellX, cellY + 50, { font: ff(500, 18), color: C.t3 });
  });

  return y + Math.ceil(grid.length / 2) * rowH;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WORKOUT COMPLETE — DOMINANT HERO NUMBER
// ═══════════════════════════════════════════════════════════════════════════

// ── Achievement badge glow system (concentric rings + core) ─────────────────

function drawBadgeGlow(ctx, cx, cy, radius) {
  // Outermost faint halo
  ctx.save();
  ctx.strokeStyle = C.glow + '0.04)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2); ctx.stroke();
  // Outer ring
  ctx.strokeStyle = C.glow + '0.07)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.35, 0, Math.PI * 2); ctx.stroke();
  // Inner ring
  ctx.strokeStyle = C.glow + '0.12)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2); ctx.stroke();
  // Core glow — bright center
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g1.addColorStop(0, C.glow + '0.18)');
  g1.addColorStop(0.4, C.glow + '0.08)');
  g1.addColorStop(0.7, C.glow + '0.02)');
  g1.addColorStop(1, 'transparent');
  ctx.fillStyle = g1;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  // Inner bright core
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.5);
  g2.addColorStop(0, C.glow + '0.12)');
  g2.addColorStop(1, 'transparent');
  ctx.fillStyle = g2;
  ctx.fillRect(cx - radius * 0.5, cy - radius * 0.5, radius, radius);
  ctx.restore();
}

// ── Hero number with gold depth (not flat white) ────────────────────────────

function drawBadgeNumber(ctx, value, cx, cy, fontSize) {
  ctx.save();
  ctx.font = ff(900, fontSize);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // Pass 1: deep gold shadow (depth)
  ctx.shadowColor = C.gold; ctx.shadowBlur = 60;
  ctx.fillStyle = C.gold; ctx.globalAlpha = 0.15;
  ctx.fillText(value, cx, cy);
  ctx.fillText(value, cx, cy);
  ctx.fillText(value, cx, cy);

  // Pass 2: bright gold edge glow
  ctx.shadowBlur = 25; ctx.globalAlpha = 0.25;
  ctx.fillText(value, cx, cy);
  ctx.restore();

  // Pass 3: crisp white with very subtle gold tint
  ctx.save();
  ctx.font = ff(900, fontSize);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Create subtle gradient from white to very light gold
  const tg = ctx.createLinearGradient(cx, cy - fontSize * 0.4, cx, cy + fontSize * 0.4);
  tg.addColorStop(0, '#FFFFFF');
  tg.addColorStop(0.5, '#FFF8E7');
  tg.addColorStop(1, '#FFFFFF');
  ctx.fillStyle = tg;
  ctx.fillText(value, cx, cy);
  ctx.restore();
}

export async function renderWorkoutCard(opts) {
  const {
    format = 'story', routineName = 'Workout', elapsedTime = 0, totalVolume = 0,
    completedSets = 0, totalSets = 0, totalExercises = 0, sessionPRs = [],
    completedAt, heartRate, userName = '', gymName = '', gymLogoUrl = '', streak = 0,
  } = opts;

  const isStory = format === 'story';
  const W = isStory ? STORY.w : FEED.w;
  const H = isStory ? STORY.h : FEED.h;
  const hasPRs = sessionPRs && sessionPRs.length > 0;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await document.fonts.ready;

  const gymLogo = await loadImg(gymLogoUrl);
  drawBg(ctx, W, H);
  if (isStory) drawWave(ctx, W, H, H * 0.68);

  const hero = getHeroStat(totalVolume, completedSets, totalExercises, sessionPRs);
  const hasData = hero.value !== null;

  // ── EMPTY STATE ─────────────────────────────────────────────────────────
  if (!hasData) {
    const cy = H / 2 - 60;
    txt(ctx, 'You Showed Up.', W / 2, cy, { font: ff(800, isStory ? 52 : 40), color: C.t1 });
    txt(ctx, "That's what matters.", W / 2, cy + (isStory ? 64 : 50), { font: ff(400, isStory ? 22 : 18), color: C.t3 });
    drawBrand(ctx, W, H, { gymName, gymLogo, userName });
    return new Promise(r => canvas.toBlob(r, 'image/png'));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PR PATH — Achievement Badge Layout
  // ══════════════════════════════════════════════════════════════════════
  if (hasPRs) {
    const heroFontSize = isStory ? 220 : 150;
    // Badge center at ~38% — grounded but not cramped against top
    const badgeCenter = H * (isStory ? 0.38 : 0.40);

    // ── 1. TOP LABEL ────────────────────────────────────────────────────
    const topY = isStory ? 160 : 90;
    spaced(ctx, 'NEW PERSONAL RECORD', W / 2, topY, {
      font: ff(600, isStory ? 22 : 18), color: C.t2, spacing: isStory ? 9 : 7,
    });

    // ── 2. BADGE: glow + massive number ─────────────────────────────────
    drawBadgeGlow(ctx, W / 2, badgeCenter, heroFontSize * 0.75);
    drawBadgeNumber(ctx, `${sessionPRs.length}`, W / 2, badgeCenter, heroFontSize);

    // ── 3. LABEL GROUP under number (tight but readable) ────────────────
    const groupTop = badgeCenter + heroFontSize * 0.52 + 16;
    spaced(ctx, sessionPRs.length === 1 ? 'PERSONAL RECORD' : 'PERSONAL RECORDS', W / 2, groupTop, {
      font: ff(700, isStory ? 26 : 20), color: C.gold, spacing: isStory ? 10 : 8,
    });
    txt(ctx, sessionPRs.length === 1 ? 'New personal best today' : `${sessionPRs.length} records broken today`, W / 2, groupTop + (isStory ? 48 : 36), {
      font: ff(400, isStory ? 24 : 19), color: C.t2,
    });

    // ── 4. STATS ROW ────────────────────────────────────────────────────
    let bottomY = groupTop + (isStory ? 140 : 100);

    const stats = [];
    if (elapsedTime > 0) stats.push({ value: fmtD(elapsedTime), label: 'Duration' });
    if (completedSets > 0) stats.push({ value: `${completedSets}`, label: 'Sets' });
    if (streak > 1) stats.push({ value: `${streak}`, label: 'Streak' });
    else if (totalExercises > 0) stats.push({ value: `${totalExercises}`, label: 'Exercises' });

    if (stats.length > 0) {
      drawStats(ctx, W / 2, bottomY, stats.slice(0, 3));
      bottomY += isStory ? 110 : 84;
    }

    // ── 5. HIGHLIGHT PILL ───────────────────────────────────────────────
    const topPR = sessionPRs[0];
    const prName = trunc(topPR.exerciseName || topPR.exercise || topPR.exercise_name || '', 18);
    const prWeight = topPR.weight_lbs || topPR.weight || 0;
    const prText = `🏆  ${prName}  ${prWeight} × ${topPR.reps}`;
    drawAchievement(ctx, W / 2, bottomY, prText, W);

    // Additional PRs
    if (sessionPRs.length > 1 && isStory) {
      bottomY += 84;
      for (let i = 1; i < Math.min(sessionPRs.length, 3); i++) {
        const pr = sessionPRs[i];
        const n = trunc(pr.exerciseName || pr.exercise || pr.exercise_name || '', 18);
        const w = pr.weight_lbs || pr.weight || 0;
        txt(ctx, `${n}  ${w} × ${pr.reps}`, W / 2, bottomY, {
          font: ff(600, 22), color: C.t2,
        });
        bottomY += 40;
      }
    }

  // ══════════════════════════════════════════════════════════════════════
  //  VOLUME PATH — Standard Flex Card
  // ══════════════════════════════════════════════════════════════════════
  } else {
    const heroFontSize = isStory ? 200 : 140;
    const heroCenter = H * (isStory ? 0.36 : 0.38);
    const headline = getHeadline(routineName, sessionPRs, completedSets, totalSets);

    // ── 1. TOP ──────────────────────────────────────────────────────────
    let topY = isStory ? 120 : 70;
    spaced(ctx, 'WORKOUT COMPLETE', W / 2, topY, {
      font: ff(600, isStory ? 20 : 16), color: C.t2, spacing: isStory ? 8 : 6,
    });
    topY += isStory ? 48 : 36;

    txt(ctx, headline, W / 2, topY, {
      font: ff(800, isStory ? 48 : 38), color: C.t1, maxW: W - 100,
    });
    topY += isStory ? 36 : 28;

    const dateStr = (completedAt ? new Date(completedAt) : new Date())
      .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    txt(ctx, dateStr, W / 2, topY, { font: ff(400, isStory ? 22 : 17), color: C.t3 });

    // ── 2. HERO ─────────────────────────────────────────────────────────
    drawHeroGlow(ctx, W / 2, heroCenter, heroFontSize * 0.9);

    ctx.save();
    ctx.font = ff(900, heroFontSize);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = C.gold; ctx.shadowBlur = 50;
    ctx.fillStyle = C.gold; ctx.globalAlpha = 0.2;
    ctx.fillText(hero.value, W / 2, heroCenter);
    ctx.fillText(hero.value, W / 2, heroCenter);
    ctx.restore();
    txt(ctx, hero.value, W / 2, heroCenter - heroFontSize * 0.4, {
      font: ff(900, heroFontSize), color: C.white, base: 'top',
    });

    const labelY = heroCenter + heroFontSize * 0.48 + 16;
    spaced(ctx, hero.label, W / 2, labelY, {
      font: ff(700, isStory ? 24 : 18), color: C.gold, spacing: isStory ? 9 : 7,
    });

    // ── 3. INSIGHT ──────────────────────────────────────────────────────
    let bottomY = labelY + (isStory ? 52 : 38);
    let insightText = null;
    if (totalVolume > 10000) insightText = `${fmtV(totalVolume)} lbs total volume moved`;
    else if (completedSets >= totalSets && totalSets > 0) insightText = `Every set completed`;

    if (insightText) {
      txt(ctx, insightText, W / 2, bottomY, {
        font: ff(500, isStory ? 24 : 19), color: C.t2, maxW: W - 120,
      });
      bottomY += isStory ? 64 : 48;
    } else {
      bottomY += isStory ? 40 : 28;
    }

    // ── 4. 2×2 GRID ────────────────────────────────────────────────────
    const metrics = [];
    if (elapsedTime > 0) metrics.push({ value: fmtD(elapsedTime), label: 'Duration' });
    if (completedSets > 0) metrics.push({ value: `${completedSets}/${totalSets}`, label: 'Sets' });
    if (totalExercises > 0) metrics.push({ value: `${totalExercises}`, label: 'Exercises' });
    if (heartRate?.averageBPM) metrics.push({ value: `${heartRate.averageBPM}`, label: 'Avg BPM' });
    if (metrics.length === 3 && streak > 0) metrics.push({ value: `${streak}`, label: 'Day Streak' });

    if (metrics.length >= 2) {
      bottomY = drawMetricGrid(ctx, W / 2, bottomY, isStory ? 640 : 540, metrics);
      bottomY += isStory ? 32 : 20;
    }

    // ── 5. ACHIEVEMENT ──────────────────────────────────────────────────
    const achievement = getAchievementText(sessionPRs, streak);
    if (achievement && isStory) {
      drawAchievement(ctx, W / 2, bottomY, achievement, W);
    }
  }

  // ── BRAND ───────────────────────────────────────────────────────────────
  drawBrand(ctx, W, H, { gymName, gymLogo, userName });

  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOCIAL FEED CARD — SOMEONE ELSE'S WORKOUT
// ═══════════════════════════════════════════════════════════════════════════

export async function renderSocialFeedCard(opts) {
  const {
    athleteName = 'Athlete', workoutName = 'Workout', volume = 0,
    duration = 0, setsCompleted = 0, prsHit = 0, completedAt, gymName = '',
  } = opts;

  const W = FEED.w; const H = FEED.h;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await document.fonts.ready;

  drawBg(ctx, W, H);
  drawWave(ctx, W, H, H * 0.58);

  const centerY = H / 2 - 80;
  let y = centerY - 120;

  // Athlete name
  spaced(ctx, athleteName.toUpperCase(), W / 2, y, {
    font: ff(700, 18), color: C.gold, spacing: 6,
  });
  y += 40;

  // Workout name — the headline
  txt(ctx, trunc(workoutName, 22), W / 2, y, {
    font: ff(800, 42), color: C.t1, maxW: W - 120,
  });
  y += 64;

  // Hero volume
  if (volume > 0) {
    drawHeroGlow(ctx, W / 2, y + 50, 90);
    y = drawHero(ctx, fmtV(volume), 'LBS MOVED', W / 2, y, 100);
    y += 40;
  }

  // Stats
  const stats = [];
  if (duration > 0) stats.push({ value: fmtD(duration), label: 'Duration' });
  if (setsCompleted > 0) stats.push({ value: `${setsCompleted}`, label: 'Sets' });
  if (prsHit > 0) stats.push({ value: `${prsHit}`, label: 'PRs' });
  if (stats.length > 0) drawStats(ctx, W / 2, y, stats.slice(0, 3));

  // Date
  if (completedAt) {
    const d = new Date(completedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    txt(ctx, d, W / 2, H - 200, { font: ff(400, 16), color: C.t3 });
  }

  drawBrand(ctx, W, H, { gymName });

  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  MONTHLY REPORT
// ═══════════════════════════════════════════════════════════════════════════

export async function renderMonthlyReportCard(opts) {
  const {
    monthLabel = '', totalWorkouts = 0, totalVolume = 0, totalTime = 0,
    attendanceRate = 0, bestStreak = 0, prs = [], weightChange,
    userName = '', gymName = '', gymLogoUrl = '', weeklyWorkouts,
    prevMonthWorkouts,
  } = opts;

  const W = STORY.w; const H = STORY.h;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await document.fonts.ready;

  const gymLogo = await loadImg(gymLogoUrl);

  drawBg(ctx, W, H);
  drawWave(ctx, W, H, H * 0.50);
  drawWave(ctx, W, H, H * 0.56);

  let y = 100;

  // ── 1. HEADER ───────────────────────────────────────────────────────────
  spaced(ctx, 'MONTHLY REPORT', W / 2, y, {
    font: ff(600, 16), color: C.t3, spacing: 5,
  });
  y += 40;

  txt(ctx, monthLabel.toUpperCase(), W / 2, y, {
    font: ff(800, 52), color: C.t1,
  });
  y += 88;

  // ── 2. HERO: WORKOUTS ───────────────────────────────────────────────────
  drawHeroGlow(ctx, W / 2, y + 80, 140);
  y = drawHero(ctx, `${totalWorkouts}`, 'WORKOUTS', W / 2, y, 160);
  y += 40;

  // ── 3. PROGRESS INSIGHT ─────────────────────────────────────────────────
  let insight = null;
  if (prevMonthWorkouts != null && prevMonthWorkouts > 0 && totalWorkouts > prevMonthWorkouts) {
    insight = `+${totalWorkouts - prevMonthWorkouts} workouts vs last month`;
  } else if (attendanceRate >= 80) {
    insight = `${attendanceRate}% consistency this month`;
  } else if (bestStreak >= 5) {
    insight = `${bestStreak} day streak — your longest this month`;
  } else if (totalVolume >= 50000) {
    insight = `${fmtV(totalVolume)} lbs total volume moved`;
  } else if (totalWorkouts > 0) {
    insight = `${totalWorkouts} sessions logged this month`;
  }

  if (insight) {
    txt(ctx, insight, W / 2, y, { font: ff(500, 22), color: C.t2, maxW: W - 140 });
    y += 48;
  }

  y += 16;

  // ── 4. SECONDARY STATS ──────────────────────────────────────────────────
  const stats = [];
  if (totalVolume > 0) stats.push({ value: fmtV(totalVolume), label: 'Volume' });
  if (totalTime > 0) stats.push({ value: fmtD(totalTime), label: 'Time' });
  if (attendanceRate > 0) stats.push({ value: `${attendanceRate}%`, label: 'Consistency' });
  if (stats.length > 0) {
    drawStats(ctx, W / 2, y, stats.slice(0, 3));
    y += 88;
  }

  // ── 5. SPARKLINE (premium graph) ────────────────────────────────────────
  if (weeklyWorkouts && weeklyWorkouts.length >= 2) {
    y += 4;
    spaced(ctx, 'WEEKLY ACTIVITY', W / 2, y, {
      font: ff(600, 13), color: C.t3, spacing: 4,
    });
    y += 28;
    drawPremiumSparkline(ctx, 100, y, W - 200, 110, weeklyWorkouts);
    y += 130;
  }

  // ── 6. PERSONAL HIGHLIGHTS ──────────────────────────────────────────────
  // Best streak
  if (bestStreak > 1) {
    y = drawAchievement(ctx, W / 2, y, `🔥  Longest streak: ${bestStreak} days`, W);
  }
  // Top PR
  if (prs.length > 0) {
    const pr = prs[0];
    const name = trunc(pr.exerciseName || pr.exercise || '', 16);
    const weight = pr.weight_lbs || pr.weight || 0;
    y = drawAchievement(ctx, W / 2, y, `🏆  ${name}  ${weight} × ${pr.reps}`, W);
  }
  // Weight change
  if (weightChange != null && weightChange !== 0) {
    const sign = weightChange > 0 ? '▲' : '▼';
    y = drawAchievement(ctx, W / 2, y, `${sign}  ${Math.abs(weightChange).toFixed(1)} lbs body weight`, W);
  }

  // ── 7. BRAND ────────────────────────────────────────────────────────────
  drawBrand(ctx, W, H, { gymName, gymLogo, userName });

  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

// ── Premium Sparkline (thick, glowing, peak highlighted) ─────────────────────

function drawPremiumSparkline(ctx, x, y, w, h, data) {
  if (!data || data.length < 2) return;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => ({ x: x + i * step, y: y + h - (v / max) * h, v }));

  // Gradient fill under curve
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, y + h);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, y + h);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, y, 0, y + h);
  fg.addColorStop(0, C.glow + '0.16)');
  fg.addColorStop(0.6, C.glow + '0.04)');
  fg.addColorStop(1, 'transparent');
  ctx.fillStyle = fg; ctx.fill();
  ctx.restore();

  // Glow line (wider, blurred)
  ctx.save();
  ctx.shadowColor = C.gold; ctx.shadowBlur = 12;
  ctx.strokeStyle = C.gold; ctx.lineWidth = 4;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.restore();

  // Crisp line on top
  ctx.save();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.restore();

  // Find peak
  let peakIdx = 0;
  pts.forEach((p, i) => { if (p.v > pts[peakIdx].v) peakIdx = i; });
  const peak = pts[peakIdx];

  // All dots
  pts.forEach((p, i) => {
    const isPeak = i === peakIdx;
    const r = isPeak ? 7 : 4;
    if (isPeak) {
      // Peak glow
      ctx.save();
      ctx.shadowColor = C.gold; ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = C.glow + '0.3)'; ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = C.gold; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, isPeak ? 3 : 1.5, 0, Math.PI * 2);
    ctx.fillStyle = C.bg; ctx.fill();

    // Peak label
    if (isPeak && peak.v > 0) {
      txt(ctx, `${peak.v}`, p.x, p.y - 24, { font: ff(700, 16), color: C.gold });
    }
  });

  // Week labels
  pts.forEach((p, i) => {
    txt(ctx, `W${i + 1}`, p.x, y + h + 8, { font: ff(500, 12), color: C.t3 });
  });
}

// ── Basic Sparkline (for other uses) ────────────────────────────────────────

function drawSparkline(ctx, x, y, w, h, data) {
  if (!data || data.length < 2) return;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => ({ x: x + i * step, y: y + h - (v / max) * h }));

  // Fill
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, y + h);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, y + h);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, y, 0, y + h);
  fg.addColorStop(0, C.glow + '0.10)');
  fg.addColorStop(1, 'transparent');
  ctx.fillStyle = fg; ctx.fill();
  ctx.restore();

  // Line
  ctx.save();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.restore();

  // Dots
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = C.gold; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = C.bg; ctx.fill();
  });
}

// ── Share utility ───────────────────────────────────────────────────────────

export async function shareBlob(blob, fileName = 'share.png', shareText = '') {
  const file = new File([blob], fileName, { type: 'image/png' });

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }

  try {
    if (navigator.share && shareText) {
      await navigator.share({ text: shareText });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}
