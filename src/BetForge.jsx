import { useState, useEffect, useRef, useCallback } from 'react'
import { INITIAL_BALANCE } from './constants'
import {
  Scoreboard, NotifFeed, BetList, Markets, BetSlip,
  SetPieceOverlay, FinalResult,
} from './components'
import { supabase } from './supabase'

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body { background: #080d0a; color: #e8ffe8; font-family: 'JetBrains Mono', 'Courier New', monospace; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #0a0f0a; }
  ::-webkit-scrollbar-thumb { background: #1e3a1e; border-radius: 2px; }
  button { cursor: pointer; border: none; outline: none; font-family: inherit; }
  button:hover  { filter: brightness(1.1); }
  button:active { filter: brightness(0.95); }
  @keyframes slideIn { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes spIn    { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes goalFlash { 0%,100% { background: #080d0a; } 50% { background: #0d2a0d; } }
`

// ── Web Audio sound engine (no files needed) ──────────────────────────────────
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const master = ctx.createGain()
    master.connect(ctx.destination)

    if (type === 'goal') {
      // Triumphant ascending chime
      [523, 659, 784, 1047].forEach((freq, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(master)
        o.frequency.value = freq
        o.type = 'sine'
        g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
        g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.12 + 0.05)
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.12 + 0.3)
        o.start(ctx.currentTime + i * 0.12)
        o.stop(ctx.currentTime + i * 0.12 + 0.35)
      })
    } else if (type === 'penalty') {
      // Urgent alarm beeps
      [880, 880, 1100].forEach((freq, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(master)
        o.frequency.value = freq
        o.type = 'square'
        g.gain.setValueAtTime(0, ctx.currentTime + i * 0.2)
        g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.2 + 0.02)
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.2 + 0.15)
        o.start(ctx.currentTime + i * 0.2)
        o.stop(ctx.currentTime + i * 0.2 + 0.18)
      })
    } else if (type === 'corner' || type === 'freekick') {
      // Single attention tone
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(master)
      o.frequency.value = 660
      o.type = 'sine'
      g.gain.setValueAtTime(0.2, ctx.currentTime)
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4)
      o.start(ctx.currentTime)
      o.stop(ctx.currentTime + 0.45)
    } else if (type === 'bet') {
      // Soft click confirm
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(master)
      o.frequency.value = 440
      o.type = 'sine'
      g.gain.setValueAtTime(0.1, ctx.currentTime)
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1)
      o.start(ctx.currentTime)
      o.stop(ctx.currentTime + 0.12)
    } else if (type === 'warn') {
      // Market closing warning
      [330, 330].forEach((freq, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(master)
        o.frequency.value = freq
        o.type = 'triangle'
        g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.25)
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.25 + 0.2)
        o.start(ctx.currentTime + i * 0.25)
        o.stop(ctx.currentTime + i * 0.25 + 0.22)
      })
    }
    setTimeout(() => ctx.close(), 2000)
  } catch (e) {}
}

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'goal' ? '#0d2a0d' : t.type === 'warn' ? '#2a1a00' : '#0d200d',
          border: `1px solid ${t.type === 'goal' ? '#4eff91' : t.type === 'warn' ? '#ffaa00' : '#c8ff00'}`,
          borderRadius: 4, padding: '10px 16px', fontSize: 12, fontWeight: 700,
          color: t.type === 'goal' ? '#4eff91' : t.type === 'warn' ? '#ffaa00' : '#c8ff00',
          animation: 'slideUp 0.3s ease',
          maxWidth: 280, letterSpacing: 0.5,
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Live mini leaderboard ─────────────────────────────────────────────────────
function LiveLeaderboard({ show, onClose }) {
  const [lb, setLb] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    supabase.from('leaderboard').select('user_name,balance,pnl').order('balance', { ascending: false }).limit(10)
      .then(({ data }) => { setLb(data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [show])

  if (!show) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 6, padding: 24, width: 340, animation: 'spIn 0.2s ease' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#c8ff00', letterSpacing: 2 }}>🏆 LEADERBOARD</span>
          <button onClick={onClose} style={{ background: 'none', color: '#558855', fontSize: 16 }}>✕</button>
        </div>
        {loading && <div style={{ color: '#3a5a3a', fontSize: 11, textAlign: 'center', padding: 16 }}>Loading...</div>}
        {!loading && lb.length === 0 && <div style={{ color: '#3a5a3a', fontSize: 11, textAlign: 'center', padding: 16 }}>No data yet.</div>}
        {!loading && lb.map((e, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
          return (
            <div key={e.user_name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', marginBottom: 3, background: i % 2 === 0 ? '#0d1a0d' : '#0a150a', borderRadius: 3 }}>
              <span style={{ fontSize: 12, color: i < 3 ? '#c8ff00' : '#558855', fontWeight: 700, minWidth: 28 }}>{medal}</span>
              <span style={{ fontSize: 11, color: '#e8ffe8', flex: 1 }}>{e.user_name}</span>
              <span style={{ fontSize: 12, color: '#c8ff00', fontWeight: 700 }}>{e.balance?.toLocaleString()}</span>
              <span style={{ fontSize: 10, color: e.pnl >= 0 ? '#4eff91' : '#ff4e4e', marginLeft: 10, minWidth: 50, textAlign: 'right' }}>{e.pnl >= 0 ? '+' : ''}{e.pnl}</span>
            </div>
          )
        })}
        <div style={{ marginTop: 12, fontSize: 9, color: '#3a5a3a', textAlign: 'center' }}>Updates when players complete a match</div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BetForge({ currentUser, match, onLogout }) {
  const {
    gs, bets, balance, notifications, odds,
    betSlip, setBetSlip,
    stakeInput, setStakeInput,
    spTimer,
    placeBet, resetMatch,
  } = match

  const [toasts, setToasts]       = useState([])
  const [showLB, setShowLB]       = useState(false)
  const [flashGoal, setFlashGoal] = useState(false)
  const prevMinute                = useRef(gs.minute)
  const prevScore                 = useRef(gs.score)
  const prevNotifLen              = useRef(notifications.length)
  const toastId                   = useRef(0)

  const pnl = balance - INITIAL_BALANCE

  // ── Add toast ──────────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = 'info', duration = 3000) => {
    const id = toastId.current++
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  // ── Watch notifications for goal/penalty/freekick/corner sounds ────────────
  useEffect(() => {
    if (notifications.length <= prevNotifLen.current) { prevNotifLen.current = notifications.length; return }
    prevNotifLen.current = notifications.length
    const latest = notifications[0]
    if (!latest) return
    if (latest.type === 'goal') {
      playSound('goal')
      setFlashGoal(true)
      setTimeout(() => setFlashGoal(false), 1000)
      addToast(latest.msg, 'goal', 4000)
    } else if (latest.type === 'penalty') {
      playSound('penalty')
      addToast('🚨 PENALTY! Bet now!', 'warn', 5000)
    } else if (latest.type === 'freekick') {
      playSound('freekick')
      addToast('🎯 FREE KICK! Bet now!', 'warn', 5000)
    } else if (latest.type === 'corner') {
      playSound('corner')
      addToast('🚩 CORNER! Bet now!', 'warn', 5000)
    }
  }, [notifications.length, addToast])

  // ── Market close warnings at 5 min before closing ─────────────────────────
  useEffect(() => {
    if (gs.status !== 'live') return
    const warnings = [
      { at: 65, msg: '⚠️ Over/Under 2.5 closes in 5 minutes!' },
      { at: 70, msg: '⚠️ Both Teams To Score closes in 5 minutes!' },
      { at: 75, msg: '⚠️ Asian Handicap closes in 5 minutes!' },
      { at: 80, msg: '⚠️ Match Result closes in 5 minutes!' },
      { at: 83, msg: '⚠️ Next Goal market closes in 5 minutes!' },
    ]
    const w = warnings.find(w => w.at === gs.minute)
    if (w) { playSound('warn'); addToast(w.msg, 'warn', 6000) }
  }, [gs.minute, gs.status, addToast])

  // ── Wrap placeBet to add toast + sound on success ─────────────────────────
  const placeBetWithToast = useCallback((market, selection, oddsVal, maxOverride) => {
    const result = placeBet(market, selection, oddsVal, maxOverride)
    if (result !== false) {
      playSound('bet')
      addToast(`✅ ${parseInt(stakeInput) || 0} coins @ ${Number(oddsVal).toFixed(2)} — ${selection}`, 'bet', 2500)
    }
    return result
  }, [placeBet, stakeInput, addToast])

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: flashGoal ? '#0d2a0d' : '#080d0a', transition: 'background 0.3s' }}>

        {/* HEADER */}
        <header style={{ background: 'linear-gradient(90deg,#0d1f0d,#0a150a,#0d1f0d)', borderBottom: '1px solid #1a3a1a', padding: '0 20px', flexShrink: 0 }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2, color: '#c8ff00' }}>
                BET<span style={{ color: '#fff' }}>FORGE</span>
              </span>
              <StatusBadge status={gs.status} minute={gs.minute} paused={gs.paused} />
            </div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {currentUser && (
                <div style={{ textAlign: 'right', borderRight: '1px solid #1a3a1a', paddingRight: 20 }}>
                  <div style={{ fontSize: 9, color: '#3a5a3a', letterSpacing: 1 }}>PLAYER</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{currentUser.name.split(' ')[0]}</div>
                </div>
              )}
              <Stat label="BALANCE" value={`💰 ${balance.toLocaleString()}`} color="#c8ff00" />
              <Stat label="P&L" value={`${pnl >= 0 ? '+' : ''}${pnl}`} color={pnl > 0 ? '#4eff91' : pnl < 0 ? '#ff4e4e' : '#888'} />
              <Stat label="BETS" value={bets.length} color="#8aaa8a" />
              <button onClick={() => setShowLB(true)}
                style={{ background: '#0d200d', color: '#c8ff00', fontSize: 10, border: '1px solid #1a3a1a', padding: '4px 10px', borderRadius: 2, letterSpacing: 1 }}>
                🏆 LB
              </button>
              <button onClick={onLogout}
                style={{ background: 'none', color: '#3a5a3a', fontSize: 10, border: '1px solid #1a3a1a', padding: '4px 10px', borderRadius: 2, letterSpacing: 1 }}>
                EXIT
              </button>
            </div>
          </div>
        </header>

        {/* SCOREBOARD */}
        <Scoreboard gs={gs} odds={odds} onStart={null} />

        {/* PAUSED BANNER */}
        {gs.paused && gs.status === 'live' && (
          <div style={{ background: '#1a1a00', borderBottom: '1px solid #ffdd00', padding: '8px 20px', textAlign: 'center', fontSize: 12, color: '#ffdd00', fontWeight: 700, letterSpacing: 2 }}>
            ⏸ MATCH PAUSED BY ADMIN
          </div>
        )}

        {/* BODY */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr 260px', minHeight: 0 }}>
          <aside style={{ borderRight: '1px solid #1a3a1a', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <PanelHeader>LIVE FEED</PanelHeader>
            <NotifFeed notifications={notifications} />
          </aside>

          <main style={{ overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {gs.status === 'prematch' ? (
              <PreMatchBanner />
            ) : (
              <Markets gs={gs} odds={odds} onSelect={(market, sel, od) => setBetSlip({ market, selection: sel, odds: od })} />
            )}
            <BetSlip
              betSlip={betSlip}
              stakeInput={stakeInput}
              setStakeInput={setStakeInput}
              onPlace={placeBetWithToast}
              onClose={() => setBetSlip(null)}
            />
          </main>

          <aside style={{ borderLeft: '1px solid #1a3a1a', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <PanelHeader>MY BETS</PanelHeader>
            <BetList bets={bets} />
            <FinalResult gs={gs} balance={balance} bets={bets} onReset={resetMatch} />
          </aside>
        </div>
      </div>

      <SetPieceOverlay
        setpiece={gs.setpiece}
        spTimer={spTimer}
        stakeInput={stakeInput}
        setStakeInput={setStakeInput}
        onBet={placeBetWithToast}
      />

      <Toast toasts={toasts} />
      <LiveLeaderboard show={showLB} onClose={() => setShowLB(false)} />
    </>
  )
}

// ── MM:SS clock ───────────────────────────────────────────────────────────────
function StatusBadge({ status, minute, paused }) {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (status !== 'live' || paused) { setSecs(0); return }
    setSecs(0)
    const iv = setInterval(() => setSecs(s => (s >= 39 ? 0 : s + 1)), 1000)
    return () => clearInterval(iv)
  }, [status, minute, paused])

  const mm = String(minute).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')

  const map = {
    prematch: { label: 'PRE-MATCH', bg: '#222',    color: '#558855' },
    live:     { label: paused ? `⏸ ${mm}:${ss}` : `● ${mm}:${ss}`, bg: paused ? '#333' : '#c8ff00', color: paused ? '#ffdd00' : '#080d0a' },
    halftime: { label: 'HALF TIME', bg: '#555',    color: '#fff' },
    finished: { label: 'FULL TIME', bg: '#333',    color: '#888' },
  }
  const s = map[status] || map.prematch
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 2, letterSpacing: 1 }}>
      {s.label}
    </span>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 9, color: '#3a5a3a', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function PanelHeader({ children }) {
  return (
    <div style={{ padding: '9px 14px', borderBottom: '1px solid #1a3a1a', fontSize: 10, color: '#3a5a3a', fontWeight: 700, letterSpacing: 1.5, flexShrink: 0 }}>
      {children}
    </div>
  )
}

function PreMatchBanner() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#558855' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚽</div>
      <div style={{ fontSize: 18, color: '#c8ff00', marginBottom: 8, fontWeight: 700, letterSpacing: 2 }}>
        PORTUGAL vs ARGENTINA
      </div>
      <div style={{ fontSize: 11, color: '#3a5a3a', lineHeight: 2 }}>
        Waiting for admin to kick off...<br />
        6 live betting markets · Poisson match engine<br />
        Set piece overlays · Real-time odds
      </div>
    </div>
  )
}
