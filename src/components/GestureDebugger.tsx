import type { DebugInfo, HudStats } from '../engine/types';

/** Debug overlay: finger states, candidates with confidence, winner & hold time, owner, rejection reasons. */
export function GestureDebugger({ info, stats }: { info: DebugInfo; stats: HudStats }) {
  return (
    <div className="glass pointer-events-none absolute bottom-24 left-3 z-20 w-[min(22rem,calc(100%-1.5rem))] p-3 font-mono text-[10px] leading-relaxed text-white/75 sm:left-5">
      <div className="hud-label mb-1">Gesture debugger</div>
      {info.hands.length === 0 && <div className="text-white/40">рук нет</div>}
      {info.hands.map((h) => (
        <div key={h.slot}>
          <span className="text-white/45">#{h.slot}</span> {h.side} <span className="tracking-widest">{h.fingers}</span> curl {h.curl} · {h.gesture} · cross {h.crossed.toFixed(2)} · roll {((h.roll * 180) / Math.PI).toFixed(0)}° · v {h.speed.toFixed(1)} · scale {h.scaleRate.toFixed(1)}
        </div>
      ))}
      <div className="mt-1 text-white/45">кандидаты</div>
      <div>{info.candidates.length ? info.candidates.join(' · ') : '—'}</div>
      <div className="mt-1">
        <span className="text-white/45">победитель </span>
        {info.winner} <span className="text-white/45">· удержание</span> {Math.round(info.holdMs)} мс
      </div>
      <div>
        <span className="text-white/45">активно </span>
        {info.owner}
      </div>
      {stats.techniques
        .filter((x) => x.cooldown > 0.05)
        .map((x) => (
          <div key={x.id} className="text-sky-300/80">
            cooldown {x.id}: {x.cooldown.toFixed(2)} с
          </div>
        ))}
      {info.rejected.length > 0 && (
        <>
          <div className="mt-1 text-white/45">отклонено</div>
          {info.rejected.map((r) => (
            <div key={r} className="text-amber-300/80">
              {r}
            </div>
          ))}
        </>
      )}
      <div className="mt-1 text-white/40">{info.segmentation}</div>
    </div>
  );
}
