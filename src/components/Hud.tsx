import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Activity, Bone, Bug, Cpu, Crosshair, Gauge, Hand, Settings2, Volume2, VolumeX } from 'lucide-react';
import type { AbilityState, HudStats, Quality, Settings, TechniqueHud, TechniqueId } from '../engine/types';
import { COLORS } from '../engine/types';
import { GESTURE_LABEL, type Gesture } from '../engine/gestures';
import { CHARACTER_BY_ID } from '../engine/characters';

const ABILITY: Record<AbilityState, { name: string; sub: string; color: string }> = {
  IDLE: { name: 'Ожидание', sub: 'поднимите указательный палец', color: '#94a3b8' },
  BLUE_ACTIVE: { name: 'BLUE', sub: 'притяжение · накопление', color: COLORS.blue },
  BLUE_RED_ACTIVE: { name: 'BLUE + RED', sub: 'сведите кончики пальцев', color: COLORS.red },
  MERGING: { name: 'Слияние', sub: 'удерживайте пальцы вместе', color: '#c86bff' },
  PURPLE_CHARGING: { name: 'HOLLOW PURPLE', sub: 'накопление · разведите пальцы', color: COLORS.purple },
  PURPLE_READY: { name: 'HOLLOW PURPLE', sub: 'готов · резкий взмах рукой', color: '#d68cff' },
  FIRING: { name: 'Выстрел', sub: '', color: '#ffffff' },
  COOLDOWN: { name: 'Перезарядка', sub: '', color: '#64748b' },
};

export const TECH_INFO: Record<TechniqueId, { name: string; color: string; hint: string }> = {
  limitless: { name: 'Blue · Red · Purple', color: COLORS.blue, hint: '☝️ Blue · ✌️ Red · свести кончики → Purple' },
  unlimitedVoid: { name: 'Unlimited Void', color: '#b98cff', hint: '🤞 скрестить пальцы (безымянный и мизинец согнуты) 1,2 с · 🖐 0,8 с — выход' },
  malevolentShrine: { name: 'Malevolent Shrine', color: '#ff1f33', hint: '🙏 обе руки ✌️ рядом, симметрично, 1,5 с · 🖐🖐 1 с — выход' },
  dismantle: { name: 'Dismantle', color: '#ff2a3d', hint: '✌️ два пальца → резкий взмах (3 подряд = TRIPLE)' },
  blackFlash: { name: 'Black Flash', color: '#ff1e2d', hint: '✊ кулак 0,3 с → резкий удар вперёд или вбок' },
  tenShadows: { name: 'Ten Shadows', color: '#9d8cff', hint: '🤘🤘 псы · 🕊 ладони + большие пальцы вместе · 🐸 согнуть указ. и средний' },
  piercingBlood: { name: 'Piercing Blood', color: '#e0102a', hint: '☝️☝️ указательные вместе 0,8 с → зарядка → резко развести руки' },
};

const TRACK = {
  tracking: { text: 'Рука найдена', dot: 'bg-emerald-400' },
  lost: { text: 'Рука потеряна', dot: 'bg-amber-400' },
  searching: { text: 'Поиск руки…', dot: 'bg-slate-500' },
} as const;

const QUALITY_LABEL: Record<Quality, string> = { auto: 'AUTO', high: 'HIGH', medium: 'MED', low: 'LOW' };

interface Props {
  stats: HudStats;
  settings: Settings;
  quality: Quality;
  onQuality: () => void;
  muted: boolean;
  onMute: () => void;
  skeleton: boolean;
  onSkeleton: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  onDebug: () => void;
}

