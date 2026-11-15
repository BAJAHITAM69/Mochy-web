// docs/app/audio-processor.js
// Exact 1:1 Web Audio AudioWorklet port of Mochy Music's Android DSP chain:
//   1. CustomEqualizerAudioProcessor + BiquadFilter + PeakLimiter (with 5ms lookahead, 25ms hold, 150ms release, 12ms design crossfade)
//   2. ReverbAudioProcessor (Jezar's Freeverb: 8 damped combs + 4 allpasses per side, stereo spread 23, pre-delay up to 150ms, low-cut filter, soft knee tanh at 0.89)
//   3. SpatialAudioProcessor (BS2B Crossfeed & Brown-Duda Spherical Head Renderer Virtual Speakers + Mono fold, soft knee tanh at 0.90)
//   4. LoudnessAudioProcessor (32-frame block stereo-linked compressor + boost + -0.5 dBFS peak limiter at 0.944, soft knee tanh at 0.95)

const PI = Math.PI;

// ---- RBJ Cookbook Biquad (BiquadFilter.kt) ----------------------------------
function computeBiquadCoeffs(type, frequency, gainDb, quality, sampleRate) {
  const nyquistSafe = Math.max(10.0, Math.min(sampleRate * 0.49, frequency));
  const omega = (2.0 * PI * nyquistSafe) / sampleRate;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const q = Math.max(0.05, Math.min(30.0, quality));
  const alpha = sinW / (2.0 * q);
  const a = Math.pow(10.0, gainDb / 40.0);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'PK': {
      b0 = 1.0 + alpha * a;
      b1 = -2.0 * cosW;
      b2 = 1.0 - alpha * a;
      a0 = 1.0 + alpha / a;
      a1 = -2.0 * cosW;
      a2 = 1.0 - alpha / a;
      break;
    }
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
    case 'LPQ': {
      b0 = (1.0 - cosW) / 2.0;
      b1 = 1.0 - cosW;
      b2 = (1.0 - cosW) / 2.0;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosW;
      a2 = 1.0 - alpha;
      break;
    }
    case 'HPQ': {
      b0 = (1.0 + cosW) / 2.0;
      b1 = -(1.0 + cosW);
      b2 = (1.0 + cosW) / 2.0;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosW;
      a2 = 1.0 - alpha;
      break;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function isAudibleBand(band) {
  if (!band || !band.enabled) return false;
  if (band.filterType === 'LPQ' || band.filterType === 'HPQ') return true;
  return Math.abs(band.gain) >= 0.05;
}

// ---- BiquadBank (Direct Form II Transposed, CustomEqualizerAudioProcessor.kt) --
class BiquadBank {
  constructor(eq, sampleRate, channels) {
    this.channels = channels;
    this.preampGain = Math.pow(10.0, (eq.preamp || 0) / 20.0);
    const active = (eq.bands || []).filter(isAudibleBand);
    this.bandCount = active.length;
    this.coeffs = new Float64Array(this.bandCount * 5);
    this.z1 = new Float64Array(this.bandCount * channels);
    this.z2 = new Float64Array(this.bandCount * channels);
    for (let b = 0; b < this.bandCount; b++) {
      const c = computeBiquadCoeffs(active[b].filterType, active[b].frequency, active[b].gain, active[b].q, sampleRate);
      const off = b * 5;
      this.coeffs[off] = c[0];
      this.coeffs[off + 1] = c[1];
      this.coeffs[off + 2] = c[2];
      this.coeffs[off + 3] = c[3];
      this.coeffs[off + 4] = c[4];
    }
  }

  process(workL, workR, frames) {
    const pre = this.preampGain;
    for (let f = 0; f < frames; f++) {
      let xL = workL[f] * pre;
      let xR = workR[f] * pre;
      for (let b = 0; b < this.bandCount; b++) {
        const cOff = b * 5;
        const b0 = this.coeffs[cOff];
        const b1 = this.coeffs[cOff + 1];
        const b2 = this.coeffs[cOff + 2];
        const a1 = this.coeffs[cOff + 3];
        const a2 = this.coeffs[cOff + 4];

        const sL = b * 2;
        const yL = b0 * xL + this.z1[sL];
        this.z1[sL] = b1 * xL - a1 * yL + this.z2[sL];
        this.z2[sL] = b2 * xL - a2 * yL;
        xL = yL;

        const sR = b * 2 + 1;
        const yR = b0 * xR + this.z1[sR];
        this.z1[sR] = b1 * xR - a1 * yR + this.z2[sR];
        this.z2[sR] = b2 * xR - a2 * yR;
        xR = yR;
      }
      workL[f] = xL;
      workR[f] = xR;
    }
  }
}

// ---- Lookahead PeakLimiter (PeakLimiter.kt) ---------------------------------
class PeakLimiter {
  constructor(sampleRate) {
    this.latencyFrames = Math.max(1, Math.floor(sampleRate * 0.005)); // 5ms lookahead
    this.window = this.latencyFrames + 1;
    this.holdFrames = Math.floor(sampleRate * 0.025); // 25ms hold (40Hz cycle)
    this.releaseStep = 1.0 - Math.exp(-1.0 / (0.15 * sampleRate)); // 150ms release
    this.delayL = new Float64Array(this.latencyFrames);
    this.delayR = new Float64Array(this.latencyFrames);
    this.delayPos = 0;
    this.minGain = new Float64Array(this.window);
    this.minFrame = new Float64Array(this.window);
    this.minHead = 0;
    this.minSize = 0;
    this.held = new Float64Array(this.window).fill(1.0);
    this.heldPos = 0;
    this.heldSum = this.window;
    this.heldOnes = this.window;
    this.envelope = 1.0;
    this.holdLeft = 0;
    this.frame = 0;
  }

  lowestInWindow(value) {
    while (this.minSize > 0 && this.minFrame[this.minHead] <= this.frame - this.window) {
      this.minHead = this.minHead + 1 === this.window ? 0 : this.minHead + 1;
      this.minSize--;
    }
    while (this.minSize > 0) {
      let back = this.minHead + this.minSize - 1;
      if (back >= this.window) back -= this.window;
      if (this.minGain[back] < value) break;
      this.minSize--;
    }
    let slot = this.minHead + this.minSize;
    if (slot >= this.window) slot -= this.window;
    this.minGain[slot] = value;
    this.minFrame[slot] = this.frame;
    this.minSize++;
    return this.minGain[this.minHead];
  }

  smooth(gain) {
    const oldest = this.held[this.heldPos];
    if (oldest === 1.0) this.heldOnes--;
    if (gain === 1.0) this.heldOnes++;
    this.heldSum += gain - oldest;
    this.held[this.heldPos] = gain;
    this.heldPos = this.heldPos + 1 === this.window ? 0 : this.heldPos + 1;
    if (this.heldOnes === this.window) {
      this.heldSum = this.window;
      return 1.0;
    }
    return this.heldSum / this.window;
  }

  process(workL, workR, frames) {
    for (let f = 0; f < frames; f++) {
      const peak = Math.max(Math.abs(workL[f]), Math.abs(workR[f]));
      const needed = peak > 1.0 ? 1.0 / peak : 1.0;
      if (needed < 1.0) this.holdLeft = this.holdFrames;
      else if (this.holdLeft > 0) this.holdLeft--;

      const recovered = this.envelope + (1.0 - this.envelope) * this.releaseStep;
      const resting = this.holdLeft > 0 ? this.envelope : (recovered > 1.0 - 1e-6 ? 1.0 : recovered);
      this.envelope = Math.min(needed, resting);

      const gain = this.smooth(this.lowestInWindow(this.envelope));
      const d = this.delayPos;
      const lateL = this.delayL[d];
      const lateR = this.delayR[d];
      this.delayL[d] = workL[f];
      this.delayR[d] = workR[f];
      workL[f] = lateL * gain;
      workR[f] = lateR * gain;

      this.delayPos = d + 1 === this.latencyFrames ? 0 : d + 1;
      this.frame++;
    }
  }
}

// ---- Jezar's Freeverb (ReverbAudioProcessor.kt) -----------------------------
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const FIXED_GAIN = 0.015;
const SCALE_WET = 3.0;
const SCALE_DAMP = 0.4;
const SCALE_ROOM = 0.28;
const OFFSET_ROOM = 0.7;
const MAX_PREDELAY_MS = 150.0;
const TOGGLE_SECONDS = 0.15;
const ANTI_DENORMAL = 1e-18;

class Comb {
  constructor(size) {
    this.line = new Float32Array(Math.max(1, size));
    this.index = 0;
    this.store = 0;
    this.feedback = 0.84;
    this.damp1 = 0.2;
    this.damp2 = 0.8;
  }
  set(feedback, damp) {
    this.feedback = feedback;
    this.damp1 = damp;
    this.damp2 = 1.0 - damp;
  }
  process(input) {
    const output = this.line[this.index];
    this.store = output * this.damp2 + this.store * this.damp1;
    this.line[this.index] = input + this.store * this.feedback;
    this.index = this.index + 1 === this.line.length ? 0 : this.index + 1;
    return output;
  }
  clear() {
    this.line.fill(0);
    this.store = 0;
  }
}

class Allpass {
  constructor(size) {
    this.line = new Float32Array(Math.max(1, size));
    this.index = 0;
  }
  process(input) {
    const buffered = this.line[this.index];
    this.line[this.index] = input + buffered * 0.5;
    this.index = this.index + 1 === this.line.length ? 0 : this.index + 1;
    return buffered - input;
  }
  clear() {
    this.line.fill(0);
  }
}

function softKnee(sample, knee) {
  const a = Math.abs(sample);
  if (a <= knee) return sample;
  const over = (a - knee) / (1.0 - knee);
  return (knee + (1.0 - knee) * Math.tanh(over)) * (sample < 0 ? -1.0 : 1.0);
}

class FreeverbProcessor {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    const k = sampleRate / 44100.0;
    this.combsL = COMB_TUNING.map(t => new Comb(Math.round(t * k)));
    this.combsR = COMB_TUNING.map(t => new Comb(Math.round((t + STEREO_SPREAD) * k)));
    this.allpassL = ALLPASS_TUNING.map(t => new Allpass(Math.round(t * k)));
    this.allpassR = ALLPASS_TUNING.map(t => new Allpass(Math.round((t + STEREO_SPREAD) * k)));
    this.preDelay = new Float32Array(Math.round((sampleRate * MAX_PREDELAY_MS) / 1000.0) + 2);
    this.preDelayIndex = 0;
    this.lowCutState = 0;
    this.lowCutInput = 0;
    this.amount = 0;
    this.wet1 = 0;
    this.wet2 = 0;
    this.dryGain = 1;
    this.mix = 0;
    this.roomEmpty = true;
  }

  clearRoom() {
    this.combsL.forEach(c => c.clear());
    this.combsR.forEach(c => c.clear());
    this.allpassL.forEach(a => a.clear());
    this.allpassR.forEach(a => a.clear());
    this.preDelay.fill(0);
    this.lowCutState = 0;
    this.lowCutInput = 0;
    this.roomEmpty = true;
  }

  process(workL, workR, frames, params) {
    const target = params.enabled ? 1.0 : 0.0;
    if (target === 0.0 && this.amount === 0.0) {
      if (!this.roomEmpty) this.clearRoom();
      return;
    }
    this.roomEmpty = false;

    const feedback = Math.max(0, Math.min(1, params.roomSize)) * SCALE_ROOM + OFFSET_ROOM;
    const damp = Math.max(0, Math.min(1, params.damping)) * SCALE_DAMP;
    for (let i = 0; i < this.combsL.length; i++) {
      this.combsL[i].set(feedback, damp);
      this.combsR[i].set(feedback, damp);
    }

    const delayFrames = Math.max(
      0,
      Math.min(
        this.preDelay.length - 1,
        Math.round((Math.max(0, Math.min(MAX_PREDELAY_MS, params.preDelayMs)) / 1000.0) * this.sampleRate)
      )
    );
    const lowCut = Math.exp((-2.0 * PI * Math.max(10, Math.min(2000, params.lowCutHz))) / this.sampleRate);

    const width = Math.max(0, Math.min(1, params.width));
    const wetLevel = Math.max(0, Math.min(1, params.wet)) * SCALE_WET;
    const targetWet1 = wetLevel * (width / 2.0 + 0.5);
    const targetWet2 = wetLevel * ((1.0 - width) / 2.0);
    const targetDry = Math.max(0, Math.min(1, params.dry));
    const targetMix = Math.max(0, Math.min(1, params.mix));

    const step = 1.0 / frames;
    const toggleStep = 1.0 / (this.sampleRate * TOGGLE_SECONDS);
    const dWet1 = (targetWet1 - this.wet1) * step;
    const dWet2 = (targetWet2 - this.wet2) * step;
    const dDry = (targetDry - this.dryGain) * step;
    const dMix = (targetMix - this.mix) * step;

    for (let f = 0; f < frames; f++) {
      const inL = workL[f];
      const inR = workR[f];

      this.amount = target > this.amount ? Math.min(target, this.amount + toggleStep) : Math.max(target, this.amount - toggleStep);
      this.wet1 += dWet1;
      this.wet2 += dWet2;
      this.dryGain += dDry;
      this.mix += dMix;

      const send = (inL + inR) * FIXED_GAIN;
      this.preDelay[this.preDelayIndex] = send;
      let read = this.preDelayIndex - delayFrames;
      if (read < 0) read += this.preDelay.length;
      this.preDelayIndex = this.preDelayIndex + 1 === this.preDelay.length ? 0 : this.preDelayIndex + 1;

      const delayed = this.preDelay[read];
      this.lowCutState = lowCut * (this.lowCutState + delayed - this.lowCutInput);
      this.lowCutInput = delayed;
      const input = this.lowCutState + ANTI_DENORMAL;

      let accL = 0, accR = 0;
      for (let i = 0; i < 8; i++) {
        accL += this.combsL[i].process(input);
        accR += this.combsR[i].process(input);
      }
      for (let i = 0; i < 4; i++) {
        accL = this.allpassL[i].process(accL);
        accR = this.allpassR[i].process(accR);
      }

      const g = this.amount * this.mix;
      const roomL = accL * this.wet1 + accR * this.wet2 + inL * this.dryGain;
      const roomR = accR * this.wet1 + accL * this.wet2 + inR * this.dryGain;
      workL[f] = softKnee(inL + (roomL - inL) * g, 0.89);
      workR[f] = softKnee(inR + (roomR - inR) * g, 0.89);
    }

    this.wet1 = targetWet1;
    this.wet2 = targetWet2;
    this.dryGain = targetDry;
    this.mix = targetMix;
  }
}

// ---- Spatial Audio (BS2B Crossfeed & Brown-Duda HeadRenderer) ---------------
class BS2BCrossfeed {
  constructor(sampleRate, cutoff, feed, previous) {
    this.cutoff = cutoff;
    this.feed = feed;
    const fc = Math.max(300.0, Math.min(2000.0, cutoff));
    const fd = Math.max(1.0, Math.min(15.0, feed));
    const gbLo = (fd * -5.0) / 6.0 - 3.0;
    const gbHi = fd / 6.0 - 3.0;
    const gLo = Math.pow(10.0, gbLo / 20.0);
    const gHi = 1.0 - Math.pow(10.0, gbHi / 20.0);
    const fcHi = fc * Math.pow(2.0, (gbLo - 20.0 * Math.log10(gHi)) / 12.0);
    const xLo = Math.exp((-2.0 * PI * fc) / sampleRate);
    this.b1Lo = xLo;
    this.a0Lo = gLo * (1.0 - xLo);
    const xHi = Math.exp((-2.0 * PI * fcHi) / sampleRate);
    this.b1Hi = xHi;
    this.a0Hi = 1.0 - gHi * (1.0 - xHi);
    this.a1Hi = -xHi;
    this.gain = 1.0 / (1.0 - gHi + gLo);

    this.loL = previous ? previous.loL : 0;
    this.loR = previous ? previous.loR : 0;
    this.hiL = previous ? previous.hiL : 0;
    this.hiR = previous ? previous.hiR : 0;
    this.asisL = previous ? previous.asisL : 0;
    this.asisR = previous ? previous.asisR : 0;
    this.left = 0;
    this.right = 0;
  }

  matches(cutoff, feed) {
    return this.cutoff === cutoff && this.feed === feed;
  }

  process(l, r) {
    this.loL = this.a0Lo * l + this.b1Lo * this.loL;
    this.loR = this.a0Lo * r + this.b1Lo * this.loR;
    this.hiL = this.a0Hi * l + this.a1Hi * this.asisL + this.b1Hi * this.hiL;
    this.hiR = this.a0Hi * r + this.a1Hi * this.asisR + this.b1Hi * this.hiR;
    this.asisL = l;
    this.asisR = r;
    this.left = (this.hiL + this.loR) * this.gain;
    this.right = (this.hiR + this.loL) * this.gain;
  }
}

class HeadRenderer {
  constructor(sampleRate, angleDeg) {
    this.angle = angleDeg;
    const azimuths = [-angleDeg, angleDeg];
    const n = 2;
    this.delaySize = 64;
    this.line = [new Float32Array(this.delaySize), new Float32Array(this.delaySize)];
    this.write = 0;
    this.delay = new Float32Array(4);
    this.b0 = new Float32Array(4);
    this.b1 = new Float32Array(4);
    this.a1 = new Float32Array(4);
    this.x1 = new Float32Array(4);
    this.y1 = new Float32Array(4);
    this.left = 0;
    this.right = 0;

    const headRadius = 0.0875;
    const speedOfSound = 343.0;
    const alphaMin = 0.1;
    const thetaMin = (150.0 * PI) / 180.0;
    const w0 = speedOfSound / headRadius;
    const k = 2.0 * sampleRate;
    const raw = new Float64Array(4);

    for (let s = 0; s < n; s++) {
      const az = azimuths[s];
      for (let ear = 0; ear < 2; ear++) {
        const i = s * 2 + ear;
        const earAz = ear === 0 ? -90.0 : 90.0;
        let diff = (az - earAz) % 360.0;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const theta = (Math.abs(diff) * PI) / 180.0;
        const alpha = (1 + alphaMin / 2) + (1 - alphaMin / 2) * Math.cos((theta / thetaMin) * PI);
        const norm = 2 * w0 + k;
        this.b0[i] = (2 * w0 + alpha * k) / norm;
        this.b1[i] = (2 * w0 - alpha * k) / norm;
        this.a1[i] = (2 * w0 - k) / norm;
        raw[i] = theta < PI / 2
          ? (-headRadius / speedOfSound) * Math.cos(theta)
          : (headRadius / speedOfSound) * (theta - PI / 2);
      }
    }
    const earliest = Math.min(...raw);
    for (let i = 0; i < 4; i++) {
      this.delay[i] = Math.max(0, Math.min(this.delaySize - 2, (raw[i] - earliest) * sampleRate));
    }
  }

  render(lIn, rIn) {
    const frame = [lIn, rIn];
    let l = 0, r = 0;
    for (let s = 0; s < 2; s++) {
      this.line[s][this.write] = frame[s];
      for (let ear = 0; ear < 2; ear++) {
        const i = s * 2 + ear;
        const d = this.delay[i];
        const whole = d | 0;
        const frac = d - whole;
        let p0 = this.write - whole;
        if (p0 < 0) p0 += this.delaySize;
        const p1 = p0 === 0 ? this.delaySize - 1 : p0 - 1;
        const x = this.line[s][p0] + (this.line[s][p1] - this.line[s][p0]) * frac;
        const y = this.b0[i] * x + this.b1[i] * this.x1[i] - this.a1[i] * this.y1[i];
        this.x1[i] = x;
        this.y1[i] = y;
        if (ear === 0) l += y;
        else r += y;
      }
    }
    this.write = this.write + 1 === this.delaySize ? 0 : this.write + 1;
    this.left = l;
    this.right = r;
  }
}

class SpatialProcessor {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.amount = 0;
    this.monoAmount = 0;
    this.crossfeed = null;
    this.head = null;
  }

  process(workL, workR, frames, params) {
    const target = params.enabled ? Math.max(0, Math.min(1, params.amount)) : 0.0;
    const monoTarget = params.mono ? 1.0 : 0.0;
    if (target === 0 && this.amount === 0 && monoTarget === 0 && this.monoAmount === 0) return;

    const step = 1.0 / (this.sampleRate * TOGGLE_SECONDS);
    if (params.mode === 'Speakers') {
      const angle = Math.max(5, Math.min(90, params.speakerAngle || 30));
      if (!this.head || this.head.angle !== angle) {
        this.head = new HeadRenderer(this.sampleRate, angle);
      }
      for (let f = 0; f < frames; f++) {
        let l = workL[f];
        let r = workR[f];
        this.monoAmount = monoTarget > this.monoAmount ? Math.min(monoTarget, this.monoAmount + step) : Math.max(monoTarget, this.monoAmount - step);
        if (this.monoAmount > 0) {
          const m = (l + r) * 0.5;
          l += (m - l) * this.monoAmount;
          r += (m - r) * this.monoAmount;
        }
        this.amount = target > this.amount ? Math.min(target, this.amount + step) : Math.max(target, this.amount - step);
        this.head.render(l, r);
        workL[f] = softKnee(l + (this.head.left * 0.6 - l) * this.amount, 0.9);
        workR[f] = softKnee(r + (this.head.right * 0.6 - r) * this.amount, 0.9);
      }
    } else {
      const cutoff = params.cutoffHz || 700;
      const feed = params.feedDb || 4.5;
      if (!this.crossfeed || !this.crossfeed.matches(cutoff, feed)) {
        this.crossfeed = new BS2BCrossfeed(this.sampleRate, cutoff, feed, this.crossfeed);
      }
      for (let f = 0; f < frames; f++) {
        let l = workL[f];
        let r = workR[f];
        this.monoAmount = monoTarget > this.monoAmount ? Math.min(monoTarget, this.monoAmount + step) : Math.max(monoTarget, this.monoAmount - step);
        if (this.monoAmount > 0) {
          const m = (l + r) * 0.5;
          l += (m - l) * this.monoAmount;
          r += (m - r) * this.monoAmount;
        }
        this.amount = target > this.amount ? Math.min(target, this.amount + step) : Math.max(target, this.amount - step);
        this.crossfeed.process(l, r);
        workL[f] = softKnee(l + (this.crossfeed.left - l) * this.amount, 0.9);
        workR[f] = softKnee(r + (this.crossfeed.right - r) * this.amount, 0.9);
      }
    }
  }
}

