import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAMS, TICK_SPEED, INITIAL_BALANCE, MIN_BET, MAX_BET, MAX_ACTIVE_BETS } from './constants'
import { calcAllOdds, fmt } from './math'
import { simulateMinute, resolveFreekick, resolveCorner, resolvePenalty, calcSetPieceOdds } from './engine'
import { supabase } from './supabase'

const MATCH_ROW_ID = 1
let _nid = 0
const mkN = (msg, type = 'tick') => ({ id: _nid++, msg, type, ts: Date.now() })

// ─── INITIAL STATE ────────────────────────────────────────────────────────────
function makeInitialMatchState() {
  const lambdaP = (TEAMS.portugal.strength * TEAMS.portugal.homeAdv) / 90
  const lambdaA = (TEAMS.argentina.strength * TEAMS.argentina.homeAdv) / 90
  return {
    minute: 0, score: { P: 0, A: 0 }, lambdaP, lambdaA,
    status: 'prematch', paused: false, events: [],
    redCards: { portugal: 0, argentina: 0 },
    yellowCards: { portugal: 0, argentina: 0 },
    halfStoppage: { first: 0, second: 0 },
    phase: 'first', setpiece: null,
    notifications: [{ id: 0, msg: '🏟️ Welcome to BetForge! Portugal vs Argentina.', type: 'system', ts: Date.now() }],
  }
}

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
async function pushMatchState(state) {
  try {
    await supabase.from('match_state').upsert({ id: MATCH_ROW_ID, state, updated_at: new Date().toISOString() })
  } catch (e) { console.error('push error:', e) }
}

async function saveBet(userId, userName, bet) {
  try {
    await supabase.from('bets').upsert({
      id: `${userId}_${bet.id}`, user_id: userId, user_name: userName,
      market: bet.market, selection: bet.selection, stake: bet.stake,
      odds: bet.odds, status: bet.status, potential: bet.stake * bet.odds,
      updated_at: new Date().toISOString(),
    })
  } catch (e) { console.error('bet save error:', e) }
}

