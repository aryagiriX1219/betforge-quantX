import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAMS, TICK_SPEED, INITIAL_BALANCE, MIN_BET, MAX_BET, MAX_ACTIVE_BETS } from './constants'
import { calcAllOdds, fmt } from './math'
import { simulateMinute, resolveFreekick, resolveCorner, resolvePenalty, calcSetPieceOdds } from './engine'
import { supabase } from './supabase'

// ─── MATCH STATE ROW ID (single row in Supabase) ──────────────────────────────
const MATCH_ROW_ID = 1

let _notifId = 0
function mkNotif(msg, type = 'tick') {
  return { id: _notifId++, msg, type, ts: Date.now() }
}

function makeInitialMatchState() {
  const lambdaP = (TEAMS.portugal.strength * TEAMS.portugal.homeAdv) / 90
  const lambdaA = (TEAMS.argentina.strength * TEAMS.argentina.homeAdv) / 90
  return {
    minute:       0,
    score:        { P: 0, A: 0 },
    lambdaP,
    lambdaA,
    status:       'prematch',
    paused:       false,
    events:       [],
    redCards:     { portugal: 0, argentina: 0 },
    yellowCards:  { portugal: 0, argentina: 0 },
    halfStoppage: { first: 0, second: 0 },
    phase:        'first',
    setpiece:     null,
    notifications: [{ id: 0, msg: '🏟️ Welcome to BetForge! Portugal vs Argentina. Admin presses KICK OFF to begin.', type: 'system', ts: Date.now() }],
  }
}

