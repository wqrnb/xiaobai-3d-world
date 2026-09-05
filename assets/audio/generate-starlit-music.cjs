/**
 * Starlit Steps / 星光轻步 — original procedural music.
 * All oscillators and percussion are synthesized from math and seeded noise.
 * No third-party recordings, samples, melodies, or external packages are used.
 * Dedicated under CC0-1.0 to the extent permitted by applicable law.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RATE = 44100;
const BPM = 128;
const BEAT = 60 / BPM;
const BEATS = 64;
const SECONDS = BEATS * BEAT;
const N = Math.round(RATE * SECONDS);
const TAU = Math.PI * 2;
const dryL = new Float64Array(N);
const dryR = new Float64Array(N);
const rhythmL = new Float64Array(N);
const rhythmR = new Float64Array(N);
const freq = midi => 440 * 2 ** ((midi - 69) / 12);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
let seed = 0x510A73;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
function smoothstep(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

// Every voice is accumulated on a circular timeline. Release tails from the
// final bar continue at the beginning, so the exported file is a steady loop.
function voice(startBeat, durationSeconds, pan, amplitude, oscillator, rhythm = false) {
  const offset = Math.round(startBeat * BEAT * RATE);
  const count = Math.ceil(durationSeconds * RATE);
  const gainL = Math.cos((pan + 1) * Math.PI / 4) * amplitude;
  const gainR = Math.sin((pan + 1) * Math.PI / 4) * amplitude;
  const targetL = rhythm ? rhythmL : dryL;
  const targetR = rhythm ? rhythmR : dryR;
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const value = oscillator(t, durationSeconds);
    const index = (offset + i) % N;
    targetL[index] += value * gainL;
    targetR[index] += value * gainR;
  }
}

function bell(beat, midi, strength = 1, pan = 0) {
  const f = freq(midi);
  voice(beat, 2.9, pan, 0.078 * strength, (t, duration) => {
    const attack = 1 - Math.exp(-t * 230);
    const end = 1 - smoothstep((t - (duration - 0.28)) / 0.28);
    return attack * end * (
      Math.sin(TAU * f * t) * Math.exp(-t * 2.3) +
      0.27 * Math.sin(TAU * f * 2.006 * t) * Math.exp(-t * 4.8) +
      0.10 * Math.sin(TAU * f * 3.99 * t) * Math.exp(-t * 7.7)
    );
  });
}

function pad(beat, notes, chordIndex) {
  const duration = 8 * BEAT + 1.4;
  notes.forEach((midi, k) => {
    const f = freq(midi);
    const phase = (k + 1) * 0.63 + chordIndex * 0.4;
    voice(beat, duration, [-0.65, -0.2, 0.25, 0.65][k], 0.021, (t, d) => {
      const envelope = smoothstep(t / 0.65) * (1 - smoothstep((t - (d - 1.5)) / 1.5));
      const softness = 0.90 + 0.10 * Math.cos(TAU * 0.27 * t);
      return envelope * softness * (
        0.63 * Math.sin(TAU * f * t + phase) +
        0.28 * Math.sin(TAU * f * 1.0018 * t - phase) +
        0.07 * Math.sin(TAU * f * 2 * t) +
        0.02 * Math.sin(TAU * f * 3 * t)
      );
    });
  });
}

function bass(beat, midi) {
  const f = freq(midi);
  voice(beat, 1.45, 0, 0.037, (t, d) =>
    smoothstep(t / 0.025) * Math.exp(-t * 1.9) *
    (1 - smoothstep((t - d + 0.2) / 0.2)) *
    (Math.sin(TAU * f * t) + 0.12 * Math.sin(TAU * f * 2 * t))
  );
}

function kick(beat, strength) {
  voice(beat, 0.32, 0, 0.041 * strength, (t, d) => {
    const phase = TAU * (56 * t + 1.28 * (1 - Math.exp(-t * 25)));
    return (1 - Math.exp(-t * 600)) * Math.exp(-t * 15) *
      (1 - smoothstep((t - d + 0.035) / 0.035)) * Math.sin(phase);
  }, true);
}

function brush(beat, strength, pan) {
  let previous = 0;
  let low = 0;
  voice(beat, 0.065, pan, 0.016 * strength, (t, d) => {
    const noise = random() * 2 - 1;
    low += 0.23 * (noise - low);
    const high = low - previous;
    previous = low;
    return high * (1 - Math.exp(-t * 1300)) * Math.exp(-t * 85) *
      (1 - smoothstep((t - d + 0.012) / 0.012));
  }, true);
}

// Two 8-bar phrases. Major ninth and suspended voicings keep the mood open.
const chords = [
  { notes: [50, 57, 61, 64], root: 38 },
  { notes: [47, 54, 57, 61], root: 35 },
  { notes: [43, 54, 57, 62], root: 31 },
  { notes: [45, 52, 59, 62], root: 33 },
  { notes: [50, 57, 61, 64], root: 38 },
  { notes: [47, 54, 57, 61], root: 35 },
  { notes: [43, 54, 57, 62], root: 31 },
  { notes: [45, 52, 59, 62], root: 33 },
];
chords.forEach((chord, i) => {
  pad(i * 8, chord.notes, i);
  bass(i * 8, chord.root);
  bass(i * 8 + 4, chord.root + 12);
  // A restrained, off-beat shimmer beneath the lead melody.
  [1.5, 3.5, 5.5, 7].forEach((step, j) =>
    bell(i * 8 + step, chord.notes[(j + i) % 4] + 24, 0.16, j % 2 ? 0.53 : -0.53)
  );
});

// Freshly composed note events, in beats and MIDI pitches; no imported tune.
const melody = [
  [0.5, 74, 0.73], [1.75, 78, 0.52], [3, 81, 0.64], [5.5, 76, 0.53], [6.5, 78, 0.40],
  [8.5, 78, 0.62], [10, 73, 0.49], [11.5, 74, 0.47], [13, 81, 0.58], [14.75, 78, 0.40],
  [16.5, 79, 0.63], [18, 81, 0.48], [19, 78, 0.53], [21.5, 74, 0.57], [23, 76, 0.40],
  [24.75, 76, 0.58], [26, 83, 0.47], [28, 81, 0.56], [30.5, 76, 0.41],
  [32.5, 78, 0.65], [33.75, 81, 0.49], [35.5, 85, 0.53], [37, 83, 0.42], [38.5, 81, 0.47],
  [40.5, 78, 0.59], [42.5, 74, 0.48], [44, 73, 0.43], [45.5, 78, 0.55], [47, 81, 0.39],
  [48.5, 83, 0.53], [50, 81, 0.49], [51.5, 79, 0.53], [53.5, 78, 0.42], [55, 74, 0.43],
  [56.5, 76, 0.56], [58, 81, 0.43], [59.5, 83, 0.46], [61.5, 81, 0.37], [63, 76, 0.31],
];
melody.forEach(([beat, midi, strength], i) => bell(beat, midi, strength, Math.sin(i * 1.13) * 0.26));

for (let beat = 0; beat < BEATS; beat += 4) {
  kick(beat, 0.82);
  kick(beat + 2, 0.50);
}
for (let step = 0; step < BEATS * 2; step++) {
  const beat = step / 2;
  brush(beat + (step % 2 ? 0.032 : 0), step % 2 ? 0.5 : 0.85, step % 2 ? 0.20 : -0.20);
}

const outputL = new Float64Array(N);
const outputR = new Float64Array(N);
const taps = [
  [0.375 * BEAT, 0.16], [0.75 * BEAT, 0.13],
  [1.5 * BEAT, 0.092], [2.25 * BEAT, 0.062],
  [3.375 * BEAT, 0.038], [4.5 * BEAT, 0.023],
].map(([seconds, gain]) => [Math.round(seconds * RATE), gain]);
let meanL = 0;
let meanR = 0;
for (let i = 0; i < N; i++) {
  let l = dryL[i] + rhythmL[i];
  let r = dryR[i] + rhythmR[i];
  taps.forEach(([delay, gain], j) => {
    const index = (i - delay + N) % N;
    l += (j % 2 ? dryL[index] : dryR[index]) * gain;
    r += (j % 2 ? dryR[index] : dryL[index]) * gain;
  });
  outputL[i] = l;
  outputR[i] = r;
  meanL += l;
  meanR += r;
}
meanL /= N;
meanR /= N;
let peak = 0;
for (let i = 0; i < N; i++) {
  outputL[i] -= meanL;
  outputR[i] -= meanR;
  peak = Math.max(peak, Math.abs(outputL[i]), Math.abs(outputR[i]));
}
// Deliberately conservative background-music level: sample peak -10 dBFS.
const gain = (10 ** (-10 / 20)) / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(pcm.length - 8, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(N * 4, 40);
let sumSquares = 0;
let peakPcm = 0;
let clippedSamples = 0;
let maxStep = 0;
let previousL;
let previousR;
for (let i = 0; i < N; i++) {
  const l = Math.round(outputL[i] * gain * 32767);
  const r = Math.round(outputR[i] * gain * 32767);
  pcm.writeInt16LE(l, 44 + i * 4);
  pcm.writeInt16LE(r, 46 + i * 4);
  peakPcm = Math.max(peakPcm, Math.abs(l), Math.abs(r));
  sumSquares += l * l + r * r;
  if (Math.abs(l) >= 32767 || Math.abs(r) >= 32767) clippedSamples++;
  if (i > 0) maxStep = Math.max(maxStep, Math.abs(l - previousL), Math.abs(r - previousR));
  previousL = l;
  previousR = r;
}
const filename = path.join(__dirname, 'starlit-steps-original-loop.wav');
fs.writeFileSync(filename, pcm);
const seamJump = Math.max(
  Math.abs(pcm.readInt16LE(44) - pcm.readInt16LE(44 + (N - 1) * 4)),
  Math.abs(pcm.readInt16LE(46) - pcm.readInt16LE(46 + (N - 1) * 4)),
) / 32768;
const report = {
  title: '星光轻步 / Starlit Steps',
  file: filename,
  source: 'Original mathematical synthesis; no third-party samples or recordings',
  license: 'CC0-1.0 to the extent permitted by applicable law',
  sampleRate: RATE,
  channels: 2,
  bitsPerSample: 16,
  bpm: BPM,
  bars: 16,
  durationSeconds: N / RATE,
  frames: N,
  bytes: pcm.length,
  peakAmplitude: peakPcm / 32768,
  peakDbFS: 20 * Math.log10(peakPcm / 32768),
  rmsDbFS: 20 * Math.log10(Math.sqrt(sumSquares / (N * 2)) / 32768),
  clippedSamples,
  seamJumpAmplitude: seamJump,
  maxAdjacentSampleStepAmplitude: maxStep / 32768,
  loopMethod: 'Circular voice tails and circular stereo ambience; no fade-to-silence gap',
};
fs.writeFileSync(path.join(__dirname, 'starlit-steps-audio-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