async function saveLeaderboard(userId, userName, balance, betsCount) {
  try {
    await supabase.from('leaderboard').upsert({
      user_id: userId, user_name: userName,
      balance: Math.round(balance),
      pnl: Math.round(balance - INITIAL_BALANCE),
      bets_count: betsCount,
      updated_at: new Date().toISOString(),
    })
  } catch (e) { console.error('lb error:', e) }
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export function useMatch(currentUser = null, isAdmin = false) {
  const [gs, setGs]                   = useState(makeInitialMatchState)
  const [bets, setBets]               = useState([])
  const [balance, setBalance]         = useState(INITIAL_BALANCE)
  const [notifications, setNotifs]    = useState([mkN('🏟️ Welcome! Portugal vs Argentina.', 'system')])
  const [odds, setOdds]               = useState(null)
  const [betSlip, setBetSlip]         = useState(null)
  const [stakeInput, setStakeInput]   = useState('100')
  const [spTimer, setSpTimer]         = useState(0)
  const [connected, setConnected]     = useState(false)

  const timerRef   = useRef(null)
  const gsRef      = useRef(gs);      gsRef.current   = gs
  const betsRef    = useRef(bets);    betsRef.current = bets
  const balRef     = useRef(balance); balRef.current  = balance
  const isAdminRef = useRef(isAdmin); isAdminRef.current = isAdmin

  const pushNotif = useCallback((msg, type = 'tick') => {
    setNotifs(prev => [mkN(msg, type), ...prev].slice(0, 80))
  }, [])

  const recalcOdds = useCallback((state) => {
    if (!state?.score) return
    setOdds(calcAllOdds(state.score, state.minute, state.lambdaP, state.lambdaA))
  }, [])

  // ── Supabase: load initial state + subscribe ──────────────────────────────
  useEffect(() => {
    supabase.from('match_state').select('state').eq('id', MATCH_ROW_ID).single()
      .then(({ data }) => {
        // Guard: only use server state if it has a valid score object
        const s = data?.state?.score ? data.state : makeInitialMatchState()
        setGs(s)
        recalcOdds(s)
        if (s.notifications?.length) {
          setNotifs(s.notifications.slice(0, 80).map(n => ({ ...n, id: _nid++ })))
        }
        setConnected(true)
      })
      .catch(() => {
        // Supabase unreachable — fall back to local state gracefully
        setConnected(false)
      })

    const channel = supabase
      .channel('match_state_changes')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'match_state',
        filter: `id=eq.${MATCH_ROW_ID}`,
      }, (payload) => {
        const s = payload.new?.state
        if (!s?.score) return
        // ALL clients (including admin) sync from server on change
        setGs(s)
        recalcOdds(s)
        if (s.notifications?.length) {
          setNotifs(s.notifications.slice(0, 80).map(n => ({ ...n, id: _nid++ })))
        }
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    return () => supabase.removeChannel(channel)
  }, [recalcOdds])

  // ── Load user's bets from Supabase ────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    supabase.from('bets').select('*').eq('user_id', currentUser.id)
      .then(({ data }) => {
        if (!data?.length) return
        setBets(data.map(b => ({
          id: b.id, market: b.market, selection: b.selection,
          stake: b.stake, odds: b.odds, status: b.status,
          label: `${b.market.toUpperCase()} — ${b.selection}`,
        })))
        const won   = data.filter(b => b.status === 'won').reduce((s, b) => s + b.stake * b.odds, 0)
        const spent = data.filter(b => b.status !== 'void').reduce((s, b) => s + b.stake, 0)
        setBalance(INITIAL_BALANCE - spent + won)
      })
  }, [currentUser])

  // ── Settle bets at FT ────────────────────────────────────────────────────
  const settleBets = useCallback((finalScore, events) => {
    setBets(prev => prev.map(b => {
      if (b.status !== 'active') return b
      let won = false
      if (b.market === 'match') {
        const res = finalScore.P > finalScore.A ? 'por' : finalScore.P < finalScore.A ? 'arg' : 'draw'
        won = b.selection === res
      } else if (b.market === 'ou') {
        won = b.selection === 'over' ? (finalScore.P + finalScore.A) > 2.5 : (finalScore.P + finalScore.A) <= 2.5
      } else if (b.market === 'btts') {
        const both = finalScore.P > 0 && finalScore.A > 0
        won = b.selection === 'yes' ? both : !both
      } else if (b.market === 'ah') {
        const res = finalScore.P > finalScore.A ? 'por' : 'arg'
        won = b.selection === res
      } else if (b.market === 'scorer') {
        const [team, name] = b.selection.split('_')
        won = events.some(e => e.type === 'goal' && e.team === team && e.scorer === name)
      }
      if (won) setBalance(bal => bal + b.stake * b.odds)
      return { ...b, status: won ? 'won' : 'lost' }
    }))
  }, [])

  // ── Resolve set piece (admin calls this manually) ────────────────────────
  const processSetpiece = useCallback((sp, state) => {
    const { team } = sp
    const opp   = team === 'portugal' ? 'argentina' : 'portugal'
    const oppGK = TEAMS[opp].players.gk
    let newScore  = { ...state.score }
    let goalEvent = null
    let notifMsg  = '', notifType = 'tick'

    const penTakers = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.penalty
    const fkTakers  = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.freekick
    const corTakers = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.corner

    if (sp.type === 'penalty') {
      const r = resolvePenalty(team, penTakers, oppGK, state.minute)
      if (r.outcome === 'goal') {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: r.taker, penalty: true }
        notifMsg = `⚽ PENALTY GOAL! ${r.taker} — ${r.takerDir} corner! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else if (r.outcome === 'saved') {
        notifMsg = `🧤 SAVED! ${oppGK} dives ${r.keeperDir} — stops ${r.taker}!`; notifType = 'save'
      } else if (r.outcome === 'post') {
        notifMsg = `🔔 POST! ${r.taker}'s penalty rattles the woodwork!`; notifType = 'post'
      } else {
        notifMsg = `❌ MISS! ${r.taker} blazes it over!`; notifType = 'miss'
      }
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_penalty' || b.status !== 'active') return b
        const won = b.selection === r.outcome || (b.selection === 'miss' && (r.outcome === 'miss' || r.outcome === 'post'))
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    } else if (sp.type === 'freekick') {
      const r = resolveFreekick(team, sp.distType, sp.position, fkTakers)
      const scored = r.outcome === 'goal' || r.outcome === 'goal_header'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: r.goalScorer || r.taker, freekick: true }
        notifMsg = `⚽ FREE KICK GOAL! ${r.taker}! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Free kick saved by ${oppGK}!`, post: `🔔 THE POST! Free kick rattles the bar!`, offtarget: `❌ Free kick off target.`, blocked: `🛡️ Blocked and cleared!` }
        notifMsg = msgs[r.outcome] || `Free kick — ${r.outcome}`; notifType = r.outcome === 'saved' ? 'save' : 'miss'
      }
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_freekick' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    } else if (sp.type === 'corner') {
      const r = resolveCorner(team, corTakers)
      const scored = r.outcome === 'goal' || r.outcome === 'goal_header' || r.outcome === 'goal_direct'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: r.goalScorer || r.taker, corner: true }
        notifMsg = `⚽ CORNER GOAL! ${r.taker} delivers — ${r.goalScorer}! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Corner saved!`, offtarget: `❌ Corner off target.`, cleared: `🛡️ Corner cleared!` }
        notifMsg = msgs[r.outcome] || `Corner — ${r.outcome}`; notifType = 'tick'
      }
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_corner' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    }

    return { newScore, newEvents: [...state.events, ...(goalEvent ? [goalEvent] : [])], notifMsg, notifType }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN ONLY: tick engine
  // Key design: auto-tick advances minutes. Set pieces pause the clock.
  // Admin resolves set pieces manually via adminResolveSetpiece.
  // Half time requires admin to press RESUME (no auto-resume).
  // ─────────────────────────────────────────────────────────────────────────

  const advanceMinute = useCallback(() => {
    setGs(prev => {
      if (prev.status !== 'live' || prev.setpiece || prev.paused) return prev

      const minute    = prev.minute + 1
      const endFirst  = 45 + prev.halfStoppage.first
      const endSecond = 90 + prev.halfStoppage.second

      let newNotifs = [...(prev.notifications || [])]
      const addN = (msg, type = 'tick') => {
        newNotifs = [{ id: Date.now() + Math.random(), msg, type, ts: Date.now() }, ...newNotifs].slice(0, 80)
      }

      // ── Half time ──
      if (prev.phase === 'first' && minute > endFirst) {
        addN(`🔔 HALF TIME — Portugal ${prev.score.P}–${prev.score.A} Argentina. Admin to start second half.`, 'system')
        const next = { ...prev, minute, status: 'halftime', phase: 'second',
          halfStoppage: { ...prev.halfStoppage, second: Math.min(5, Math.max(0, 3)) },
          notifications: newNotifs }
        pushMatchState(next)
        return next
      }

      // ── Full time ──
      if (prev.phase === 'second' && minute > endSecond) {
        const winner = prev.score.P > prev.score.A ? 'Portugal' : prev.score.P < prev.score.A ? 'Argentina' : 'Draw'
        addN(`⏱️ FULL TIME — Portugal ${prev.score.P}–${prev.score.A} Argentina! Result: ${winner}`, 'system')
        settleBets(prev.score, prev.events)
        const next = { ...prev, minute, status: 'finished', notifications: newNotifs }
        pushMatchState(next)
        return next
      }

      // ── Simulate this minute (goals, cards only — NO auto set pieces) ──
      const sim = simulateMinute(prev)
      let ns = { ...prev.score }, ne = [...prev.events]
      let nlP = prev.lambdaP, nlA = prev.lambdaA
      let nRC = { ...prev.redCards }, nYC = { ...prev.yellowCards }

      // NOTE: we deliberately IGNORE sim.type === 'penalty/freekick/corner'
      // Set pieces are admin-triggered only. We only process normal events.
      const events = sim.type === 'normal' ? sim.events : []

      for (const ev of events) {
        if (ev.type === 'goal') {
          ns[ev.team === 'portugal' ? 'P' : 'A']++
          ne.push(ev)
          if (ns.P === ns.A && ns.P + ns.A > 0) addN(`🔥 EQUALIZER! ${ev.scorer} — ${ns.P}–${ns.A}!`, 'goal')
          else if (minute > 90) addN(`🚨 STOPPAGE GOAL! ${ev.scorer} for ${TEAMS[ev.team].name}! ${ns.P}–${ns.A}`, 'goal')
          else addN(`⚽ GOAL! ${ev.scorer} (${TEAMS[ev.team].short})! ${ns.P}–${ns.A} ${minute}'`, 'goal')
        } else if (ev.type === 'redcard') {
          nRC[ev.team]++
          if (ev.team === 'portugal') nlP *= 0.65; else nlA *= 0.65
          addN(`🔴 ${ev.secondYellow ? 'SECOND YELLOW' : 'RED CARD'}! ${TEAMS[ev.team].name} down to 10 men!`, 'card')
        } else if (ev.type === 'yellow') {
          nYC[ev.team] = (nYC[ev.team] || 0) + 1
          addN(`🟨 Yellow card — ${TEAMS[ev.team].name}`, 'card')
        }
      }

      if (minute % 5 === 0 && events.length === 0) addN(`${minute}' — Match continues.`, 'tick')

      const next = { ...prev, minute, notifications: newNotifs,
        score: ns, events: ne, lambdaP: nlP, lambdaA: nlA,
        redCards: nRC, yellowCards: nYC }
      recalcOdds(next)
      pushMatchState(next)
      return next
    })
  }, [recalcOdds, settleBets])

  // ── Admin auto-tick (runs every TICK_SPEED ms when live) ─────────────────
  useEffect(() => {
    if (!isAdmin) return
    if (gs.status !== 'live' || gs.setpiece || gs.paused) return
    timerRef.current = setTimeout(advanceMinute, TICK_SPEED)
    return () => clearTimeout(timerRef.current)
  }, [isAdmin, gs.status, gs.minute, gs.setpiece, gs.paused, advanceMinute])

  // ── Participant: countdown timer from server setpiece state ──────────────
  useEffect(() => {
    if (isAdmin || !gs.setpiece) return
    setSpTimer(gs.setpiece.timerSec || 30)
    const iv = setInterval(() => setSpTimer(p => Math.max(0, p - 1)), 1000)
    return () => clearInterval(iv)
  }, [isAdmin, gs.setpiece?.market])

  // ── Place bet ─────────────────────────────────────────────────────────────
  const placeBet = useCallback((market, selection, oddsVal, maxStakeOverride) => {
    const stake = parseInt(stakeInput) || 0
    const max   = maxStakeOverride || MAX_BET
    if (stake < MIN_BET)  { pushNotif(`⚠️ Min bet is ${MIN_BET} coins.`, 'warn'); return false }
    if (stake > max)      { pushNotif(`⚠️ Max bet is ${max} coins.`, 'warn'); return false }
    if (betsRef.current.filter(b => b.status === 'active').length >= MAX_ACTIVE_BETS) {
      pushNotif('⚠️ Max 4 active bets at once.', 'warn'); return false
    }
    if (balRef.current < stake) { pushNotif('⚠️ Insufficient balance.', 'warn'); return false }
    setBalance(prev => prev - stake)
    const bet = { id: _nid++, market, selection, stake, odds: oddsVal, status: 'active',
                  ts: Date.now(), label: `${market.toUpperCase()} — ${selection}` }
    setBets(prev => [...prev, bet])
    setBetSlip(null)
    pushNotif(`✅ Bet: ${stake} coins @ ${fmt(oddsVal)} on ${selection}`, 'system')
    if (currentUser) saveBet(currentUser.id, currentUser.name, bet)
    return true
  }, [stakeInput, pushNotif, currentUser])

  // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────

  const adminKickOff = useCallback(() => {
    const s = makeInitialMatchState()
    s.status = 'live'
    s.notifications = [{ id: Date.now(), msg: '⚽ KICK OFF! Portugal vs Argentina is underway!', type: 'system', ts: Date.now() }]
    setGs(s); recalcOdds(s); pushMatchState(s)
    pushNotif('⚽ KICK OFF! Portugal vs Argentina is underway!', 'system')
  }, [recalcOdds, pushNotif])

  const adminPause = useCallback(() => {
    setGs(prev => {
      const next = { ...prev, paused: true,
        notifications: [{ id: Date.now(), msg: '⏸️ Match PAUSED.', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminResume = useCallback(() => {
    setGs(prev => {
      // Also works to start 2nd half from halftime
      const next = { ...prev, paused: false,
        status: prev.status === 'halftime' ? 'live' : prev.status,
        notifications: [{ id: Date.now(), msg: prev.status === 'halftime' ? '▶️ Second half underway!' : '▶️ Match RESUMED.', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminEndMatch = useCallback(() => {
    setGs(prev => {
      settleBets(prev.score, prev.events)
      const winner = prev.score.P > prev.score.A ? 'Portugal' : prev.score.P < prev.score.A ? 'Argentina' : 'Draw'
      const next = { ...prev, status: 'finished',
        notifications: [{ id: Date.now(), msg: `🛑 FULL TIME. Final: Portugal ${prev.score.P}–${prev.score.A} Argentina. ${winner} wins!`, type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [settleBets])

  const adminReset = useCallback(() => {
    const initial = makeInitialMatchState()
    setGs(initial); setBets([]); setBalance(INITIAL_BALANCE)
    setOdds(null); setBetSlip(null); setStakeInput('100')
    setNotifs([mkN('🏟️ Match reset. Portugal vs Argentina.', 'system')])
    pushMatchState(initial)
  }, [])

  const adminAddStoppage = useCallback((mins) => {
    setGs(prev => {
      const phase = prev.phase
      const next = { ...prev,
        halfStoppage: { ...prev.halfStoppage, [phase]: (prev.halfStoppage[phase] || 0) + mins },
        notifications: [{ id: Date.now(), msg: `⏱️ +${mins} min stoppage (${phase} half)`, type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminVoidMarket = useCallback((market) => {
    setBets(prev => prev.map(b => {
      if (b.market !== market || b.status !== 'active') return b
      setBalance(bal => bal + b.stake)
      return { ...b, status: 'void' }
    }))
    setGs(prev => {
      const next = { ...prev,
        notifications: [{ id: Date.now(), msg: `🚫 Market "${market}" voided — stakes refunded.`, type: 'warn', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  // ── Admin: manually resolve current set piece ────────────────────────────
  const adminResolveSetpiece = useCallback(() => {
    setGs(prev => {
      if (!prev.setpiece) return prev
      const { newScore, newEvents, notifMsg, notifType } = processSetpiece(prev.setpiece, prev)
      const newNotifs = notifMsg
        ? [{ id: Date.now(), msg: notifMsg, type: notifType, ts: Date.now() }, ...(prev.notifications || [])].slice(0, 80)
        : prev.notifications || []
      const next = { ...prev, score: newScore, events: newEvents, setpiece: null, notifications: newNotifs }
      recalcOdds(next)
      pushMatchState(next)
      return next
    })
  }, [processSetpiece, recalcOdds])

  // ── Admin: inject events ──────────────────────────────────────────────────
  const adminInjectEvent = useCallback((ev) => {
    const { team } = ev
    const spOpts = calcSetPieceOdds({ type: ev.type, team, distType: ev.distType, position: ev.position })

    if (ev.type === 'penalty' || ev.type === 'freekick' || ev.type === 'corner') {
      const timers  = { penalty: 20, freekick: 30, corner: 25 }
      const markets = { penalty: 'sp_penalty', freekick: 'sp_freekick', corner: 'sp_corner' }
      const titles  = {
        penalty:  `🚨 PENALTY — ${TEAMS[team].name.toUpperCase()}! 🚨`,
        freekick: `🎯 FREE KICK — ${TEAMS[team].name.toUpperCase()}`,
        corner:   `🚩 CORNER — ${TEAMS[team].name.toUpperCase()}`,
      }
      const msgs = {
        penalty:  `🚨 PENALTY! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'taker TBD'}. Bet now — ${timers.penalty}s!`,
        freekick: `🎯 FREE KICK! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'taker TBD'}, ${ev.distNum || '?'}yds ${ev.position || ''}. Bet now — ${timers.freekick}s!`,
        corner:   `🚩 CORNER! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'taker TBD'}. Bet now — ${timers.corner}s!`,
      }
      setGs(prev => {
        const next = { ...prev,
          notifications: [{ id: Date.now(), msg: msgs[ev.type], type: ev.type === 'penalty' ? 'penalty' : ev.type, ts: Date.now() }, ...(prev.notifications || [])],
          setpiece: {
            type: ev.type, team,
            distType: ev.distType || 'med', distNum: ev.distNum || 25,
            position: ev.position || 'central', forcedTaker: ev.forcedTaker || null,
            spOptions: spOpts, spTitle: titles[ev.type],
            timerSec: timers[ev.type], market: markets[ev.type],
          },
        }
        pushMatchState(next); return next
      })
      return
    }

    if (ev.type === 'goal') {
      setGs(prev => {
        const key = team === 'portugal' ? 'P' : 'A'
        const newScore  = { ...prev.score, [key]: prev.score[key] + 1 }
        const newEvents = [...prev.events, { type: 'goal', team, scorer: ev.scorer || 'Open Play' }]
        const msg = newScore.P === newScore.A && newScore.P + newScore.A > 0
          ? `🔥 EQUALIZER! ${ev.scorer || 'Open Play'} — ${newScore.P}–${newScore.A}!`
          : `⚽ GOAL! ${ev.scorer || 'Open Play'} (${TEAMS[team].short})! ${newScore.P}–${newScore.A} ${prev.minute}'`
        const next = { ...prev, score: newScore, events: newEvents,
          notifications: [{ id: Date.now(), msg, type: 'goal', ts: Date.now() }, ...(prev.notifications || [])] }
        recalcOdds(next); pushMatchState(next); return next
      })
      return
    }

    if (ev.type === 'yellow') {
      setGs(prev => {
        const ny = { ...prev.yellowCards, [team]: (prev.yellowCards[team] || 0) + 1 }
        const next = { ...prev, yellowCards: ny,
          notifications: [{ id: Date.now(), msg: `🟨 Yellow card — ${TEAMS[team].name}`, type: 'card', ts: Date.now() }, ...(prev.notifications || [])] }
        pushMatchState(next); return next
      })
      return
    }

    if (ev.type === 'redcard') {
      setGs(prev => {
        const nr = { ...prev.redCards, [team]: prev.redCards[team] + 1 }
        const lk = team === 'portugal' ? 'lambdaP' : 'lambdaA'
        const next = { ...prev, redCards: nr, [lk]: prev[lk] * 0.65,
          notifications: [{ id: Date.now(), msg: `🔴 RED CARD! ${TEAMS[team].name} down to 10 men! λ −35%`, type: 'card', ts: Date.now() }, ...(prev.notifications || [])] }
        recalcOdds(next); pushMatchState(next); return next
      })
    }
  }, [recalcOdds])

  // ── Save leaderboard at FT ────────────────────────────────────────────────
  useEffect(() => {
    if (gs.status !== 'finished' || !currentUser) return
    saveLeaderboard(currentUser.id, currentUser.name, balRef.current, betsRef.current.length)
  }, [gs.status, currentUser])

  return {
    gs, bets, balance, notifications, odds,
    betSlip, setBetSlip, stakeInput, setStakeInput,
    spTimer, connected, placeBet,
    startMatch: adminKickOff, resetMatch: adminReset,
    adminKickOff, adminPause, adminResume, adminEndMatch,
    adminReset, adminAddStoppage, adminVoidMarket,
    adminInjectEvent, adminResolveSetpiece,
  }
}
