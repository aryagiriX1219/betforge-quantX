import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAMS, TICK_SPEED, INITIAL_BALANCE, MIN_BET, MAX_BET, MAX_ACTIVE_BETS } from './constants'
import { calcAllOdds, fmt } from './math'
import { simulateMinute, resolveFreekick, resolveCorner, resolvePenalty, calcSetPieceOdds } from './engine'
import { supabase } from './supabase'

const MATCH_ROW_ID = 1
let _nid = 0
const mkN = (msg, type = 'tick') => ({ id: _nid++, msg, type, ts: Date.now() })

const DEFAULT_NOTIF = [{ id: 0, msg: '🏟️ Welcome to BetForge! Portugal vs Argentina.', type: 'system', ts: Date.now() }]

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
    notifications: DEFAULT_NOTIF,
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
    // BUG FIX: bet.id may already be the composite "userId_localId" string (when
    // loaded from Supabase), or it may be a plain numeric local id (freshly placed).
    // Avoid double-prefixing by checking whether the id already starts with userId.
    const compositeId = String(bet.id).startsWith(`${userId}_`)
      ? String(bet.id)
      : `${userId}_${bet.id}`
    await supabase.from('bets').upsert({
      id: compositeId, user_id: userId, user_name: userName,
      market: bet.market, selection: bet.selection, stake: bet.stake,
      odds: bet.odds, status: bet.status, potential: bet.stake * bet.odds,
      updated_at: new Date().toISOString(),
    })
  } catch (e) { console.error('bet save error:', e) }
}

async function saveLeaderboard(userId, userName, balance, wonCount, lostCount, totalSettled) {
  try {
    await supabase.from('leaderboard').upsert({
      user_id: userId, user_name: userName,
      balance: Math.round(balance),
      pnl: Math.round(balance - INITIAL_BALANCE),
      bets_count: totalSettled,
      updated_at: new Date().toISOString(),
    })
  } catch (e) { console.error('lb error:', e) }
}

