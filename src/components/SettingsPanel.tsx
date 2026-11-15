import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { CHARACTER_BY_ID } from '../engine/characters';
import type { Settings, TechniqueId } from '../engine/types';
import { TECH_INFO } from './Hud';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onDemo: (id: TechniqueId) => void;
}

function Toggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="flex flex-col">
        <span className="text-xs text-white/85">{label}</span>
        {sub && <span className="text-[10px] leading-snug text-white/45">{sub}</span>}
      </span>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Slider({ label, sub, value, onChange }: { label: string; sub: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block py-1.5">
      <span className="flex justify-between text-xs text-white/85">
        {label}
        <span className="font-mono text-white/55">×{value.toFixed(2)}</span>
      </span>
      <input type="range" min={0.6} max={1.6} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
      <span className="text-[10px] text-white/45">{sub}</span>
    </label>
  );
}

export function SettingsPanel({ settings, onChange, onClose, onDemo }: Props) {
  const set = (p: Partial<Settings>) => onChange({ ...settings, ...p });
  const techs = CHARACTER_BY_ID[settings.character].techniques.filter((id) => id !== 'limitless');
  return (
    <motion.div
      className="glass pointer-events-auto absolute right-3 top-16 z-40 max-h-[calc(100%-5rem)] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto p-4 sm:right-5 sm:top-20"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="hud-label">Настройки</span>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-white/60 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Toggle
        label="DOMAIN_COMBOS"
        sub="Dismantle можно использовать во время Malevolent Shrine"
        value={settings.domainCombos}
        onChange={(v) => set({ domainCombos: v })}
      />
      {settings.character === 'all' && (
        <div className="py-1.5">
          <div className="text-xs text-white/85">✌️ в режиме ALL TECHNIQUES</div>
          <div className="text-[10px] text-white/45">Поза «два пальца» одинакова у Red и Dismantle — выберите, кому она принадлежит</div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {(['limitless', 'dismantle'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set({ allPoseMode: m })}
                className={`rounded-md border px-2 py-1 text-[11px] ${settings.allPoseMode === m ? 'border-white/40 bg-white/15 text-white' : 'border-white/10 text-white/55'}`}
              >
                {m === 'limitless' ? 'Blue / Red' : 'Dismantle'}
              </button>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Debug-режим" sub="пальцы, кандидаты жестов, уверенность, причины отклонения" value={settings.debug} onChange={(v) => set({ debug: v })} />
      <Slider label="Время удержания" sub="все удержания жестов" value={settings.holdScale} onChange={(v) => set({ holdScale: v })} />
      <Slider label="Порог скорости" sub="меньше — чувствительнее к взмахам и ударам" value={settings.motionScale} onChange={(v) => set({ motionScale: v })} />

      {settings.debug && techs.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="hud-label mb-1.5">Тест эффектов (без жеста)</div>
          <div className="grid grid-cols-2 gap-1">
            {techs.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onDemo(id)}
                className="rounded-md border border-white/10 px-2 py-1 text-left text-[11px] hover:bg-white/10"
                style={{ color: TECH_INFO[id].color }}
              >
                {TECH_INFO[id].name}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
