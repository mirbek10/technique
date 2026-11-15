export interface Vec2 {
  x: number;
  y: number;
}

export type AbilityState =
  | 'IDLE'
  | 'BLUE_ACTIVE'
  | 'BLUE_RED_ACTIVE'
  | 'MERGING'
  | 'PURPLE_CHARGING'
  | 'PURPLE_READY'
  | 'FIRING'
  | 'COOLDOWN';

/** `auto` adapts the profile to the measured FPS. */
export type Quality = 'auto' | 'high' | 'medium' | 'low';
/** Concrete graphics profile actually used for rendering. */
export type Profile = 'high' | 'medium' | 'low';
export type TrackingStatus = 'searching' | 'tracking' | 'lost';
export type Delegate = 'GPU' | 'CPU';
export type OrbKind = 'blue' | 'red' | 'purple';

export type CharacterId = 'gojo' | 'sukuna' | 'yuji' | 'megumi' | 'choso' | 'all';

export type TechniqueId =
  | 'limitless'
  | 'unlimitedVoid'
  | 'malevolentShrine'
  | 'dismantle'
  | 'blackFlash'
  | 'tenShadows'
  | 'piercingBlood';

/** In ALL TECHNIQUES mode the two-finger pose is shared by Blue/Red and Dismantle: the user picks one. */
export type AllPoseMode = 'limitless' | 'dismantle';

export interface Settings {
  character: CharacterId;
  /** Dismantle may fire while Malevolent Shrine is active */
  domainCombos: boolean;
  allPoseMode: AllPoseMode;
  debug: boolean;
  /** multiplies every hold time (0.6 … 1.6) */
  holdScale: number;
  /** multiplies every speed threshold (0.6 … 1.6); lower = more sensitive */
  motionScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  character: 'gojo',
  domainCombos: false,
  allPoseMode: 'limitless',
  debug: false,
  holdScale: 1,
  motionScale: 1,
};

export interface TechniqueHud {
  id: TechniqueId;
  state: string;
  engaged: boolean;
  /** 0..1 hold / charge progress */
  progress: number;
  /** seconds of cooldown left */
  cooldown: number;
  extra: string;
}

export interface HandDebug {
  slot: number;
  side: string;
  fingers: string;
  curl: string;
  gesture: string;
  crossed: number;
  roll: number;
  speed: number;
  scaleRate: number;
}

export interface DebugInfo {
  hands: HandDebug[];
  candidates: string[];
  winner: string;
  holdMs: number;
  owner: string;
  rejected: string[];
  segmentation: string;
}

export interface HudStats {
  state: AbilityState;
  energy: number;
  shots: number;
  cameraFps: number;
  renderFps: number;
  tracking: TrackingStatus;
  gesture: string;
  particleScale: number;
  delegate: Delegate;
  hands: number;
  profile: Profile;
  techniques: TechniqueHud[];
  active: TechniqueId | null;
  debug: DebugInfo | null;
}

export interface Cinematic {
  key: number;
  /** small line above the title, e.g. DOMAIN EXPANSION */
  pre?: string;
  title: string;
  sub?: string;
  color: string;
  /** seconds on screen */
  duration: number;
  big?: boolean;
}

export const COLORS = {
  blue: '#0088FF',
  red: '#FF253A',
  purple: '#A020F0',
} as const;

export const INITIAL_STATS: HudStats = {
  state: 'IDLE',
  energy: 0,
  shots: 0,
  cameraFps: 0,
  renderFps: 0,
  tracking: 'searching',
  gesture: 'none',
  particleScale: 1,
  delegate: 'GPU',
  hands: 0,
  profile: 'high',
  techniques: [],
  active: null,
  debug: null,
};
