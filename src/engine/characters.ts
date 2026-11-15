import type { CharacterId, TechniqueId } from './types';

export interface CharacterConfig {
  id: CharacterId;
  name: string;
  /** short label for the selector */
  short: string;
  accent: string;
  accent2: string;
  techniques: TechniqueId[];
  /** names shown in the HUD list (Limitless shows as three techniques) */
  abilities: string[];
}

export const CHARACTERS: CharacterConfig[] = [
  {
    id: 'gojo',
    name: 'GOJO SATORU',
    short: 'Годжо',
    accent: '#5aa8ff',
    accent2: '#a020f0',
    techniques: ['limitless', 'unlimitedVoid'],
    abilities: ['Blue', 'Red', 'Hollow Purple', 'Unlimited Void'],
  },
  {
    id: 'sukuna',
    name: 'RYOMEN SUKUNA',
    short: 'Сукуна',
    accent: '#ff2a3d',
    accent2: '#7a0010',
    techniques: ['dismantle', 'malevolentShrine'],
    abilities: ['Dismantle', 'Malevolent Shrine'],
  },
  {
    id: 'yuji',
    name: 'YUJI ITADORI',
    short: 'Юдзи',
    accent: '#ff5b45',
    accent2: '#1a0006',
    techniques: ['blackFlash'],
    abilities: ['Black Flash'],
  },
  {
    id: 'megumi',
    name: 'MEGUMI FUSHIGURO',
    short: 'Мэгуми',
    accent: '#8f82ff',
    accent2: '#16122e',
    techniques: ['tenShadows'],
    abilities: ['Ten Shadows'],
  },
  {
    id: 'choso',
    name: 'CHOSO',
    short: 'Чосо',
    accent: '#e0102a',
    accent2: '#3a0008',
    techniques: ['piercingBlood'],
    abilities: ['Piercing Blood'],
  },
  {
    id: 'all',
    name: 'ALL TECHNIQUES',
    short: 'Все',
    accent: '#e6e6ff',
    accent2: '#a020f0',
    techniques: ['limitless', 'unlimitedVoid', 'dismantle', 'malevolentShrine', 'blackFlash', 'tenShadows', 'piercingBlood'],
    abilities: [],
  },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharacterId, CharacterConfig>;