// ─── FORCE-REPLACE notifications from server state ───────────────────────────
function syncNotifs(serverNotifs, setNotifs) {
  const list = Array.isArray(serverNotifs) && serverNotifs.length
    ? serverNotifs
    : DEFAULT_NOTIF
  setNotifs(list.slice(0, 80).map(n => ({ ...n, id: _nid++ })))
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export function useMatch(currentUser = null, isAdmin = false) {
  const [gs, setGs]                 = useState(makeInitialMatchState)
  const [bets, setBets]             = useState([])
  const [balance, setBalance]       = useState(INITIAL_BALANCE)
  const [notifications, setNotifs]  = useState(DEFAULT_NOTIF.map(n => ({ ...n, id: _nid++ })))
  const [odds, setOdds]             = useState(null)
  const [betSlip, setBetSlip]       = useState(null)
  const [stakeInput, setStakeInput] = useState('100')
  const [spTimer, setSpTimer]       = useState(0)
  const [connected, setConnected]   = useState(false)

  const timerRef   = useRef(null)
  const gsRef      = useRef(gs);           gsRef.current      = gs
  const betsRef    = useRef(bets);         betsRef.current    = bets
  const balRef     = useRef(balance);      balRef.current     = balance
  const isAdminRef = useRef(isAdmin);      isAdminRef.current = isAdmin
  // userRef lets callbacks with [] deps always access the latest currentUser
  const userRef    = useRef(currentUser);  userRef.current    = currentUser

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
        const s = data?.state?.score ? data.state : makeInitialMatchState()
        setGs(s)
        recalcOdds(s)
        syncNotifs(s.notifications, setNotifs)
        setConnected(true)
      })
      .catch(() => setConnected(false))

    const channel = supabase
      .channel('match_state_changes')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'match_state',
        filter: `id=eq.${MATCH_ROW_ID}`,
      }, (payload) => {
        const s = payload.new?.state
        if (!s?.score) return
        setGs(s)
        recalcOdds(s)
        syncNotifs(s.notifications, setNotifs)
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    return () => supabase.removeChannel(channel)
  }, [recalcOdds])

  // ── Supabase realtime: sync bet settlements to participants ───────────────
  // No server-side filter — Supabase requires REPLICA IDENTITY FULL for filtered
  // subscriptions, which may not be set. Filter client-side instead to be safe.
  useEffect(() => {
    if (!currentUser) return
    const uid = String(currentUser.id)
    const betChannel = supabase
      .channel(`bets_all_${uid}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'bets',
      }, (payload) => {
        const updated = payload.new
        if (!updated?.id) return
        // Client-side filter: only handle rows belonging to this user
        if (String(updated.user_id) !== uid) return
        setBets(prev => prev.map(b => {
          if (b.id !== updated.id) return b
          if (b.status === updated.status) return b // already up to date
          if (updated.status === 'won') {
            setBalance(bal => bal + updated.stake * updated.odds)
          }
          return { ...b, status: updated.status }
        }))
      })
      .subscribe()
    return () => supabase.removeChannel(betChannel)
  }, [currentUser])

  // ── Load user's bets from Supabase on login ───────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    supabase.from('bets').select('*').eq('user_id', currentUser.id)
      .then(({ data }) => {
        if (!data?.length) return
        setBets(data.map(b => ({
          id: b.id, market: b.market, selection: b.selection,
          stake: b.stake, odds: b.odds, status: b.status,
          ts: b.ts || 0,
          label: `${b.market.toUpperCase()} — ${b.selection}`,
        })))
        // BUG FIX: rebuild balance only from settled bets so a mid-game
        // reconnect never overwrites a balance that already includes live winnings.
        // Formula: start + sum(won payouts) - sum(all non-void stakes)
        const nonVoid = data.filter(b => b.status !== 'void')
        const spent   = nonVoid.reduce((s, b) => s + b.stake, 0)
        const won     = data.filter(b => b.status === 'won').reduce((s, b) => s + b.stake * b.odds, 0)
        const rebuilt = INITIAL_BALANCE - spent + won
        // Only apply if balance hasn't been touched yet (still at initial value)
        // to avoid overwriting a live-credited balance on reconnect.
        setBalance(cur => cur === INITIAL_BALANCE ? rebuilt : Math.max(cur, rebuilt))
      })
  }, [currentUser])

  // ── Helper: settle one bet and persist to Supabase ────────────────────────
  // Returns the updated bet object. Call inside setBets map only.
  const _settleSingle = useCallback((b, won) => {
    if (won) setBalance(bal => bal + b.stake * b.odds)
    const updated = { ...b, status: won ? 'won' : 'lost' }
    // CRITICAL FIX: update the bet row directly by its composite id.
    // Do NOT use saveBet(userRef.current...) — on the admin's machine userRef
    // is the admin who has no bets. Instead update the row by its known id
    // so the Supabase realtime subscription on every participant's client fires.
    supabase.from('bets')
      .update({ status: updated.status, updated_at: new Date().toISOString() })
      .eq('id', String(b.id))
      .then(({ error }) => { if (error) console.error('settle error:', error) })
    // Also update leaderboard after settlement
    setTimeout(() => {
      const u = userRef.current
      if (!u) return
      const allBets   = betsRef.current
      const wonCount  = allBets.filter(b2 => b2.status === 'won' || (b2.id === updated.id && won)).length
      const lostCount = allBets.filter(b2 => b2.status === 'lost' || (b2.id === updated.id && !won)).length
      const settled   = wonCount + lostCount
      saveLeaderboard(u.id, u.name, balRef.current, wonCount, lostCount, settled)
    }, 600)
    return updated
  }, [])

  // ── Settle all remaining active bets at FT ───────────────────────────────
  // CRITICAL FIX: settleBets runs on the admin's machine where betsRef is empty.
  // Instead of iterating local state, fetch ALL active bets from Supabase,
  // determine won/lost for each, and update them directly so every participant's
  // realtime subscription fires and credits their balance.
  const settleBets = useCallback((finalScore, events) => {
    // Also settle local bets (for the participant who happens to be on this client)
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
      } else if (b.market === 'next') {
        const nextGoal = events.find(e => e.type === 'goal' && (e.ts || 0) > (b.ts || 0))
        won = nextGoal ? b.selection === nextGoal.team : b.selection === 'none'
      }
      return _settleSingle(b, won)
    }))

    // Fetch and settle ALL active bets in Supabase (covers every participant)
    supabase.from('bets').select('*').eq('status', 'active').then(({ data }) => {
      if (!data?.length) return
      data.forEach(b => {
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
        } else if (b.market === 'next') {
          const nextGoal = events.find(e => e.type === 'goal' && (e.ts || 0) > (b.ts || 0))
          won = nextGoal ? b.selection === nextGoal.team : b.selection === 'none'
        }
        supabase.from('bets')
          .update({ status: won ? 'won' : 'lost', updated_at: new Date().toISOString() })
          .eq('id', b.id)
          .then(({ error }) => { if (error) console.error('ft settle error:', error) })
      })
    })
  }, [_settleSingle])

  // ── FIX Bug 3: Save leaderboard with correct post-settlement balance ───────
  // Called after a brief delay so React has flushed setBalance state updates
  const _saveLeaderboardDelayed = useCallback(() => {
    setTimeout(() => {
      const u = userRef.current
      if (!u) return
      const allBets    = betsRef.current
      const wonCount   = allBets.filter(b => b.status === 'won').length
      const lostCount  = allBets.filter(b => b.status === 'lost').length
      const settled    = wonCount + lostCount
      saveLeaderboard(u.id, u.name, balRef.current, wonCount, lostCount, settled)
    }, 800) // 800ms — enough for React to flush all setBalance calls
  }, [])

  // ── Resolve set piece (admin calls this manually) ─────────────────────────
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
        // FIX: Add ts so next-goal market can compare against bet placement time
        goalEvent = { type: 'goal', team, scorer: r.taker, penalty: true, ts: Date.now() }
        notifMsg = `⚽ PENALTY GOAL! ${r.taker} — ${r.takerDir} corner! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else if (r.outcome === 'saved') {
        notifMsg = `🧤 SAVED! ${oppGK} dives ${r.keeperDir} — stops ${r.taker}!`; notifType = 'save'
      } else if (r.outcome === 'post') {
        notifMsg = `🔔 POST! ${r.taker}'s penalty rattles the woodwork!`; notifType = 'post'
      } else {
        notifMsg = `❌ MISS! ${r.taker} blazes it over!`; notifType = 'miss'
      }
      // Settle sp_penalty: update local state + ALL users' rows in Supabase
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_penalty' || b.status !== 'active') return b
        const won = b.selection === r.outcome ||
          (b.selection === 'miss' && (r.outcome === 'miss' || r.outcome === 'post'))
        return _settleSingle(b, won)
      }))
      // CRITICAL FIX: fetch all sp_penalty bets from Supabase and settle for all users
      supabase.from('bets').select('*').eq('market', 'sp_penalty').eq('status', 'active').then(({ data }) => {
        if (!data?.length) return
        data.forEach(b => {
          const won = b.selection === r.outcome ||
            (b.selection === 'miss' && (r.outcome === 'miss' || r.outcome === 'post'))
          supabase.from('bets').update({ status: won ? 'won' : 'lost', updated_at: new Date().toISOString() }).eq('id', b.id).then()
        })
      })

    } else if (sp.type === 'freekick') {
      const r = resolveFreekick(team, sp.distType, sp.position, fkTakers)
      const scored = r.outcome === 'goal' || r.outcome === 'goal_header'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: r.goalScorer || r.taker, freekick: true, ts: Date.now() }
        notifMsg = `⚽ FREE KICK GOAL! ${r.taker}! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Free kick saved by ${oppGK}!`, post: `🔔 THE POST! Free kick rattles the bar!`, offtarget: `❌ Free kick off target.`, blocked: `🛡️ Blocked and cleared!` }
        notifMsg = msgs[r.outcome] || `Free kick — ${r.outcome}`; notifType = r.outcome === 'saved' ? 'save' : 'miss'
      }
      // Settle sp_freekick: update local + all users in Supabase
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_freekick' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
        return _settleSingle(b, won)
      }))
      supabase.from('bets').select('*').eq('market', 'sp_freekick').eq('status', 'active').then(({ data }) => {
        if (!data?.length) return
        data.forEach(b => {
          const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
          supabase.from('bets').update({ status: won ? 'won' : 'lost', updated_at: new Date().toISOString() }).eq('id', b.id).then()
        })
      })

    } else if (sp.type === 'corner') {
      const r = resolveCorner(team, corTakers)
      const scored = r.outcome === 'goal' || r.outcome === 'goal_header' || r.outcome === 'goal_direct'
      if (scored) {
        newScore[team === 'portugal' ? 'P' : 'A']++
        goalEvent = { type: 'goal', team, scorer: r.goalScorer || r.taker, corner: true, ts: Date.now() }
        notifMsg = `⚽ CORNER GOAL! ${r.taker} delivers — ${r.goalScorer}! ${newScore.P}–${newScore.A}`; notifType = 'goal'
      } else {
        const msgs = { saved: `🧤 Corner saved!`, offtarget: `❌ Corner off target.`, cleared: `🛡️ Corner cleared!` }
        notifMsg = msgs[r.outcome] || `Corner — ${r.outcome}`; notifType = 'tick'
      }
      // Settle sp_corner: update local + all users in Supabase
      setBets(prev => prev.map(b => {
        if (b.market !== 'sp_corner' || b.status !== 'active') return b
        const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
        return _settleSingle(b, won)
      }))
      supabase.from('bets').select('*').eq('market', 'sp_corner').eq('status', 'active').then(({ data }) => {
        if (!data?.length) return
        data.forEach(b => {
          const won = (b.selection === 'goal' && scored) || b.selection === r.outcome
          supabase.from('bets').update({ status: won ? 'won' : 'lost', updated_at: new Date().toISOString() }).eq('id', b.id).then()
        })
      })
    }

    return { newScore, newEvents: [...state.events, ...(goalEvent ? [goalEvent] : [])], notifMsg, notifType }
  }, [_settleSingle])

  // ── Admin tick engine ─────────────────────────────────────────────────────
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

      if (prev.phase === 'first' && minute > endFirst) {
        addN(`🔔 HALF TIME — Portugal ${prev.score.P}–${prev.score.A} Argentina. Admin to start second half.`, 'system')
        const next = { ...prev, minute, status: 'halftime', phase: 'second',
          halfStoppage: { ...prev.halfStoppage, second: 3 }, notifications: newNotifs }
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
      let ns = { ...prev.score }, ne = [...prev.events]
      let nlP = prev.lambdaP, nlA = prev.lambdaA
      let nRC = { ...prev.redCards }, nYC = { ...prev.yellowCards }
      const events = sim.type === 'normal' ? sim.events : []

      for (const ev of events) {
        if (ev.type === 'goal') {
          ns[ev.team === 'portugal' ? 'P' : 'A']++
          // FIX: stamp ts on every goal event so 'next' market can compare timestamps
          ne.push({ ...ev, ts: Date.now() })
          if (ns.P === ns.A && ns.P + ns.A > 0) addN(`🔥 EQUALIZER! ${ev.scorer} — ${ns.P}–${ns.A}!`, 'goal')
          else if (minute > 90) addN(`🚨 STOPPAGE GOAL! ${ev.scorer} for ${TEAMS[ev.team].name}! ${ns.P}–${ns.A}`, 'goal')
          else addN(`⚽ GOAL! ${ev.scorer} (${TEAMS[ev.team].short})! ${ns.P}–${ns.A} ${minute}'`, 'goal')

          // FIX Bug 2: Settle 'next' market bets on every open-play goal immediately
          const goalTeam = ev.team
          const goalTs   = Date.now()
          setBets(prev => prev.map(b => {
            if (b.market !== 'next' || b.status !== 'active') return b
            if ((b.ts || 0) >= goalTs) return b // bet placed after this goal — skip
            const won = b.selection === goalTeam
            return _settleSingle(b, won)
          }))

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
  }, [recalcOdds, settleBets, _settleSingle])

  useEffect(() => {
    if (!isAdmin) return
    if (gs.status !== 'live' || gs.setpiece || gs.paused) return
    timerRef.current = setTimeout(advanceMinute, TICK_SPEED)
    return () => clearTimeout(timerRef.current)
  }, [isAdmin, gs.status, gs.minute, gs.setpiece, gs.paused, advanceMinute])

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
    setNotifs([mkN('⚽ KICK OFF! Portugal vs Argentina is underway!', 'system')])
  }, [recalcOdds])

  const adminPause = useCallback(() => {
    setGs(prev => {
      const next = { ...prev, paused: true,
        notifications: [{ id: Date.now(), msg: '⏸️ Match PAUSED.', type: 'system', ts: Date.now() }, ...(prev.notifications || [])] }
      pushMatchState(next); return next
    })
  }, [])

  const adminResume = useCallback(() => {
    setGs(prev => {
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
    initial.notifications = [{ id: Date.now(), msg: '🏟️ Match reset. Portugal vs Argentina. Waiting for kick off.', type: 'system', ts: Date.now() }]
    setGs(initial)
    setBets([])
    setBalance(INITIAL_BALANCE)
    setOdds(null)
    setBetSlip(null)
    setStakeInput('100')
    setNotifs([mkN('🏟️ Match reset. Portugal vs Argentina. Waiting for kick off.', 'system')])
    pushMatchState(initial)
    supabase.from('bets').delete().neq('id', 'none').then(() => {})
    supabase.from('leaderboard').delete().neq('user_id', 0).then(() => {})
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

  // FIX Bug 5: adminVoidMarket — update ALL users' bets in Supabase directly,
  // not just local state (local state only belongs to the currently logged-in user)
  const adminVoidMarket = useCallback((market) => {
    // Update Supabase for all users with active bets on this market
    supabase.from('bets')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('market', market)
      .eq('status', 'active')
      .then(({ error }) => { if (error) console.error('void update error:', error) })

    // Update local state + refund balance for the current user
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

  const adminResolveSetpiece = useCallback(() => {
    // CRITICAL FIX: processSetpiece calls setBets(_settleSingle) internally.
    // Calling setBets inside a setGs updater violates React rules — the inner
    // setState is silently dropped. Read gs via gsRef, run processSetpiece
    // outside the updater, then apply the result with setGs.
    const current = gsRef.current
    if (!current.setpiece) return
    const { newScore, newEvents, notifMsg, notifType } = processSetpiece(current.setpiece, current)
    const newNotifs = notifMsg
      ? [{ id: Date.now(), msg: notifMsg, type: notifType, ts: Date.now() }, ...(current.notifications || [])].slice(0, 80)
      : current.notifications || []
    const next = { ...current, score: newScore, events: newEvents, setpiece: null, notifications: newNotifs }
    recalcOdds(next)
    setGs(next)
    pushMatchState(next)
  }, [processSetpiece, recalcOdds])

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
      // FIX: stamp ts on admin-injected goals too
      const goalTs = Date.now()
      setGs(prev => {
        const key = team === 'portugal' ? 'P' : 'A'
        const newScore  = { ...prev.score, [key]: prev.score[key] + 1 }
        const newEvents = [...prev.events, { type: 'goal', team, scorer: ev.scorer || 'Open Play', ts: goalTs }]
        const msg = newScore.P === newScore.A && newScore.P + newScore.A > 0
          ? `🔥 EQUALIZER! ${ev.scorer || 'Open Play'} — ${newScore.P}–${newScore.A}!`
          : `⚽ GOAL! ${ev.scorer || 'Open Play'} (${TEAMS[team].short})! ${newScore.P}–${newScore.A} ${prev.minute}'`
        const next = { ...prev, score: newScore, events: newEvents,
          notifications: [{ id: Date.now(), msg, type: 'goal', ts: Date.now() }, ...(prev.notifications || [])] }
        recalcOdds(next); pushMatchState(next); return next
      })
      // FIX Bug 2: Settle 'next' market bets on admin-injected goals too
      setBets(prev => prev.map(b => {
        if (b.market !== 'next' || b.status !== 'active') return b
        if ((b.ts || 0) >= goalTs) return b
        const won = b.selection === team
        return _settleSingle(b, won)
      }))
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
  }, [recalcOdds, _settleSingle])

  // When match resets to prematch — clear local bets and balance for all clients
  useEffect(() => {
    if (gs.status !== 'prematch') return
    setBets([])
    setBalance(INITIAL_BALANCE)
  }, [gs.status])

  // FIX Bug 3: Save leaderboard after a delay so setBalance has flushed,
  // and use only settled (won+lost) bets for bets_count — not active/void
  useEffect(() => {
    if (gs.status !== 'finished' || !currentUser) return
    _saveLeaderboardDelayed()
  }, [gs.status, currentUser, _saveLeaderboardDelayed])

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