// ---- Loudness Compressor + Boost + -0.5dBFS Limiter (LoudnessAudioProcessor.kt) --
class LoudnessProcessor {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.attack = 1.0 - Math.exp(-1.0 / (0.008 * sampleRate));
    this.release = 1.0 - Math.exp(-1.0 / (0.18 * sampleRate));
    this.limiterRelease = 1.0 - Math.exp(-1.0 / (0.08 * sampleRate));
    this.amount = 0;
    this.envelope = 0;
    this.gain = 1;
    this.limiterGain = 1;
    this.reductionDb = 0;
  }

  process(workL, workR, frames, params) {
    const target = params.enabled ? 1.0 : 0.0;
    if (target === 0 && this.amount === 0) {
      this.reductionDb = 0;
      return;
    }
    const compression = Math.max(0, Math.min(1, params.compression));
    const threshold = -10.0 - 24.0 * compression;
    const slope = 1.0 - 1.0 / (1.0 + 3.0 * compression);
    const makeup = -threshold * slope * 0.5 * (compression > 0 ? 1.0 : 0.0);
    const boost = Math.max(0, Math.min(12, params.boostDb));
    const toggleStep = 1.0 / (this.sampleRate * TOGGLE_SECONDS);
    const ceiling = 0.944;

    let deepest = 1.0;
    let mostReduction = 0.0;
    let f = 0;
    while (f < frames) {
      const block = Math.min(32, frames - f);
      const levelDb = 20.0 * Math.log10(Math.max(this.envelope, 1e-6));
      const reduction = compression > 0 && levelDb > threshold ? (threshold - levelDb) * slope : 0.0;
      if (reduction < mostReduction) mostReduction = reduction;
      const targetGain = Math.pow(10.0, (boost + makeup + reduction) / 20.0);
      const gainStep = (targetGain - this.gain) / block;

      for (let b = 0; b < block; b++) {
        const idx = f + b;
        const inL = workL[idx];
        const inR = workR[idx];
        const peakIn = Math.max(Math.abs(inL), Math.abs(inR));
        this.envelope += (peakIn - this.envelope) * (peakIn > this.envelope ? this.attack : this.release);
        this.gain += gainStep;
        this.amount = target > this.amount ? Math.min(target, this.amount + toggleStep) : Math.max(target, this.amount - toggleStep);

        let l = inL * this.gain;
        let r = inR * this.gain;
        const peakOut = Math.max(Math.abs(l), Math.abs(r)) * this.limiterGain;
        this.limiterGain = peakOut > ceiling
          ? (this.limiterGain * ceiling) / peakOut
          : this.limiterGain + (1.0 - this.limiterGain) * this.limiterRelease;
        if (this.limiterGain < deepest) deepest = this.limiterGain;
        l *= this.limiterGain;
        r *= this.limiterGain;

        workL[idx] = softKnee(inL + (l - inL) * this.amount, 0.95);
        workR[idx] = softKnee(inR + (r - inR) * this.amount, 0.95);
      }
      f += block;
    }
    this.reductionDb = (mostReduction + 20.0 * Math.log10(Math.max(deepest, 1e-6))) * this.amount;
  }
}