export function Hud({ stats, settings, quality, onQuality, muted, onMute, skeleton, onSkeleton, settingsOpen, onSettings, onDebug }: Props) {
  const tr = TRACK[stats.tracking];
  const ch = CHARACTER_BY_ID[settings.character];
  const activeTech = stats.techniques.find((x) => x.id === stats.active);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 pt-16 sm:p-5 sm:pt-20">
      <div className="flex items-start justify-between gap-3">
        {/* character + techniques */}
        <motion.div className="glass w-[min(19rem,60vw)] p-3 sm:p-4" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          <div className="hud-label">Персонаж</div>
          <div className="mt-0.5 font-display text-sm font-bold tracking-[0.14em] sm:text-base" style={{ color: ch.accent }}>
            {ch.name}
          </div>
          <ActiveLine stats={stats} active={activeTech} />
          <div className="mt-3 space-y-1.5">
            {stats.techniques.map((x) => (x.id === 'limitless' ? <LimitlessRows key={x.id} stats={stats} tech={x} /> : <TechRow key={x.id} tech={x} active={x.id === stats.active} />))}
          </div>
        </motion.div>

        {/* telemetry */}
        <motion.div className="glass p-3 text-xs sm:p-4" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tr.dot} ${stats.tracking === 'tracking' ? 'animate-pulse' : ''}`} />
            <span className="text-white/80">{tr.text}</span>
            <span className="ml-auto flex gap-0.5" title="Отслеживаемые руки">
              {[0, 1].map((i) => (
                <Hand key={i} className={`h-3.5 w-3.5 ${i < stats.hands ? 'text-emerald-300' : 'text-white/20'} ${i ? '-scale-x-100' : ''}`} />
              ))}
            </span>
          </div>
          <dl className="mt-2.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 font-mono text-white/70">
            <Stat icon={<Crosshair className="h-3 w-3" />} label="Выстрелы" value={stats.shots} />
            <Stat icon={<Activity className="h-3 w-3" />} label="Камера" value={`${stats.cameraFps} fps`} />
            <Stat icon={<Gauge className="h-3 w-3" />} label="Рендер" value={`${stats.renderFps} fps`} />
            <Stat icon={<Cpu className="h-3 w-3" />} label="ML" value={stats.delegate} />
            <Stat icon={<Hand className="h-3 w-3" />} label="Жест" value={GESTURE_LABEL[stats.gesture as Gesture] ?? '—'} />
          </dl>
          <div className="pointer-events-auto mt-3 flex gap-1.5">
            <HudButton onClick={onQuality} title={`Качество графики (сейчас ${stats.profile.toUpperCase()})`}>
              <span className="font-mono text-[10px]">
                {QUALITY_LABEL[quality]}
                {quality === 'auto' ? ` ${stats.profile[0].toUpperCase()}` : ''}
              </span>
            </HudButton>
            <HudButton onClick={onSkeleton} title="Скелет руки" active={skeleton}>
              <Bone className="h-3.5 w-3.5" />
            </HudButton>
            <HudButton onClick={onMute} title={muted ? 'Включить звук' : 'Выключить звук'} active={!muted}>
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </HudButton>
            <HudButton onClick={onDebug} title="Debug-режим" active={settings.debug}>
              <Bug className="h-3.5 w-3.5" />
            </HudButton>
            <HudButton onClick={onSettings} title="Настройки" active={settingsOpen}>
              <Settings2 className="h-3.5 w-3.5" />
            </HudButton>
          </div>
        </motion.div>
      </div>

      <GestureGuide stats={stats} />
    </div>
  );
}

function ActiveLine({ stats, active }: { stats: HudStats; active?: TechniqueHud }) {
  if (!active) return <div className="mt-1 text-xs text-white/45">ожидание жеста</div>;
  const info = TECH_INFO[active.id];
  const name = active.id === 'limitless' ? ABILITY[stats.state].name : info.name;
  const color = active.id === 'limitless' ? ABILITY[stats.state].color : info.color;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <motion.span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }}
        animate={{ scale: [1, 1.4, 1] }}
        transition={{ duration: 0.9, repeat: Infinity }}
      />
      <span className="truncate font-display text-xs font-bold tracking-[0.12em] sm:text-sm" style={{ color }}>
        {name}
      </span>
      <span className="ml-auto truncate font-mono text-[10px] text-white/40">{active.extra || active.state}</span>
    </div>
  );
}

function Bar({ value, color, dim }: { value: number; color: string; dim?: boolean }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-white/10">
      <motion.div
        className="h-full rounded-full"
        style={{ background: color, boxShadow: dim ? 'none' : `0 0 8px ${color}`, opacity: dim ? 0.45 : 1 }}
        animate={{ width: `${Math.round(value * 100)}%` }}
        transition={{ type: 'tween', duration: 0.12 }}
      />
    </div>
  );
}

function TechRow({ tech, active }: { tech: TechniqueHud; active: boolean }) {
  const info = TECH_INFO[tech.id];
  const cd = tech.cooldown > 0.05;
  return (
    <div className={`rounded-lg px-2 py-1.5 transition-colors ${active ? 'bg-white/10' : ''}`} style={active ? { boxShadow: `inset 0 0 0 1px ${info.color}88` } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[10px] font-bold tracking-[0.12em] sm:text-[11px]" style={{ color: cd ? '#64748b' : info.color }}>
          {info.name}
        </span>
        <span className="font-mono text-[9px] text-white/40">{cd ? `перезарядка ${tech.cooldown.toFixed(1)}с` : tech.engaged ? tech.state.replace(/_/g, ' ').toLowerCase() : 'готово'}</span>
      </div>
      {(tech.engaged || cd) && (
        <div className="mt-1">
          <Bar value={cd ? 1 - Math.min(1, tech.cooldown / 2) : tech.progress} color={info.color} dim={cd} />
        </div>
      )}
    </div>
  );
}

function LimitlessRows({ stats, tech }: { stats: HudStats; tech: TechniqueHud }) {
  const s = stats.state;
  const rows: { name: string; color: string; on: boolean }[] = [
    { name: 'Blue', color: COLORS.blue, on: s === 'BLUE_ACTIVE' || s === 'BLUE_RED_ACTIVE' || s === 'MERGING' },
    { name: 'Red', color: COLORS.red, on: s === 'BLUE_RED_ACTIVE' || s === 'MERGING' },
    { name: 'Hollow Purple', color: COLORS.purple, on: s === 'MERGING' || s === 'PURPLE_CHARGING' || s === 'PURPLE_READY' },
  ];
  return (
    <div className={`rounded-lg px-2 py-1.5 ${tech.engaged ? 'bg-white/10' : ''}`}>
      <div className="flex items-center gap-3">
        {rows.map((r) => (
          <span key={r.name} className="font-display text-[10px] font-bold tracking-[0.1em] sm:text-[11px]" style={{ color: r.on ? r.color : `${r.color}88`, textShadow: r.on ? `0 0 10px ${r.color}` : 'none' }}>
            {r.name}
          </span>
        ))}
      </div>
      {tech.engaged && (
        <div className="mt-1">
          <Bar value={stats.energy} color={ABILITY[s].color} />
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-white/40">
        {icon}
        {label}
      </dt>
      <dd className="text-right text-white/85">{value}</dd>
    </>
  );
}

export function HudButton({ children, onClick, title, active }: { children: ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-2 transition-colors ${
        active === false ? 'border-white/10 text-white/35' : 'border-white/20 text-white/85'
      } bg-white/5 hover:bg-white/15`}
    >
      {children}
    </button>
  );
}

