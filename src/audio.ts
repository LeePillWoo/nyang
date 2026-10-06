/**
 * 타격음. 오디오 파일이 아직 없어서 Web Audio 로 만들어 쓴다.
 * ponytail: 합성음. 실제 효과음 에셋이 생기면 Howler 로 갈아끼운다 (GDD 10장).
 */
let ac: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null; // 오디오를 못 쓰는 환경이어도 게임은 돌아야 한다
    }
    const b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = b;
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

/** 브라우저는 사용자 입력 전에는 소리를 못 낸다. 첫 입력에서 한 번 불러준다. */
export const unlockAudio = () => void audio();

function envelope(a: AudioContext, peak: number, dur: number) {
  const g = a.createGain();
  g.gain.setValueAtTime(peak, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + dur);
  g.connect(a.destination);
  return g;
}

/** 퍽 — 냥펀치가 맞았을 때. strong 이면 저음을 한 겹 깔아 묵직하게 */
export function sfxHit(strong = false) {
  const a = audio();
  if (!a || !noise) return;
  const t = a.currentTime;

  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = strong ? 260 : 640;
  f.Q.value = 0.8;
  src.connect(f);
  f.connect(envelope(a, strong ? 0.45 : 0.22, strong ? 0.26 : 0.11));
  src.start(t);
  src.stop(t + 0.35);

  if (!strong) return;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(58, t + 0.2);
  o.connect(envelope(a, 0.38, 0.24));
  o.start(t);
  o.stop(t + 0.26);
}

/** 뿅 — 쥐가 연기와 함께 도망갈 때 (GDD 1장: 폭력 표현 없음) */
export function sfxPop() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(460, t);
  o.frequency.exponentialRampToValueAtTime(1350, t + 0.13);
  o.connect(envelope(a, 0.22, 0.17));
  o.start(t);
  o.stop(t + 0.2);
}

/** 냥! — 고양이가 맞았을 때 */
export function sfxHurt() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(760, t);
  o.frequency.exponentialRampToValueAtTime(230, t + 0.18);
  o.connect(envelope(a, 0.3, 0.2));
  o.start(t);
  o.stop(t + 0.24);
}

