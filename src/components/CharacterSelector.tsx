import { motion } from 'framer-motion';
import { CHARACTERS } from '../engine/characters';
import type { CharacterId } from '../engine/types';

interface Props {
  value: CharacterId;
  onChange: (id: CharacterId) => void;
}

/** Character switch: the camera and hand tracking keep running; only the gesture set changes. */
export function CharacterSelector({ value, onChange }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-3 sm:pt-4">
      <div role="radiogroup" aria-label="Персонаж" className="glass pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto p-1">
        {CHARACTERS.map((c) => {
          const on = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(c.id)}
              title={c.name}
              className="relative shrink-0 rounded-lg px-2.5 py-1.5 font-display text-[10px] font-bold tracking-[0.12em] transition-colors sm:px-3 sm:text-[11px]"
              style={{ color: on ? '#fff' : `${c.accent}cc` }}
            >
              {on && (
                <motion.span
                  layoutId="char-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: `${c.accent}33`, boxShadow: `inset 0 0 0 1px ${c.accent}aa, 0 0 16px ${c.accent}55` }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">{c.short.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
