import { TEAMS, GK_DIVE } from './constants'
import { rand, weightedPick, vigOdds } from './math'

// ─── MINUTE SIMULATOR ─────────────────────────────────────────────────────────

export function simulateMinute(state) {
  const { lambdaP, lambdaA } = state
  const teams = ['portugal', 'argentina']

  // Priority: set pieces first (short-circuit)
  for (const team of teams) {
    if (rand() < 0.008) return { type: 'penalty',  team, events: [] }
    if (rand() < 0.060) {
      const dr   = rand()
      const distType = dr < 0.35 ? 'long' : dr < 0.75 ? 'med' : 'short'
      const distNum  = distType === 'long' ? 30 + rand()*10 : distType === 'med' ? 20 + rand()*10 : 10 + rand()*10
      const pr   = rand()
      const position = pr < 0.33 ? 'left' : pr < 0.66 ? 'central' : 'right'
      return { type: 'freekick', team, distType, distNum: Math.round(distNum), position, events: [] }
    }
    if (rand() < 0.050) return { type: 'corner', team, events: [] }
  }

  // Normal events
  const events = []
  const lambdas = { portugal: lambdaP, argentina: lambdaA }

  for (const team of teams) {
    if (rand() < 1 - Math.exp(-lambdas[team])) {
      const scorer = weightedPick(TEAMS[team].players.goalScorers)
      events.push({ type: 'goal', team, scorer: scorer.name, open: true })
    }
  }
  for (const team of teams) {
    if (rand() < 0.001) events.push({ type: 'redcard', team, secondYellow: false })
  }
  for (const team of teams) {
    if (rand() < 0.008) {
      events.push({ type: 'yellow', team })
      if (rand() < 0.003) events.push({ type: 'redcard', team, secondYellow: true })
    }
  }
  return { type: 'normal', events }
}

// ─── SET PIECE RESOLVERS ──────────────────────────────────────────────────────

export function resolveFreekick(team, distType, position, takers) {
  const taker   = weightedPick(takers)
  const posMod  = position === 'central' ? 1.0 : 0.6
  const distMod = distType === 'short' ? 0.5 : distType === 'med' ? 1.0 : 0.7
  const pDirect = taker.baseAttempt * posMod * distMod

  let outcome, goalScorer = null

  if (rand() < 0.08) {
    outcome = 'post'
  } else if (rand() < pDirect) {
    const conv = taker.conv[distType]
    if      (rand() < conv) { outcome = 'goal'; goalScorer = taker.name }
    else if (rand() < 0.52)   outcome = 'saved'
    else                       outcome = 'offtarget'
  } else {
    const r = rand()
    if      (r < 0.12) { outcome = 'goal_header'; goalScorer = 'Header' }
    else if (r < 0.32)   outcome = 'saved'
    else if (r < 0.67)   outcome = 'offtarget'
    else                 outcome = 'blocked'
  }
  return { taker: taker.name, outcome, goalScorer }
}

export function resolveCorner(team, takers) {
  const taker     = weightedPick(takers)
  const dr        = rand()
  const delivType = dr < 0.45 ? 'inswinger' : dr < 0.80 ? 'outswinger' : 'short'
  const bonus     = taker.bonus || 1.0

  let outcome, goalScorer = null

  if (delivType === 'short') {
    const pShot = taker.shortBonus ? 0.45 : 0.30
    if (rand() < pShot) {
      if (rand() < 0.12) { outcome = 'goal'; goalScorer = 'Short corner' }
      else                 outcome = 'saved'
    } else if (rand() < 0.40) {
      const pG = 0.11 * bonus, r = rand()
      if      (r < pG)        { outcome = 'goal_header'; goalScorer = 'Header' }
      else if (r < pG+0.22)     outcome = 'saved'
      else if (r < pG+0.52)     outcome = 'offtarget'
      else                       outcome = 'cleared'
    } else { outcome = 'cleared' }
  } else if (delivType === 'inswinger') {
    const pG = 0.11 * bonus, r = rand()
    if      (r < 0.03)          { outcome = 'goal_direct'; goalScorer = 'Direct!' }
    else if (r < 0.03+pG)       { outcome = 'goal_header'; goalScorer = 'Header' }
    else if (r < 0.03+pG+0.22)    outcome = 'saved'
    else if (r < 0.03+pG+0.52)    outcome = 'offtarget'
    else                           outcome = 'cleared'
  } else {
    const pG = 0.08 * bonus, r = rand()
    if      (r < pG)              { outcome = 'goal_header'; goalScorer = 'Header' }
    else if (r < pG+0.20)           outcome = 'saved'
    else if (r < pG+0.55)           outcome = 'offtarget'
    else                             outcome = 'cleared'
  }
  return { taker: taker.name, delivType, outcome: outcome || 'cleared', goalScorer }
}