const GOJO_GUIDE: { icon: string; text: string; ability: string; states: AbilityState[]; color: string }[] = [
  { icon: '☝️', text: 'Указательный', ability: 'BLUE', states: ['BLUE_ACTIVE'], color: COLORS.blue },
  { icon: '✌️', text: 'Указательный + средний', ability: 'BLUE + RED', states: ['BLUE_RED_ACTIVE'], color: COLORS.red },
  { icon: '🤞', text: 'Соединить кончики', ability: 'HOLLOW PURPLE', states: ['MERGING', 'PURPLE_CHARGING'], color: COLORS.purple },
  { icon: '⚡', text: 'Резкое движение', ability: 'FIRE', states: ['PURPLE_READY', 'FIRING'], color: '#ffffff' },
];

/** Small gesture hints; the hint of the technique in progress is highlighted. */
function GestureGuide({ stats }: { stats: HudStats }) {
  const others = stats.techniques.filter((x) => x.id !== 'limitless');
  const hasLimitless = stats.techniques.some((x) => x.id === 'limitless');
  return (
    <div className="flex flex-col items-center gap-1.5">
      {others.length > 0 && (
        <div className="glass flex max-w-full flex-wrap justify-center gap-1 p-1.5">
          {others.map((x) => {
            const info = TECH_INFO[x.id];
            const on = x.id === stats.active;
            return (
              <div
                key={x.id}
                className="flex max-w-[22rem] flex-col rounded-lg px-2.5 py-1 leading-tight"
                style={{ backgroundColor: on ? 'rgba(255,255,255,0.10)' : 'transparent', boxShadow: on ? `inset 0 0 0 1px ${info.color}88, 0 0 18px ${info.color}55` : 'none' }}
              >
                <span className="font-display text-[10px] font-bold tracking-[0.14em]" style={{ color: info.color }}>
                  {info.name}
                </span>
                <span className="text-[10px] text-white/55 sm:text-[11px]">{info.hint}</span>
              </div>
            );
          })}
        </div>
      )}
      {hasLimitless && (
        <div className="glass grid grid-cols-2 gap-1 p-1.5 sm:flex sm:gap-1">
          {GOJO_GUIDE.map((g) => {
            const active = g.states.includes(stats.state);
            return (
              <motion.div
                key={g.ability}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 sm:px-3"
                animate={{
                  backgroundColor: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0)',
                  boxShadow: active ? `inset 0 0 0 1px ${g.color}88, 0 0 18px ${g.color}55` : 'inset 0 0 0 1px rgba(0,0,0,0)',
                }}
              >
                <span className="text-base leading-none sm:text-lg">{g.icon}</span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[10px] text-white/50 sm:text-[11px]">{g.text}</span>
                  <span className="font-display text-[10px] font-bold tracking-[0.14em] sm:text-[11px]" style={{ color: g.color }}>
                    {g.ability}
                  </span>
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
