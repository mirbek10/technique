import { motion } from 'framer-motion';
import { AlertTriangle, Camera, Loader2, ShieldCheck, Zap } from 'lucide-react';

interface Props {
  phase: 'intro' | 'loading' | 'error';
  error: string;
  step: string;
  onActivate: () => void;
}

export function IntroScreen({ phase, error, step, onActivate }: Props) {
  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-[#05030a] px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(12px)' }}
      transition={{ duration: 0.6 }}
    >
      {/* background orbs */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-[85%] -translate-y-1/2 rounded-full bg-cblue/25 blur-[90px]"
        animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-[15%] -translate-y-1/2 rounded-full bg-cred/20 blur-[90px]"
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.8, 0.55, 0.8] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="pointer-events-none absolute inset-0 scanlines" />
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-cpurple/30"
          style={{ width: `${40 + i * 18}vmin`, height: `${40 + i * 18}vmin`, x: '-50%', y: '-50%' }}
          animate={{ rotate: i % 2 ? -360 : 360, scale: [1, 1.03, 1] }}
          transition={{ rotate: { duration: 30 + i * 10, repeat: Infinity, ease: 'linear' }, scale: { duration: 3, repeat: Infinity } }}
        />
      ))}

      <div className="relative flex max-w-xl flex-col items-center text-center">
        <motion.p
          className="hud-label mb-4 text-white/60"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          Limitless · система распознавания жестов
        </motion.p>
        <motion.h1
          className="font-display text-4xl font-black leading-tight tracking-[0.12em] text-white sm:text-6xl"
          initial={{ opacity: 0, letterSpacing: '0.5em' }}
          animate={{ opacity: 1, letterSpacing: '0.12em' }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        >
          <span className="text-cblue">BLUE</span> · <span className="text-cred">RED</span>
          <br />
          <span className="text-glow-purple text-[#d8a8ff]">HOLLOW PURPLE</span>
        </motion.h1>
        <motion.p
          className="mt-5 max-w-md text-sm leading-relaxed text-white/65 sm:text-base"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Поднимите руки перед веб-камерой и управляйте девятью техниками: Годжо, Сукуна, Юдзи, Мэгуми и Чосо.
          Персонажа можно сменить в любой момент — камера продолжит работать.
        </motion.p>

        {phase === 'error' && (
          <motion.div
            className="mt-6 flex items-start gap-3 rounded-xl border border-cred/40 bg-cred/10 px-4 py-3 text-left text-sm text-red-100"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cred" />
            <span>{error}</span>
          </motion.div>
        )}

        <motion.button
          type="button"
          onClick={onActivate}
          disabled={phase === 'loading'}
          className="group relative mt-8 inline-flex items-center gap-3 overflow-hidden rounded-full border border-white/15 bg-gradient-to-r from-cblue via-cpurple to-cred px-8 py-4 font-display text-sm font-bold uppercase tracking-[0.2em] text-white shadow-[0_0_40px_rgba(160,32,240,0.55)] transition-shadow hover:shadow-[0_0_70px_rgba(160,32,240,0.85)] disabled:cursor-wait disabled:opacity-80"
          whileHover={{ scale: phase === 'loading' ? 1 : 1.04 }}
          whileTap={{ scale: 0.97 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          {phase === 'loading' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
          {phase === 'loading' ? step || 'Инициализация…' : phase === 'error' ? 'Попробовать снова' : 'Активировать способности'}
        </motion.button>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" /> Нужен доступ к камере
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Видео не покидает устройство
          </span>
        </div>
      </div>
    </motion.div>
  );
}
