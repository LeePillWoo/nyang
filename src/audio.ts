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
