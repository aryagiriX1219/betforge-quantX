import { INITIAL_BALANCE } from './constants'
import {
  Scoreboard, NotifFeed, BetList, Markets, BetSlip,
  SetPieceOverlay, FinalResult,
} from './components'

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
  @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes spIn    { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`

export default function BetForge({ currentUser, match, onLogout, onAdmin }) {
  const {
    gs, bets, balance, notifications, odds,
    betSlip, setBetSlip,
    stakeInput, setStakeInput,
    spTimer,
    placeBet, resetMatch,
  } = match

  const pnl = balance - INITIAL_BALANCE

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#080d0a' }}>

        {/* HEADER */}
        <header style={{ background: 'linear-gradient(90deg,#0d1f0d,#0a150a,#0d1f0d)', borderBottom: '1px solid #1a3a1a', padding: '0 20px', flexShrink: 0 }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2, color: '#c8ff00' }}>
                BET<span style={{ color: '#fff' }}>FORGE</span>
              </span>
              <StatusBadge status={gs.status} minute={gs.minute} paused={gs.paused} />
            </div>
            <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
              {currentUser && (
                <div style={{ textAlign: 'right', borderRight: '1px solid #1a3a1a', paddingRight: 28 }}>
                  <div style={{ fontSize: 9, color: '#3a5a3a', letterSpacing: 1 }}>PLAYER</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{currentUser.name.split(' ')[0]}</div>
                </div>
              )}
              <Stat label="BALANCE" value={`💰 ${balance.toLocaleString()}`} color="#c8ff00" />
              <Stat label="P&L" value={`${pnl >= 0 ? '+' : ''}${pnl}`} color={pnl > 0 ? '#4eff91' : pnl < 0 ? '#ff4e4e' : '#888'} />
              <Stat label="BETS" value={bets.length} color="#8aaa8a" />
              <button onClick={onLogout} style={{ background: 'none', color: '#3a5a3a', fontSize: 10, border: '1px solid #1a3a1a', padding: '4px 10px', borderRadius: 2, letterSpacing: 1 }}>EXIT</button>
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
              onPlace={placeBet}
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
        onBet={placeBet}
      />
    </>
  )
}

function StatusBadge({ status, minute, paused }) {
  const map = {
    prematch: { label: 'PRE-MATCH', bg: '#222', color: '#558855' },
    live:     { label: paused ? `⏸ ${minute}'` : `● ${minute}'`, bg: paused ? '#333' : '#c8ff00', color: paused ? '#ffdd00' : '#080d0a' },
    halftime: { label: 'HT', bg: '#555', color: '#fff' },
    finished: { label: 'FT', bg: '#333', color: '#888' },
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