// ─── PUSH MATCH STATE TO SUPABASE (admin only) ───────────────────────────────
async function pushMatchState(state) {
  try {
    await supabase.from('match_state').upsert({
      id: MATCH_ROW_ID,
      state: state,
      updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Supabase push error:', e)
  }
}

// ─── SAVE BET TO SUPABASE ─────────────────────────────────────────────────────
async function saveBet(userId, userName, bet) {
  try {
    await supabase.from('bets').upsert({
      id: `${userId}_${bet.id}`,
      user_id: userId,
      user_name: userName,
      market: bet.market,
      selection: bet.selection,
      stake: bet.stake,
      odds: bet.odds,
      status: bet.status,
      potential: bet.stake * bet.odds,
      updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Supabase bet save error:', e)
  }
}

// ─── SAVE FINAL BALANCE TO LEADERBOARD ───────────────────────────────────────
async function saveLeaderboard(userId, userName, balance, betsCount) {
  try {
    await supabase.from('leaderboard').upsert({
      user_id: userId,
      user_name: userName,
      balance: Math.round(balance),
      pnl: Math.round(balance - INITIAL_BALANCE),
      bets_count: betsCount,
      updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Supabase leaderboard error:', e)
  }
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export function useMatch(currentUser = null, isAdmin = false) {
  const [gs, setGs]             = useState(makeInitialMatchState)
  const [bets, setBets]         = useState([])
  const [balance, setBalance]   = useState(INITIAL_BALANCE)
  const [notifications, setNotifications] = useState([
    mkNotif('🏟️ Welcome to BetForge! Portugal vs Argentina.', 'system'),
  ])
  const [odds, setOdds]         = useState(null)
  const [betSlip, setBetSlip]   = useState(null)
  const [stakeInput, setStakeInput] = useState('100')
  const [spTimer, setSpTimer]   = useState(0)
  const [connected, setConnected] = useState(false)

  const timerRef  = useRef(null)
  const gsRef     = useRef(gs);      gsRef.current   = gs
  const betsRef   = useRef(bets);    betsRef.current = bets
  const balRef    = useRef(balance); balRef.current  = balance
  const isAdminRef = useRef(isAdmin); isAdminRef.current = isAdmin

  // ── Push notification (local only — notifications come from match state) ──
  const pushNotif = useCallback((msg, type = 'tick') => {
    const n = mkNotif(msg, type)
    setNotifications(prev => [n, ...prev].slice(0, 80))
    return n
  }, [])

  const recalcOdds = useCallback((state) => {
    setOdds(calcAllOdds(state.score, state.minute, state.lambdaP, state.lambdaA))
  }, [])

  // ── Subscribe to Supabase Realtime (ALL clients including admin) ──────────
  useEffect(() => {
    // Load initial state
    supabase.from('match_state').select('state').eq('id', MATCH_ROW_ID).single()
      .then(({ data, error }) => {
        if (data?.state) {
          const s = data.state
          setGs(s)
          recalcOdds(s)
          if (s.notifications?.length) {
            setNotifications(s.notifications.slice(0, 80).map(n => ({ ...n, id: _notifId++ })))
          }
          setConnected(true)
        }
      })

    // Subscribe to live changes
    const channel = supabase
      .channel('match_state_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'match_state',
        filter: `id=eq.${MATCH_ROW_ID}`,
      }, (payload) => {
        if (!payload.new?.state) return
        const s = payload.new.state
        // Non-admin: update everything from server
        if (!isAdminRef.current) {
          setGs(s)
          recalcOdds(s)
          if (s.notifications?.length) {
            setNotifications(s.notifications.slice(0, 80).map(n => ({ ...n, id: _notifId++ })))
          }
        }
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [recalcOdds])

  // ── Load user's own bets from Supabase on mount ───────────────────────────
  useEffect(() => {
    if (!currentUser) return
    supabase.from('bets').select('*').eq('user_id', currentUser.id)
      .then(({ data }) => {
        if (data?.length) {
          setBets(data.map(b => ({
            id: b.id, market: b.market, selection: b.selection,
            stake: b.stake, odds: b.odds, status: b.status,
            label: `${b.market.toUpperCase()} — ${b.selection}`,
          })))
          // Recalculate balance from bets
          const won = data.filter(b => b.status === 'won').reduce((s, b) => s + b.stake * b.odds, 0)
          const spent = data.reduce((s, b) => s + (b.status !== 'void' ? b.stake : 0), 0)
          setBalance(INITIAL_BALANCE - spent + won)
        }
      })
  }, [currentUser])

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN-ONLY: tick engine, push state to Supabase
  // ─────────────────────────────────────────────────────────────────────────

  const settleBets = useCallback((finalScore, events) => {
    setBets(prev => {
      const updated = prev.map(b => {
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
      })
      return updated
    })
  }, [])

  const processSetpiece = useCallback((sp, state) => {
    const { team } = sp
    const opp    = team === 'portugal' ? 'argentina' : 'portugal'
    const oppGK  = TEAMS[opp].players.gk
    let newScore  = { ...state.score }
    let goalEvent = null

    const penTakers = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.penalty
    const fkTakers  = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.freekick
    const corTakers = sp.forcedTaker ? [{ ...sp.forcedTaker, weight: 1 }] : TEAMS[team].players.corner

    let notifMsg = '', notifType = 'tick'

    if (sp.type === 'penalty') {
      const result = resolvePenalty(team, penTakers, oppGK, state.minute)
      if (result.outcome === 'goal') {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: result.taker, penalty: true }
        notifMsg = `⚽ PENALTY GOAL! ${result.taker} converts! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else if (result.outcome === 'saved') {
        notifMsg = `🧤 SAVED! ${oppGK} stops ${result.taker}!`; notifType = 'save'
      } else if (result.outcome === 'post') {
        notifMsg = `🔔 POST! ${result.taker}'s penalty rattles the woodwork!`; notifType = 'post'
      } else {
        notifMsg = `❌ MISS! ${result.taker} blazes it over!`; notifType = 'miss'
      }
      // settle sp bets locally
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_penalty' || b.status !== 'active') return b
        const won = b.selection === result.outcome ||
          (b.selection === 'miss' && (result.outcome === 'miss' || result.outcome === 'post'))
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    } else if (sp.type === 'freekick') {
      const result = resolveFreekick(team, sp.distType, sp.position, fkTakers)
      const scored = result.outcome === 'goal' || result.outcome === 'goal_header'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: result.goalScorer || result.taker, freekick: true }
        notifMsg = `⚽ FREE KICK GOAL! ${result.taker} curls it in! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Free kick saved!`, post: `🔔 THE POST!`, offtarget: `❌ Free kick off target.`, blocked: `🛡️ Blocked and cleared!` }
        notifMsg = msgs[result.outcome] || `Free kick — ${result.outcome}`; notifType = result.outcome === 'saved' ? 'save' : 'miss'
      }
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_freekick' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === result.outcome
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    } else if (sp.type === 'corner') {
      const result = resolveCorner(team, corTakers)
      const scored = result.outcome === 'goal' || result.outcome === 'goal_header' || result.outcome === 'goal_direct'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: result.goalScorer || result.taker, corner: true }
        notifMsg = `⚽ CORNER GOAL! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Corner saved!`, offtarget: `❌ Off target from corner.`, cleared: `🛡️ Corner cleared!` }
        notifMsg = msgs[result.outcome] || `Corner — ${result.outcome}`; notifType = 'tick'
      }
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_corner' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === result.outcome
        if (won) setBalance(bal => bal + b.stake * b.odds)
        return { ...b, status: won ? 'won' : 'lost' }
      }))
    }

    const newEvents = [...state.events, ...(goalEvent ? [goalEvent] : [])]
    return { newScore, newEvents, notifMsg, notifType }
  }, [])

  // ── Admin: advance one match minute + push to Supabase ───────────────────
  const advanceMinute = useCallback(() => {
    setGs(prev => {
      if (prev.status === 'finished' || prev.status === 'halftime' || prev.setpiece || prev.paused) return prev

      const minute    = prev.minute + 1
      const endFirst  = 45 + prev.halfStoppage.first
      const endSecond = 90 + prev.halfStoppage.second

      let newNotifs = [...(prev.notifications || [])]
      const addN = (msg, type = 'tick') => {
        newNotifs = [{ id: Date.now() + Math.random(), msg, type, ts: Date.now() }, ...newNotifs].slice(0, 80)
      }

      if (prev.phase === 'first' && minute > endFirst) {
        const stoppage = Math.min(5, Math.max(0, Math.round(3 + 0.5 * (prev.redCards.portugal + prev.redCards.argentina))))
        addN(`🔔 HALF TIME — Portugal ${prev.score.P}–${prev.score.A} Argentina.`, 'system')
        const next = { ...prev, minute, status: 'halftime', phase: 'second',
                       halfStoppage: { ...prev.halfStoppage, second: stoppage }, notifications: newNotifs }
        pushMatchState(next)
        return next
      }

      if (prev.phase === 'second' && minute > endSecond) {
        const winner = prev.score.P > prev.score.A ? 'Portugal' : prev.score.P < prev.score.A ? 'Argentina' : 'Draw'
        addN(`⏱️ FULL TIME — Portugal ${prev.score.P}–${prev.score.A} Argentina! Result: ${winner}`, 'system')
        settleBets(prev.score, prev.events)
        const next = { ...prev, minute, status: 'finished', notifications: newNotifs }
        pushMatchState(next)
        return next
      }

      const sim = simulateMinute(prev)
      let newScore    = { ...prev.score }
      let newEvents   = [...prev.events]
      let newLambdaP  = prev.lambdaP
      let newLambdaA  = prev.lambdaA
      let newRedCards = { ...prev.redCards }
      let newYellows  = { ...prev.yellowCards }

      if (sim.type === 'penalty' || sim.type === 'freekick' || sim.type === 'corner') {
        const team   = sim.team
        const spOpts = calcSetPieceOdds(sim)
        const timers = { penalty: 20, freekick: 30, corner: 25 }
        const titles = {
          penalty:  `🚨 PENALTY — ${TEAMS[team].name.toUpperCase()}! 🚨`,
          freekick: `🎯 FREE KICK — ${TEAMS[team].name.toUpperCase()}`,
          corner:   `🚩 CORNER — ${TEAMS[team].name.toUpperCase()}`,
        }
        const markets = { penalty: 'sp_penalty', freekick: 'sp_freekick', corner: 'sp_corner' }
        const msgs = {
          penalty:  `🚨 PENALTY! ${TEAMS[team].name} — Bet now! 20s!`,
          freekick: `🎯 FREE KICK! ${TEAMS[team].name} — ${sim.distNum || ''}yds ${sim.position || ''}. 30s!`,
          corner:   `🚩 CORNER! ${TEAMS[team].name} — Bet now! 25s!`,
        }
        addN(msgs[sim.type], sim.type === 'penalty' ? 'penalty' : sim.type === 'freekick' ? 'freekick' : 'corner')
        const next = {
          ...prev, minute, notifications: newNotifs,
          setpiece: { ...sim, spOptions: spOpts, spTitle: titles[sim.type], timerSec: timers[sim.type], market: markets[sim.type] },
        }
        pushMatchState(next)
        return next
      }

      for (const ev of sim.events) {
        if (ev.type === 'goal') {
          const key = ev.team === 'portugal' ? 'P' : 'A'
          newScore[key]++
          newEvents.push(ev)
          if (newScore.P === newScore.A && newScore.P + newScore.A > 0) addN(`🔥 EQUALIZER! ${ev.scorer} — ${newScore.P}–${newScore.A}!`, 'goal')
          else if (minute > 90) addN(`🚨 STOPPAGE GOAL! ${ev.scorer}! ${newScore.P}–${newScore.A}`, 'goal')
          else addN(`⚽ GOAL! ${ev.scorer} (${TEAMS[ev.team].short})! ${newScore.P}–${newScore.A} ${minute}'`, 'goal')
        } else if (ev.type === 'redcard') {
          newRedCards[ev.team]++
          if (ev.team === 'portugal') newLambdaP *= 0.65; else newLambdaA *= 0.65
          addN(`🔴 ${ev.secondYellow ? 'SECOND YELLOW' : 'RED CARD'}! ${TEAMS[ev.team].name} 10 men!`, 'card')
        } else if (ev.type === 'yellow') {
          newYellows[ev.team] = (newYellows[ev.team] || 0) + 1
          addN(`🟨 Yellow card — ${TEAMS[ev.team].name}`, 'card')
        }
      }

      if (minute % 5 === 0 && sim.events.length === 0) addN(`${minute}' — Match continues.`, 'tick')

      const newState = {
        ...prev, minute, notifications: newNotifs,
        score: newScore, events: newEvents,
        lambdaP: newLambdaP, lambdaA: newLambdaA,
        redCards: newRedCards, yellowCards: newYellows,
      }
      recalcOdds(newState)
      pushMatchState(newState)
      return newState
    })
  }, [recalcOdds, settleBets])

  // ── Admin tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return
    if (gs.status !== 'live' || gs.setpiece || gs.paused) return
    timerRef.current = setTimeout(advanceMinute, TICK_SPEED)
    return () => clearTimeout(timerRef.current)
  }, [isAdmin, gs.status, gs.minute, gs.setpiece, gs.paused, advanceMinute])

  // ── Admin: half-time auto-resume ─────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return
    if (gs.status !== 'halftime') return
    const t = setTimeout(() => {
      setGs(prev => {
        const next = { ...prev, status: 'live', phase: 'second', minute: 45,
                       notifications: [{ id: Date.now(), msg: '▶️ Second half underway!', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
        pushMatchState(next)
        return next
      })
    }, 8000)
    return () => clearTimeout(t)
  }, [isAdmin, gs.status])

  // ── Set piece countdown (admin resolves, pushes; participants just watch) ─
  useEffect(() => {
    if (!gs.setpiece) return
    setSpTimer(gs.setpiece.timerSec)
    if (!isAdmin) return   // only admin runs the countdown timer
    const interval = setInterval(() => {
      setSpTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          setGs(prevGs => {
            if (!prevGs.setpiece) return prevGs
            const { newScore, newEvents, notifMsg, notifType } = processSetpiece(prevGs.setpiece, prevGs)
            const newNotifs = notifMsg
              ? [{ id: Date.now(), msg: notifMsg, type: notifType, ts: Date.now() }, ...(prevGs.notifications || [])].slice(0, 80)
              : prevGs.notifications || []
            const next = { ...prevGs, score: newScore, events: newEvents, setpiece: null, notifications: newNotifs }
            recalcOdds(next)
            pushMatchState(next)
            return next
          })
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [gs.setpiece?.market, isAdmin, processSetpiece, recalcOdds])

  // ── Participants: mirror spTimer from setpiece timerSec ──────────────────
  useEffect(() => {
    if (isAdmin || !gs.setpiece) return
    setSpTimer(gs.setpiece.timerSec)
    const iv = setInterval(() => setSpTimer(p => Math.max(0, p - 1)), 1000)
    return () => clearInterval(iv)
  }, [isAdmin, gs.setpiece?.market])

  // ── Sync notifications from gs to local state (non-admin) ────────────────
  useEffect(() => {
    if (isAdmin) return
    if (gs.notifications?.length) {
      setNotifications(gs.notifications.slice(0, 80).map(n => ({ ...n, id: _notifId++ })))
    }
  }, [isAdmin, gs.notifications])

  // ── Place bet ────────────────────────────────────────────────────────────
  const placeBet = useCallback((market, selection, oddsVal, maxStakeOverride) => {
    const stake = parseInt(stakeInput) || 0
    const max   = maxStakeOverride || MAX_BET
    if (stake < MIN_BET)           { pushNotif(`⚠️ Min bet is ${MIN_BET} coins.`, 'warn'); return false }
    if (stake > max)               { pushNotif(`⚠️ Max bet is ${max} coins.`, 'warn'); return false }
    if (betsRef.current.filter(b => b.status === 'active').length >= MAX_ACTIVE_BETS) {
      pushNotif('⚠️ Max 4 active bets at once.', 'warn'); return false
    }
    if (balRef.current < stake) { pushNotif('⚠️ Insufficient balance.', 'warn'); return false }

    setBalance(prev => prev - stake)
    const bet = {
      id: _notifId++, market, selection, stake, odds: oddsVal,
      status: 'active', ts: Date.now(),
      label: `${market.toUpperCase()} — ${selection}`,
    }
    setBets(prev => [...prev, bet])
    setBetSlip(null)
    pushNotif(`✅ Bet: ${stake} coins @ ${fmt(oddsVal)} on ${selection}`, 'system')

    // Save to Supabase
    if (currentUser) saveBet(currentUser.id, currentUser.name, bet)
    return true
  }, [stakeInput, pushNotif, currentUser])

  // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────

  const adminKickOff = useCallback(() => {
    const s = { ...makeInitialMatchState(), status: 'live', minute: 0 }
    s.notifications = [{ id: Date.now(), msg: '⚽ KICK OFF! Portugal vs Argentina is underway!', type: 'system', ts: Date.now() }]
    setGs(s); recalcOdds(s); pushMatchState(s)
    pushNotif('⚽ KICK OFF! Portugal vs Argentina is underway!', 'system')
  }, [recalcOdds, pushNotif])

  const adminPause = useCallback(() => {
    setGs(prev => {
      const next = { ...prev, paused: true,
        notifications: [{ id: Date.now(), msg: '⏸️ Match PAUSED by admin.', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminResume = useCallback(() => {
    setGs(prev => {
      const next = { ...prev, paused: false,
        notifications: [{ id: Date.now(), msg: '▶️ Match RESUMED.', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminEndMatch = useCallback(() => {
    setGs(prev => {
      settleBets(prev.score, prev.events)
      const next = { ...prev, status: 'finished',
        notifications: [{ id: Date.now(), msg: `🛑 Match ended. Final: ${prev.score.P}–${prev.score.A}`, type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [settleBets])

  const adminReset = useCallback(() => {
    const initial = makeInitialMatchState()
    setGs(initial); setBets([]); setBalance(INITIAL_BALANCE)
    setOdds(null); setBetSlip(null); setStakeInput('100')
    setNotifications([mkNotif('🏟️ New match! Portugal vs Argentina.', 'system')])
    pushMatchState(initial)
  }, [])

  const adminAddStoppage = useCallback((mins) => {
    setGs(prev => {
      const phase = prev.phase
      const next = {
        ...prev,
        halfStoppage: { ...prev.halfStoppage, [phase]: (prev.halfStoppage[phase] || 0) + mins },
        notifications: [{ id: Date.now(), msg: `⏱️ +${mins} min stoppage (${phase} half)`, type: 'system', ts: Date.now() }, ...(prev.notifications || [])]
      }
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

  const adminInjectEvent = useCallback((ev) => {
    const team    = ev.team
    const spOpts  = calcSetPieceOdds({ type: ev.type, team, distType: ev.distType, position: ev.position })

    if (ev.type === 'penalty' || ev.type === 'freekick' || ev.type === 'corner') {
      const timers  = { penalty: 20, freekick: 30, corner: 25 }
      const markets = { penalty: 'sp_penalty', freekick: 'sp_freekick', corner: 'sp_corner' }
      const titles  = {
        penalty:  `🚨 PENALTY — ${TEAMS[team].name.toUpperCase()}! 🚨`,
        freekick: `🎯 FREE KICK — ${TEAMS[team].name.toUpperCase()}`,
        corner:   `🚩 CORNER — ${TEAMS[team].name.toUpperCase()}`,
      }
      const msgs = {
        penalty:  `🚨 [ADMIN] PENALTY! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'auto'}. 20s!`,
        freekick: `🎯 [ADMIN] FREE KICK! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'auto'}, ${ev.distNum || '?'}yds. 30s!`,
        corner:   `🚩 [ADMIN] CORNER! ${TEAMS[team].name} — ${ev.forcedTaker?.name || 'auto'}. 25s!`,
      }
      setGs(prev => {
        const next = {
          ...prev,
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
          notifications: [{ id: Date.now(), msg: `🔴 RED CARD! ${TEAMS[team].name} down to 10 men!`, type: 'card', ts: Date.now() }, ...(prev.notifications || [])] }
        recalcOdds(next); pushMatchState(next); return next
      })
    }
  }, [recalcOdds])

  // ── After match: save leaderboard ────────────────────────────────────────
  useEffect(() => {
    if (gs.status !== 'finished' || !currentUser) return
    saveLeaderboard(currentUser.id, currentUser.name, balRef.current, betsRef.current.length)
  }, [gs.status, currentUser])

  return {
    gs, bets, balance, notifications, odds,
    betSlip, setBetSlip,
    stakeInput, setStakeInput,
    spTimer, connected,
    placeBet,
    startMatch: adminKickOff,
    resetMatch: adminReset,
    adminKickOff, adminPause, adminResume, adminEndMatch,
    adminReset, adminAddStoppage, adminVoidMarket, adminInjectEvent,
  }
}
