import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Cinematic } from '../engine/types';

/** Big cinematic technique name in the centre of the screen (DOMAIN EXPANSION / attack names). */
export function CinematicTitle({ cine }: { cine: Cinematic | null }) {
  const [shown, setShown] = useState<Cinematic | null>(null);

  useEffect(() => {
    if (!cine) return;
    setShown(cine);
    const id = window.setTimeout(() => setShown((s) => (s?.key === cine.key ? null : s)), cine.duration * 1000);
    return () => window.clearTimeout(id);
  }, [cine]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
      <AnimatePresence mode="popLayout">
        {shown && (
          <motion.div
            key={shown.key}
            className="flex flex-col items-center text-center"
            initial={{ opacity: 0, scale: shown.big ? 1.6 : 1.25, filter: 'blur(14px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.92, filter: 'blur(8px)' }}
            transition={{ duration: shown.big ? 0.55 : 0.18, ease: 'easeOut' }}
          >
            {shown.pre && (
              <motion.span
                className="font-display text-xs font-bold uppercase tracking-[0.6em] text-white/80 sm:text-base"
                initial={{ opacity: 0, letterSpacing: '1.2em' }}
                animate={{ opacity: 1, letterSpacing: '0.6em' }}
                transition={{ duration: 0.9 }}
              >
                {shown.pre}
              </motion.span>
            )}
            <span
              className={`font-display font-black tracking-[0.16em] ${shown.big ? 'text-3xl sm:text-6xl' : 'text-xl sm:text-3xl'}`}
              style={{ color: '#fff', textShadow: `0 0 14px ${shown.color}, 0 0 38px ${shown.color}, 0 0 80px ${shown.color}aa` }}
            >
              {shown.title}
            </span>
            {shown.sub && <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.3em] text-white/60">{shown.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
