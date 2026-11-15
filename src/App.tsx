import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IntroScreen } from './components/IntroScreen';
import { Hud } from './components/Hud';
import { CharacterSelector } from './components/CharacterSelector';
import { SettingsPanel } from './components/SettingsPanel';
import { GestureDebugger } from './components/GestureDebugger';
import { CinematicTitle } from './components/CinematicTitle';
import { CHARACTER_BY_ID } from './engine/characters';
import { GojoEngine } from './engine/engine';
import { AudioEngine } from './engine/audio';
import { createHandTracker } from './engine/handTracker';
import { DEFAULT_SETTINGS, INITIAL_STATS, type CharacterId, type Cinematic, type HudStats, type Quality, type Settings, type TechniqueId } from './engine/types';

type Phase = 'intro' | 'loading' | 'running' | 'error';
const QUALITY_CYCLE: Quality[] = ['auto', 'high', 'medium', 'low'];
const SETTINGS_KEY = 'limitless.settings.v1';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Some Windows drivers refuse specific resolution/frame-rate combos with NotReadableError
 * ("Could not start video source"). Try progressively simpler constraints.
 */
async function openCamera(): Promise<MediaStream> {
  const attempts: MediaTrackConstraints[] = [
    { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    { width: { ideal: 640 }, height: { ideal: 480 } },
  ];
  let lastError: unknown;
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      lastError = e;
      const name = e instanceof DOMException ? e.name : '';
      // permission problems won't be fixed by other constraints
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') throw e;
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch {
    throw lastError;
  }
}

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Доступ к камере запрещён. Разрешите камеру в настройках браузера и попробуйте снова.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена. Подключите веб-камеру.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'Камера занята. Закройте другие вкладки с камерой (например, другой проект на localhost), Zoom/Teams/Discord или приложение «Камера» Windows и попробуйте снова.';
  if (!window.isSecureContext) return 'Камера работает только по HTTPS или на localhost.';
  return e instanceof Error ? e.message : 'Не удалось запустить распознавание.';
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GojoEngine | null>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const [stats, setStats] = useState<HudStats>(INITIAL_STATS);
  const [quality, setQuality] = useState<Quality>('auto');
  const [muted, setMuted] = useState(false);
  const [skeleton, setSkeleton] = useState(true);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cine, setCine] = useState<Cinematic | null>(null);
  const settingsRef = useRef(settings);

  const activate = useCallback(async () => {
    if (phase === 'loading') return;
    setPhase('loading');
    setError('');
    const audio = new AudioEngine();
    audio.init(); // inside the click handler so the browser allows sound
    let stream: MediaStream | null = null;
    try {
      setStep('Запуск камеры…');
      const trackerPromise = createHandTracker();
      trackerPromise.catch(() => undefined); // handled below; avoid unhandled-rejection noise
      stream = await openCamera();
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setStep('Загрузка нейросети…');
      const tracker = await trackerPromise;
      const engine = new GojoEngine({
        video,
        canvas: canvasRef.current!,
        stage: stageRef.current!,
        label: labelRef.current!,
        landmarker: tracker.landmarker,
        delegate: tracker.delegate,
        audio,
        onStats: setStats,
        onCinematic: setCine,
      });
      engine.setSettings(settingsRef.current);
      engine.setQuality(quality);
      engine.setMuted(muted);
      engine.setSkeleton(skeleton);
      engineRef.current = engine;
      engine.start();
      setPhase('running');
    } catch (e) {
      console.error(e);
      stream?.getTracks().forEach((t) => t.stop());
      audio.dispose();
      setError(cameraErrorMessage(e));
      setPhase('error');
    }
  }, [phase, quality, muted, skeleton]);

  useEffect(() => () => engineRef.current?.destroy(), []);

  const cycleQuality = () => {
    const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(quality) + 1) % QUALITY_CYCLE.length];
    setQuality(next);
    engineRef.current?.setQuality(next);
  };
  const toggleMute = () => {
    setMuted((m) => {
      engineRef.current?.setMuted(!m);
      return !m;
    });
  };
  const toggleSkeleton = () => {
    setSkeleton((s) => {
      engineRef.current?.setSkeleton(!s);
      return !s;
    });
  };

  const updateSettings = useCallback((s: Settings) => {
    settingsRef.current = s;
    setSettingsState(s);
    saveSettings(s);
    engineRef.current?.setSettings(s);
  }, []);
  const selectCharacter = (id: CharacterId) => updateSettings({ ...settingsRef.current, character: id });
  const toggleDebug = () => updateSettings({ ...settingsRef.current, debug: !settingsRef.current.debug });
  const demo = (id: TechniqueId) => engineRef.current?.demo(id);
  const accent = CHARACTER_BY_ID[settings.character].accent;

  const purple = stats.state === 'PURPLE_CHARGING' || stats.state === 'PURPLE_READY';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05030a] font-sans text-white" style={{ '--accent': accent } as CSSProperties}>
      {/* stage: shaken as one piece so video and effects stay aligned */}
      <div ref={stageRef} className="absolute inset-0 will-change-transform">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-700 ${phase === 'running' ? 'opacity-100' : 'opacity-0'}`}
          playsInline
          muted
        />
        <div className="vignette pointer-events-none absolute inset-0" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <div ref={labelRef} className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform">
          <AnimatePresence>
            {purple && (
              <motion.div
                key="hp"
                className="flex flex-col items-center"
                initial={{ opacity: 0, scale: 1.8, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.8, filter: 'blur(6px)' }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              >
                <span className="text-glow-purple whitespace-nowrap font-display text-2xl font-black tracking-[0.28em] text-[#f1ddff] sm:text-4xl">
                  HOLLOW PURPLE
                </span>
                <motion.span
                  className="mt-1 font-mono text-[10px] uppercase tracking-[0.4em] text-white/70 sm:text-xs"
                  animate={{ opacity: stats.state === 'PURPLE_READY' ? [0.5, 1, 0.5] : 0.6 }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                >
                  {stats.state === 'PURPLE_READY' ? 'готов · взмах рукой' : 'накопление энергии'}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {phase === 'running' && (
        <>
          <CinematicTitle cine={cine} />
          <Hud
            stats={stats}
            settings={settings}
            quality={quality}
            onQuality={cycleQuality}
            muted={muted}
            onMute={toggleMute}
            skeleton={skeleton}
            onSkeleton={toggleSkeleton}
            settingsOpen={settingsOpen}
            onSettings={() => setSettingsOpen((o) => !o)}
            onDebug={toggleDebug}
          />
          <CharacterSelector value={settings.character} onChange={selectCharacter} />
          {settings.debug && stats.debug && <GestureDebugger info={stats.debug} stats={stats} />}
          <AnimatePresence>
            {settingsOpen && <SettingsPanel key="settings" settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} onDemo={demo} />}
          </AnimatePresence>
        </>
      )}

      <AnimatePresence>
        {phase !== 'running' && <IntroScreen key="intro" phase={phase} error={error} step={step} onActivate={activate} />}
      </AnimatePresence>
    </div>
  );
}
 