// ---- Main Mochy AudioWorkletProcessor ---------------------------------------
class MochyAudioLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate || 48000;
    this.eqBank = null;
    this.fadingFrom = null;
    this.fading = false;
    this.fadePos = 0;
    this.fadeLength = Math.max(1, Math.floor(this.sr * 0.012)); // 12ms click-free EQ crossfade
    this.limiter = new PeakLimiter(this.sr);
    this.reverb = new FreeverbProcessor(this.sr);
    this.spatial = new SpatialProcessor(this.sr);
    this.loudness = new LoudnessProcessor(this.sr);

    this.workL = new Float64Array(128);
    this.workR = new Float64Array(128);
    this.fadeL = new Float64Array(128);
    this.fadeR = new Float64Array(128);

    this.reverbParams = {
      enabled: false, mix: 0.5, roomSize: 0.55, damping: 0.45,
      wet: 0.6, dry: 1.0, width: 1.0, preDelayMs: 12.0, lowCutHz: 180.0
    };
    this.spatialParams = {
      enabled: false, mode: 'Crossfeed', cutoffHz: 700, feedDb: 4.5,
      speakerAngle: 30, amount: 1.0, mono: false
    };
    this.loudnessParams = {
      enabled: false, boostDb: 4.0, compression: 0.3
    };

    this.meterCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'eq') {
        const nextBank = msg.design ? new BiquadBank(msg.design, this.sr, 2) : null;
        if (this.eqBank || nextBank) {
          this.fadingFrom = this.eqBank;
          this.eqBank = nextBank;
          this.fading = true;
          this.fadePos = 0;
        }
      } else if (msg.type === 'reverb') {
        this.reverbParams = { ...this.reverbParams, ...msg.params };
      } else if (msg.type === 'spatial') {
        this.spatialParams = { ...this.spatialParams, ...msg.params };
      } else if (msg.type === 'loudness') {
        this.loudnessParams = { ...this.loudnessParams, ...msg.params };
      } else if (msg.type === 'flush') {
        this.reverb.clearRoom();
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const frames = outL.length;

    if (!input || input.length === 0 || !input[0]) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];

    if (this.workL.length < frames) {
      this.workL = new Float64Array(frames);
      this.workR = new Float64Array(frames);
      this.fadeL = new Float64Array(frames);
      this.fadeR = new Float64Array(frames);
    }

    for (let i = 0; i < frames; i++) {
      this.workL[i] = inL[i];
      this.workR[i] = inR[i];
    }

    // 1. Parametric EQ + 12ms Crossfade + Lookahead PeakLimiter
    if (this.eqBank || this.fading) {
      if (this.fading) {
        this.fadeL.set(this.workL.subarray(0, frames));
        this.fadeR.set(this.workR.subarray(0, frames));
        if (this.fadingFrom) {
          this.fadingFrom.process(this.fadeL, this.fadeR, frames);
        }
      }
      if (this.eqBank) {
        this.eqBank.process(this.workL, this.workR, frames);
      }
      if (this.fading) {
        for (let i = 0; i < frames; i++) {
          const g = this.fadePos >= this.fadeLength ? 1.0 : this.fadePos / this.fadeLength;
          this.workL[i] = this.fadeL[i] + (this.workL[i] - this.fadeL[i]) * g;
          this.workR[i] = this.fadeR[i] + (this.workR[i] - this.fadeR[i]) * g;
          if (this.fadePos < this.fadeLength) this.fadePos++;
        }
        if (this.fadePos >= this.fadeLength) {
          this.fading = false;
          this.fadingFrom = null;
        }
      }
      this.limiter.process(this.workL, this.workR, frames);
    }

    // 2. Spatial Audio (BS2B Crossfeed / Brown-Duda Virtual Speakers / Mono)
    this.spatial.process(this.workL, this.workR, frames, this.spatialParams);

    // 3. Freeverb Reverb (8 damped combs + 4 allpasses per side + pre-delay + low-cut)
    this.reverb.process(this.workL, this.workR, frames, this.reverbParams);

    // 4. Loudness Compressor + Makeup + Soft-Knee -0.5dBFS Peak Limiter
    this.loudness.process(this.workL, this.workR, frames, this.loudnessParams);

    let peak = 0;
    for (let i = 0; i < frames; i++) {
      const l = this.workL[i];
      const r = this.workR[i];
      outL[i] = l;
      if (outR !== outL) outR[i] = r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
    }

    this.meterCounter += frames;
    if (this.meterCounter >= 2048) {
      this.meterCounter = 0;
      this.port.postMessage({
        type: 'meter',
        level: peak,
        reductionDb: this.loudness.reductionDb
      });
    }

    return true;
  }
}

registerProcessor('mochy-audio-lab-processor', MochyAudioLabProcessor);