export function resolvePenalty(team, takers, oppGK, minute) {
  const taker    = weightedPick(takers)
  const gkData   = GK_DIVE[oppGK]
  const r        = rand()

  if (r < 0.06) return { taker: taker.name, outcome: 'miss', takerDir: 'Over the bar', keeperDir: '-' }
  if (r < 0.10) return { taker: taker.name, outcome: 'post', takerDir: 'Post',         keeperDir: '-' }

  const dirs    = ['L','C','R']
  const pickDir = (w) => { let a=0, roll=rand(); for (const d of dirs){ a+=w[d]; if(roll<a) return d } return 'R' }

  const takerDir  = pickDir(taker.dir)
  const keeperDir = pickDir(gkData)
  const pressMod  = minute >= 80 ? 0.92 : 1.0
  let pGoal       = takerDir === keeperDir ? taker.same * pressMod : taker.diff * pressMod
  if (oppGK === 'E. Martínez' && takerDir === 'C' && keeperDir === 'C') pGoal = Math.min(pGoal, 0.65)

  const dn = { L:'Left', C:'Centre', R:'Right' }
  return { taker: taker.name, outcome: rand() < pGoal ? 'goal' : 'saved', takerDir: dn[takerDir], keeperDir: dn[keeperDir] }
}

// ─── SET PIECE ODDS FOR OVERLAY ───────────────────────────────────────────────

export function calcSetPieceOdds(sp) {
  const { type, team, distType, position } = sp

  if (type === 'penalty') {
    return [
      { key: 'goal',  label: '⚽ Goal',   odds: vigOdds(0.702) },
      { key: 'saved', label: '🧤 Saved',  odds: vigOdds(0.198) },
      { key: 'miss',  label: '❌ Miss',   odds: vigOdds(0.100) },
    ]
  }

  if (type === 'freekick') {
    const taker   = weightedPick(TEAMS[team].players.freekick)
    const posMod  = position === 'central' ? 1.0 : 0.6
    const distMod = distType === 'short'   ? 0.5 : distType === 'med' ? 1.0 : 0.7
    const pDirect = taker.baseAttempt * posMod * distMod
    const conv    = taker.conv[distType]
    const pGoal   = pDirect * conv   + (1-pDirect) * 0.12
    const pSaved  = pDirect * 0.42  + (1-pDirect) * 0.20
    const pOff    = pDirect * 0.20  + (1-pDirect) * 0.35
    const pBlock  = Math.max(0.01, 1-pGoal-pSaved-pOff)
    return [
      { key: 'goal',      label: '⚽ Goal',       odds: vigOdds(pGoal) },
      { key: 'saved',     label: '🧤 Saved',      odds: vigOdds(pSaved) },
      { key: 'offtarget', label: '❌ Off Target', odds: vigOdds(pOff) },
      { key: 'blocked',   label: '🛡️ Blocked',    odds: vigOdds(pBlock) },
    ]
  }

  if (type === 'corner') {
    const taker = weightedPick(TEAMS[team].players.corner)
    const bonus = taker.bonus || 1.0
    const pGoal = (0.11*bonus + 0.03) * 0.6
    const pSaved = 0.22, pOff = 0.30
    const pClear = Math.max(0.01, 1-pGoal-pSaved-pOff)
    return [
      { key: 'goal',      label: '⚽ Goal',       odds: vigOdds(pGoal) },
      { key: 'saved',     label: '🧤 Saved',      odds: vigOdds(pSaved) },
      { key: 'offtarget', label: '❌ Off Target', odds: vigOdds(pOff) },
      { key: 'cleared',   label: '🛡️ Cleared',    odds: vigOdds(pClear) },
    ]
  }
  return []
}
