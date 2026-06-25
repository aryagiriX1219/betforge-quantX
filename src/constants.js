export const TICK_SPEED     = 40000   // 40s real = 1 match min → 90 min = 60 real min
export const INITIAL_BALANCE = 1000
export const MAX_BET         = 500
export const MIN_BET         = 10
export const MAX_ACTIVE_BETS = 4
export const VIG             = 0.05
export const ADMIN_PASSWORD  = 'betforge2025'

export const TEAMS = {
  portugal: {
    name: 'Portugal', short: 'POR', strength: 1.4, homeAdv: 1.2,
    color: '#006600', accent: '#FF0000', flag: '🟢',
    players: {
      gk: 'Diogo Costa',
      freekick: [
        { name: 'Ronaldo',         weight: 0.60, baseAttempt: 0.80, conv: { short: 0.38, med: 0.32, long: 0.12 } },
        { name: 'Bruno Fernandes', weight: 0.30, baseAttempt: 0.45, conv: { short: 0.18, med: 0.14, long: 0.04 } },
        { name: 'Rúben Neves',     weight: 0.10, baseAttempt: 0.35, conv: { short: 0.12, med: 0.09, long: 0.03 } },
      ],
      corner: [
        { name: 'Bruno Fernandes', side: 'left',   weight: 0.55, bonus: 1.20 },
        { name: 'Bernardo Silva',  side: 'right',  weight: 0.35, bonus: 1.10 },
        { name: 'Rúben Neves',     side: 'either', weight: 0.10, bonus: 1.00 },
      ],
      penalty: [
        { name: 'Ronaldo',         weight: 0.80, dir: { L: 0.35, C: 0.20, R: 0.45 }, same: 0.62, diff: 0.92 },
        { name: 'Bruno Fernandes', weight: 0.15, dir: { L: 0.30, C: 0.25, R: 0.45 }, same: 0.48, diff: 0.80 },
        { name: 'Bernardo Silva',  weight: 0.05, dir: { L: 0.40, C: 0.20, R: 0.40 }, same: 0.44, diff: 0.78 },
      ],
      goalScorers: [
        { name: 'Ronaldo',         weight: 0.40 },
        { name: 'Bruno Fernandes', weight: 0.22 },
        { name: 'Bernardo Silva',  weight: 0.15 },
        { name: 'Conceiçao',       weight: 0.10 },
        { name: 'Other',           weight: 0.13 },
      ],
    },
  },
  argentina: {
    name: 'Argentina', short: 'ARG', strength: 1.6, homeAdv: 1.0,
    color: '#74ACDF', accent: '#FFFFFF', flag: '🔵',
    players: {
      gk: 'E. Martínez',
      freekick: [
        { name: 'Messi',        weight: 0.65, baseAttempt: 0.75, conv: { short: 0.35, med: 0.28, long: 0.10 } },
        { name: 'Di María',     weight: 0.25, baseAttempt: 0.50, conv: { short: 0.20, med: 0.16, long: 0.05 } },
        { name: 'Mac Allister', weight: 0.10, baseAttempt: 0.30, conv: { short: 0.10, med: 0.08, long: 0.03 } },
      ],
      corner: [
        { name: 'De Paul',  side: 'right',  weight: 0.60, bonus: 1.15 },
        { name: 'Messi',    side: 'either', weight: 0.25, bonus: 1.00, shortBonus: true },
        { name: 'Di María', side: 'left',   weight: 0.15, bonus: 1.00 },
      ],
      penalty: [
        { name: 'Messi',    weight: 0.75, dir: { L: 0.40, C: 0.15, R: 0.45 }, same: 0.60, diff: 0.90 },
        { name: 'Álvarez',  weight: 0.15, dir: { L: 0.45, C: 0.20, R: 0.35 }, same: 0.50, diff: 0.82 },
        { name: 'Di María', weight: 0.10, dir: { L: 0.50, C: 0.10, R: 0.40 }, same: 0.52, diff: 0.85 },
      ],
      goalScorers: [
        { name: 'Messi',        weight: 0.42 },
        { name: 'Álvarez',      weight: 0.25 },
        { name: 'Di María',     weight: 0.18 },
        { name: 'Mac Allister', weight: 0.08 },
        { name: 'Other',        weight: 0.07 },
      ],
    },
  },
}

export const GK_DIVE = {
  'Diogo Costa': { L: 0.40, C: 0.10, R: 0.50 },
  'E. Martínez': { L: 0.35, C: 0.15, R: 0.50 },
}

export const SCORER_MARKET = [
  { key: 'portugal_Ronaldo',         label: 'Ronaldo',         team: 'portugal' },
  { key: 'argentina_Messi',          label: 'Messi',           team: 'argentina' },
  { key: 'portugal_Bruno Fernandes', label: 'Bruno Fernandes', team: 'portugal' },
  { key: 'argentina_Álvarez',        label: 'Álvarez',         team: 'argentina' },
  { key: 'argentina_Di María',       label: 'Di María',        team: 'argentina' },
  { key: 'portugal_Bernardo Silva',  label: 'Bernardo Silva',  team: 'portugal' },
]
