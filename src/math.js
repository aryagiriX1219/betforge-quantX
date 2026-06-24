import { TEAMS, VIG } from './constants'

// ─── CORE MATH ────────────────────────────────────────────────────────────────

export function poisson(k, mu) {
  if (mu <= 0) return k === 0 ? 1 : 0
  let logP = -mu + k * Math.log(mu)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

export function rand() { return Math.random() }

export function weightedPick(items) {
  const total = items.reduce((s, x) => s + (x.weight || x.w || 0), 0)
  let r = rand() * total
  for (const item of items) {
    r -= item.weight || item.w || 0
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

// ─── WIN PROBABILITY ──────────────────────────────────────────────────────────

export function calcWinProbs(scoreP, scoreA, lambdaP, lambdaA, remaining) {
  let pWin = 0, pDraw = 0, pLoss = 0
  const muP = lambdaP * remaining
  const muA = lambdaA * remaining
  for (let i = 0; i <= 10; i++) {
    const pi = poisson(i, muP)
    for (let j = 0; j <= 10; j++) {
      const prob = pi * poisson(j, muA)
      const fp = scoreP + i, fa = scoreA + j
      if (fp > fa) pWin += prob
      else if (fp === fa) pDraw += prob
      else pLoss += prob
    }
  }
  return { pWin, pDraw, pLoss }
}

// ─── ODDS ─────────────────────────────────────────────────────────────────────

export function vigOdds(p) {
  if (p <= 0) return 50
  return Math.min(50, Math.max(1.01, (1 / p) * (1 - VIG)))
}

export function fmt(n) { return Number(n).toFixed(2) }

// ─── ALL MARKET ODDS ──────────────────────────────────────────────────────────

export function calcAllOdds(score, minute, lambdaP, lambdaA) {
  const remaining = Math.max(0, 90 - minute)
  const { pWin, pDraw, pLoss } = calcWinProbs(score.P, score.A, lambdaP, lambdaA, remaining)
  const muRem = (lambdaP + lambdaA) * remaining
  const currentGoals = score.P + score.A

  // Over/Under 2.5
  let pOver
  if (currentGoals >= 3) {
    pOver = 1
  } else {
    const need = Math.floor(2.5 - currentGoals + 1)
    let pUnder = 0
    for (let k = 0; k < need; k++) pUnder += poisson(k, muRem)
    pOver = 1 - pUnder
  }

  // BTTS
  let pBTTS
  const sp = score.P > 0, sa = score.A > 0
  if (sp && sa) pBTTS = 1
  else if (sp)  pBTTS = 1 - Math.exp(-lambdaA * remaining)
  else if (sa)  pBTTS = 1 - Math.exp(-lambdaP * remaining)
  else          pBTTS = (1 - Math.exp(-lambdaP * remaining)) * (1 - Math.exp(-lambdaA * remaining))

  // Next Goal
  const totalLam  = lambdaP + lambdaA
  const pAnyGoal  = remaining > 0 ? 1 - Math.exp(-totalLam * remaining) : 0
  const pPorNext  = remaining > 0 && totalLam > 0 ? (lambdaP / totalLam) * pAnyGoal : 0
  const pArgNext  = remaining > 0 && totalLam > 0 ? (lambdaA / totalLam) * pAnyGoal : 0
  const pNoMore   = remaining > 0 ? Math.exp(-totalLam * remaining) : 1

  // Asian Handicap
  const ahTotal = pWin + pLoss
  const pPorAH  = ahTotal > 0 ? pWin  / ahTotal : 0.5
  const pArgAH  = ahTotal > 0 ? pLoss / ahTotal : 0.5

  // Anytime Scorers
  const scorers = {}
  for (const [team, lam] of [['portugal', lambdaP], ['argentina', lambdaA]]) {
    for (const p of TEAMS[team].players.goalScorers) {
      const mu = lam * remaining * p.weight
      scorers[`${team}_${p.name}`] = 1 - Math.exp(-mu)
    }
  }

  return {
    match:    { pWin, pDraw, pLoss },
    overUnder:{ pOver, pUnder: 1 - pOver },
    btts:     { pYes: pBTTS, pNo: 1 - pBTTS },
    nextGoal: { pPor: pPorNext, pArg: pArgNext, pNone: pNoMore },
    asianH:   { pPor: pPorAH,  pArg: pArgAH },
    scorers,
  }
}