/** 걸러낸 노이즈 한 번. 필드 효과음들이 쓴다 */
function burst(type: BiquadFilterType, freq: number, q: number, peak: number, dur: number, sweepTo?: number) {
  const a = audio();
  if (!a || !noise) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  src.connect(f);
  f.connect(envelope(a, peak, dur));
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** 탁 — 도끼로 수풀을 칠 때. 나무를 두드리는 높은 소리 + 짧은 저음 */
export function sfxChop() {
  burst('bandpass', 1300, 2.2, 0.22, 0.07);
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(230, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
  o.connect(envelope(a, 0.22, 0.1));
  o.start(t);
  o.stop(t + 0.12);
}

/** 첨벙 — 배에 올라타고 내릴 때 */
export const sfxSplash = () => burst('lowpass', 2400, 0.7, 0.28, 0.32, 380);

/** 찰랑 — 노를 한 번 저을 때 (작게) */
export const sfxRow = () => burst('bandpass', 750, 1.2, 0.07, 0.14);

/** 짧은 음 하나. 낚시 효과음들이 쓴다 */
function tone(type: OscillatorType, from: number, to: number, peak: number, dur: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  g.connect(a.destination);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ── 낚시 ──
/** 휙 — 낚싯대를 던질 때 */
export const sfxCast = () => burst('bandpass', 500, 0.9, 0.12, 0.3, 2200);
/** 퐁당 — 찌가 물에 떨어질 때 */
export function sfxPlop() {
  burst('lowpass', 1600, 0.7, 0.14, 0.2, 400);
  tone('sine', 620, 190, 0.16, 0.14);
}
/** 톡 — 물고기가 찌를 건드릴 때. strength 0.5 짧은 톡 · 1 큰 톡. 음높이를 조금씩 흔들어 매번 다르게 */
export const sfxNibble = (strength = 1) => {
  const f = 780 + Math.random() * 260;
  tone('sine', f, f * 0.72, 0.04 + 0.05 * strength, 0.04 + 0.04 * strength);
};
/** 퐁 — 헛잠김 (반쯤 잠겼다 떠오름) */
export const sfxDunk = () => tone('sine', 560, 300, 0.12, 0.1);
/** 스르륵 — 물고기가 찌를 살살 끌 때 (간 보기) */
export const sfxDrag = () => burst('bandpass', 1400, 1.4, 0.12, 0.45, 500);
/** 퐁! — 찌가 팍 잠길 때 (진짜 입질) */
export function sfxBite() {
  tone('sine', 480, 120, 0.26, 0.2);
  burst('lowpass', 1200, 0.8, 0.12, 0.18, 300);
}
/** 딸깍 — 릴을 감는 동안 계속 */
export const sfxReel = () => burst('bandpass', 3200, 6, 0.05, 0.025);
/** 팅 — 줄이 끊어질 때 */
export function sfxSnap() {
  tone('triangle', 1400, 260, 0.22, 0.3);
  burst('highpass', 2500, 0.7, 0.1, 0.12);
}
/** 띠리링 — 낚았을 때 */
export function sfxCatch() {
  tone('sine', 660, 660, 0.16, 0.14);
  tone('sine', 880, 880, 0.16, 0.14, 0.1);
  tone('sine', 1320, 1320, 0.18, 0.3, 0.2);
}

// ── 줍기 ──
/** 짤랑 — 냥코인 */
export function sfxCoin() {
  tone('square', 1320, 1320, 0.035, 0.05);
  tone('square', 1760, 1760, 0.035, 0.09, 0.05);
}
/** 뾱 — 아이템 */
export const sfxPickup = () => tone('triangle', 520, 1040, 0.14, 0.12);
/** 둥 — 가방이 가득 참 */
export const sfxFull = () => tone('sine', 300, 200, 0.14, 0.22);

/** 폴짝 — 샌드보드 점프 */
export const sfxJump = () => tone('triangle', 420, 880, 0.12, 0.16);
/** 촤악 — 샌드보드가 미끄러지기 시작할 때 모래를 긁는 소리 (k = 미끄러짐 세기 0..1) */
export const sfxSlide = (k = 1) => burst('bandpass', 2600, 0.7, 0.05 + 0.08 * k, 0.32, 800);
/** 슈욱 — 엣지가 물려 카빙으로 빨라질 때 올라가는 바람 소리 (gain = 붙는 속도 m/s) */
export const sfxRush = (gain: number) => burst('bandpass', 420, 1.1, Math.min(0.16, 0.03 + gain * 0.02), 0.42, 2600);

// ── 던전 기술 · 웨이브 ──
/** 휙 — 털뭉치·실타래·헤어볼·태엽 쥐를 던질 때 (작게) */
export const sfxThrow = () => burst('bandpass', 900, 1, 0.05, 0.12, 1900);
/** 펑 — 헤어볼·태엽 쥐가 터질 때 */
export function sfxBoom() {
  burst('lowpass', 1100, 0.8, 0.2, 0.3, 180);
  tone('sine', 140, 60, 0.18, 0.22);
}
/** 쿵 — 상자가 떨어질 때 */
export function sfxThud() {
  burst('lowpass', 500, 0.9, 0.26, 0.24, 110);
  tone('sine', 110, 50, 0.22, 0.2);
}
/** 찌릿 — 치명타 */
export const sfxZap = () => tone('square', 1300, 320, 0.05, 0.14);
/** 퐁 — 보호막이 막을 때 */
export function sfxShield() {
  tone('triangle', 700, 1400, 0.1, 0.16);
  burst('highpass', 2400, 0.8, 0.06, 0.18);
}
/** 하악 */
export const sfxHiss = () => burst('highpass', 2800, 0.6, 0.12, 0.38, 5200);
/** 휘익 — 꼬리 회오리 */
export const sfxSwirl = () => burst('bandpass', 600, 1.1, 0.1, 0.34, 1700);
/** 둥 — 충격파 */
export const sfxRing = () => tone('sine', 320, 110, 0.14, 0.24);
/** 톡 — 털실 올가미 */
export const sfxSnare = () => tone('sine', 480, 820, 0.07, 0.12);
/** 탁 — 빙글 상자가 부딪힐 때 */
export const sfxBox = () => burst('bandpass', 520, 1.6, 0.08, 0.07);
/** 틱 — 생선뼈를 먹을 때 (작게) */
export const sfxBone = () => tone('triangle', 1500, 1900, 0.04, 0.06);
/** 냠 — 생선 비스킷 */
export const sfxSnack = () => {
  tone('triangle', 620, 900, 0.1, 0.1);
  tone('triangle', 820, 1200, 0.08, 0.1, 0.09);
};
/** 띠리링 — 레벨 업 */
export function sfxLevel() {
  tone('triangle', 660, 660, 0.12, 0.12);
  tone('triangle', 880, 880, 0.12, 0.12, 0.1);
  tone('triangle', 1320, 1320, 0.14, 0.22, 0.2);
}
/** 뿌우 — 웨이브 시작 (clear 면 밝게) */
export function sfxWave(clear: boolean) {
  if (clear) {
    tone('triangle', 520, 520, 0.1, 0.12);
    tone('triangle', 780, 780, 0.12, 0.2, 0.12);
  } else tone('sawtooth', 180, 240, 0.07, 0.45);
}
/** 퐁 — 몬스터가 나타날 때 (정예는 낮고 크게) */
export const sfxSpawn = (elite: boolean) => (elite ? tone('sawtooth', 120, 80, 0.12, 0.5) : burst('lowpass', 700, 0.8, 0.05, 0.12, 300));
