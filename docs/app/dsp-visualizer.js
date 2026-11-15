// docs/app/dsp-visualizer.js
// Exact 1:1 port of Mochy Android's BiquadFilter.kt, ResponseCurve.kt, EqGraphEditor.kt,
// ReverbCard.kt (ReverbPicture), and AudioFxPictures.kt (SpatialPicture, LoudnessPicture)

window.MochyDSP = (() => {
  const PI = Math.PI;
  const MIN_LOG = Math.log10(20.0);
  const MAX_LOG = Math.log10(20000.0);
  const GRAPH_RANGE_DB = 12.0;

  function logSpaced(count, from = 20.0, to = 20000.0) {
    const lo = Math.log10(from);
    const hi = Math.log10(to);
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = Math.pow(10.0, lo + ((hi - lo) * i) / (count - 1));
    }
    return out;
  }

  const GRAPH_FREQUENCIES = logSpaced(220, 20.0, 20000.0);

  function coefficients(type, frequency, gainDb, quality, sampleRate = 48000) {
    const nyquistSafe = Math.max(10.0, Math.min(sampleRate * 0.49, frequency));
    const omega = (2.0 * PI * nyquistSafe) / sampleRate;
    const sinW = Math.sin(omega);
    const cosW = Math.cos(omega);
    const q = Math.max(0.05, Math.min(30.0, quality));
    const alpha = sinW / (2.0 * q);
    const a = Math.pow(10.0, gainDb / 40.0);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (type) {
      case 'PK':
        b0 = 1.0 + alpha * a;
        b1 = -2.0 * cosW;
        b2 = 1.0 - alpha * a;
        a0 = 1.0 + alpha / a;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha / a;
        break;
      case 'LSC': {
        const twoSqrtAAlpha = 2.0 * Math.sqrt(a) * alpha;
        b0 = a * ((a + 1) - (a - 1) * cosW + twoSqrtAAlpha);
        b1 = 2.0 * a * ((a - 1) - (a + 1) * cosW);
        b2 = a * ((a + 1) - (a - 1) * cosW - twoSqrtAAlpha);
        a0 = (a + 1) + (a - 1) * cosW + twoSqrtAAlpha;
        a1 = -2.0 * ((a - 1) + (a + 1) * cosW);
        a2 = (a + 1) + (a - 1) * cosW - twoSqrtAAlpha;
        break;
      }
      case 'HSC': {
        const twoSqrtAAlpha = 2.0 * Math.sqrt(a) * alpha;
        b0 = a * ((a + 1) + (a - 1) * cosW + twoSqrtAAlpha);
        b1 = -2.0 * a * ((a - 1) + (a + 1) * cosW);
        b2 = a * ((a + 1) + (a - 1) * cosW - twoSqrtAAlpha);
        a0 = (a + 1) - (a - 1) * cosW + twoSqrtAAlpha;
        a1 = 2.0 * ((a - 1) - (a + 1) * cosW);
        a2 = (a + 1) - (a - 1) * cosW - twoSqrtAAlpha;
        break;
      }
      case 'LPQ':
        b0 = (1.0 - cosW) / 2.0;
        b1 = 1.0 - cosW;
        b2 = (1.0 - cosW) / 2.0;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;
      case 'HPQ':
        b0 = (1.0 + cosW) / 2.0;
        b1 = -(1.0 + cosW);
        b2 = (1.0 + cosW) / 2.0;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  function isAudible(band) {
    if (!band || !band.enabled) return false;
    if (band.filterType === 'LPQ' || band.filterType === 'HPQ') return true;
    return Math.abs(band.gain) >= 0.05;
  }

  function magnitudeDbAt(c, cos1, cos2) {
    const [b0, b1, b2, a1, a2] = c;
    const num = b0 * b0 + b1 * b1 + b2 * b2 + 2.0 * (b0 * b1 + b1 * b2) * cos1 + 2.0 * b0 * b2 * cos2;
    const den = 1.0 + a1 * a1 + a2 * a2 + 2.0 * (a1 + a1 * a2) * cos1 + 2.0 * a2 * cos2;
    return 10.0 * Math.log10(Math.max(num, 1e-20) / Math.max(den, 1e-20));
  }

  // Precompute cos(w) and cos(2w) for 220 log-spaced frequencies at 48kHz
  const COS1 = new Float64Array(GRAPH_FREQUENCIES.length);
  const COS2 = new Float64Array(GRAPH_FREQUENCIES.length);
  for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
    const w = (2.0 * PI * GRAPH_FREQUENCIES[i]) / 48000.0;
    COS1[i] = Math.cos(w);
    COS2[i] = Math.cos(2.0 * w);
  }

  function computeResponseCurve(bands) {
    const into = new Float64Array(GRAPH_FREQUENCIES.length);
    for (const band of bands) {
      if (!isAudible(band)) continue;
      const c = coefficients(band.filterType, band.frequency, band.gain, band.q, 48000);
      for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
        into[i] += magnitudeDbAt(c, COS1[i], COS2[i]);
      }
    }
    return into;
  }

  // Exact autoHeadroom calculation from AudioLabStore.kt + PeakLimiter.boostRoomDb
  function autoHeadroom(bands) {
    const resp = computeResponseCurve(bands);
    let over = 0.0;
    for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
      const f = GRAPH_FREQUENCIES[i];
      const boostRoom = 4.0 + 3.0 * Math.max(0.0, Math.log2(f / 1000.0));
      over = Math.max(over, resp[i] - boostRoom);
    }
    return -over;
  }

  // ---- Interactive Parametric EQ Graph Canvas (EqGraphEditor.kt) ------------
  function drawEqGraph(canvas, state, analyserData) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const left = 34;
    const right = w - 14;
    const top = 16;
    const bottom = h - 24;

    const xOf = (f) => left + ((Math.log10(f) - MIN_LOG) / (MAX_LOG - MIN_LOG)) * (right - left);
    const yOf = (db) => top + ((GRAPH_RANGE_DB - db) / (2 * GRAPH_RANGE_DB)) * (bottom - top);

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#252529';
    ctx.lineWidth = 1;
    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const gridLabels = ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'];
    ctx.fillStyle = '#6c6c74';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < gridFreqs.length; i++) {
      const gx = xOf(gridFreqs[i]);
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx, bottom);
      ctx.stroke();
      ctx.fillText(gridLabels[i], gx, h - 7);
    }

    const dbLines = [-12, -6, 0, 6, 12];
    ctx.textAlign = 'right';
    for (const db of dbLines) {
      const gy = yOf(db);
      ctx.strokeStyle = db === 0 ? '#3a3a42' : '#222226';
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(right, gy);
      ctx.stroke();
      ctx.fillText((db > 0 ? '+' : '') + db, left - 6, gy + 3);
    }

    // Live FFT Spectrum bars behind the EQ curve
    if (analyserData && analyserData.length > 0) {
      const barCount = 52;
      const barW = (right - left) / barCount;
      for (let i = 0; i < barCount; i++) {
        const binIdx = Math.min(analyserData.length - 1, Math.floor(Math.pow(i / barCount, 1.8) * (analyserData.length * 0.65)));
        const val = analyserData[binIdx] / 255.0;
        const bh = val * (bottom - top) * 0.72;
        if (bh > 2) {
          ctx.fillStyle = 'rgba(245, 226, 122, 0.11)';
          ctx.fillRect(left + i * barW + 1, bottom - bh, Math.max(1.5, barW - 2), bh);
        }
      }
    }

    const nodes = state.nodes || [];
    const correction = state.correctionEnabled && state.correction ? state.correction.filters : [];
    const allBands = [...nodes, ...correction];
    const totalCurve = computeResponseCurve(allBands);

    // Selected node individual highlight fill
    const selIdx = state.selectedNode;
    if (selIdx >= 0 && selIdx < nodes.length && nodes[selIdx]) {
      const selBand = nodes[selIdx];
      const nodeColor = window.MOCHY_DATA.nodeColors[selIdx % window.MOCHY_DATA.nodeColors.length];
      const singleCurve = computeResponseCurve([selBand]);
      ctx.save();
      ctx.beginPath();
      const zeroY = yOf(0);
      ctx.moveTo(xOf(GRAPH_FREQUENCIES[0]), zeroY);
      for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
        const cy = Math.max(top, Math.min(bottom, yOf(singleCurve[i])));
        ctx.lineTo(xOf(GRAPH_FREQUENCIES[i]), cy);
      }
      ctx.lineTo(xOf(GRAPH_FREQUENCIES[GRAPH_FREQUENCIES.length - 1]), zeroY);
      ctx.closePath();
      ctx.fillStyle = nodeColor + '26';
      ctx.fill();
      ctx.restore();
    }

    // Total response fill + stroke
    ctx.save();
    ctx.beginPath();
    const zeroY = yOf(0);
    ctx.moveTo(xOf(GRAPH_FREQUENCIES[0]), zeroY);
    for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
      const cy = Math.max(top, Math.min(bottom, yOf(totalCurve[i])));
      ctx.lineTo(xOf(GRAPH_FREQUENCIES[i]), cy);
    }
    ctx.lineTo(xOf(GRAPH_FREQUENCIES[GRAPH_FREQUENCIES.length - 1]), zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, 'rgba(245, 226, 122, 0.25)');
    grad.addColorStop(0.5, 'rgba(245, 226, 122, 0.04)');
    grad.addColorStop(1, 'rgba(107, 186, 242, 0.22)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Master curve line
    ctx.beginPath();
    for (let i = 0; i < GRAPH_FREQUENCIES.length; i++) {
      const cx = xOf(GRAPH_FREQUENCIES[i]);
      const cy = Math.max(top, Math.min(bottom, yOf(totalCurve[i])));
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    // Draw interactive nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const nx = xOf(n.frequency);
      const nodeGain = (n.filterType === 'LPQ' || n.filterType === 'HPQ') ? 0.0 : n.gain;
      const ny = yOf(nodeGain);
      const color = window.MOCHY_DATA.nodeColors[i % window.MOCHY_DATA.nodeColors.length];
      const isSel = i === selIdx;

      if (isSel) {
        ctx.beginPath();
        ctx.arc(nx, ny, 14, 0, PI * 2);
        ctx.fillStyle = color + '35';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(nx, ny, isSel ? 7.5 : 6, 0, PI * 2);
      ctx.fillStyle = n.enabled ? color : '#44444a';
      ctx.fill();
      ctx.lineWidth = isSel ? 2.2 : 1.4;
      ctx.strokeStyle = '#0e0e10';
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---- Reverb Wave Bouncing Canvas (ReverbCard.kt ReverbPicture) ------------
  function drawReverbPicture(canvas, reverb, t, audioLevel) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const cy = h / 2;
    const speakerX = w * 0.14;
    const backX = w * 0.05;
    const wallX = w * (0.52 + 0.4 * reverb.roomSize);

    // Draw room walls
    ctx.strokeStyle = reverb.enabled ? 'rgba(245, 226, 122, 0.45)' : '#323238';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wallX, 14);
    ctx.lineTo(wallX, h - 14);
    ctx.stroke();

    // Speaker cone
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(speakerX, cy, 5, 0, PI * 2);
    ctx.fill();

    // Animated acoustic wave arcs
    const waveCount = 6;
    const span = wallX - backX;
    const reflectivity = (0.35 + 0.55 * reverb.roomSize) * (1.0 - 0.55 * reverb.damping);
    const echoAlpha = (reverb.enabled ? 1 : 0.15) * (0.35 + 0.65 * reverb.wet) * (0.4 + 0.6 * reverb.mix);

    for (let i = 0; i < waveCount; i++) {
      const age = ((t * 0.85 + i * 0.55) % 3.3);
      const d = age * (w * 0.42);
      const first = wallX - speakerX;
      let x = speakerX + d;
      let rightward = true;
      let alpha = Math.exp(-d / (w * 1.5)) * (0.65 + 0.35 * audioLevel);

      if (d > first && reverb.enabled) {
        const past = d - first;
        const bounces = 1 + Math.floor(past / span);
        const inLeg = past % span;
        rightward = bounces % 2 === 0;
        x = rightward ? backX + inLeg : wallX - inLeg;
        alpha = Math.pow(reflectivity, bounces) * Math.exp(-d / (w * 2.2)) * echoAlpha;
      }

      if (alpha > 0.03 && x > 0 && x < w) {
        const arcH = Math.min(h * 0.38, 12 + d * 0.18);
        ctx.strokeStyle = rightward
          ? `rgba(255, 255, 255, ${Math.min(0.9, alpha)})`
          : `rgba(245, 226, 122, ${Math.min(0.9, alpha)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const curve = rightward ? 8 : -8;
        ctx.moveTo(x - curve, cy - arcH);
        ctx.quadraticCurveTo(x + curve, cy, x - curve, cy + arcH);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  return {
    GRAPH_FREQUENCIES,
    MIN_LOG,
    MAX_LOG,
    GRAPH_RANGE_DB,
    coefficients,
    computeResponseCurve,
    autoHeadroom,
    drawEqGraph,
    drawReverbPicture
  };
})();
