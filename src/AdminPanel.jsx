import { useState } from 'react'
import { TEAMS, ADMIN_PASSWORD } from './constants'
import { fmt } from './math'

const S = {
  panel: { fontFamily: "'JetBrains Mono','Courier New',monospace", background: '#060c06', minHeight: '100vh', color: '#e8ffe8', padding: 20 },
  h1:    { fontSize: 22, fontWeight: 700, color: '#c8ff00', letterSpacing: 3, marginBottom: 4 },
  sub:   { fontSize: 11, color: '#3a5a3a', letterSpacing: 1, marginBottom: 24 },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  card:  { background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 6, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle: { fontSize: 10, fontWeight: 700, color: '#c8ff00', letterSpacing: 2, marginBottom: 4, borderBottom: '1px solid #1a3a1a', paddingBottom: 8 },
  btn:   (color='#c8ff00') => ({
    background: color, color: color === '#c8ff00' ? '#060c06' : '#fff',
    fontFamily: 'inherit', fontWeight: 700, fontSize: 12, padding: '8px 14px',
    borderRadius: 3, border: 'none', cursor: 'pointer', letterSpacing: 1,
  }),
  btnRow:{ display: 'flex', gap: 8, flexWrap: 'wrap' },
  label: { fontSize: 10, color: '#3a5a3a', letterSpacing: 1, marginBottom: 4, display: 'block' },
  sel:   { background: '#0d200d', border: '1px solid #1a3a1a', color: '#e8ffe8', fontFamily: 'inherit', fontSize: 12, padding: '6px 10px', borderRadius: 3, outline: 'none', width: '100%' },
  inp:   { background: '#0d200d', border: '1px solid #1a3a1a', color: '#c8ff00', fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 3, outline: 'none', width: '100%' },
  row:   { display: 'flex', gap: 8, alignItems: 'flex-end' },
  tag:   (c='#4eff91') => ({ background: c+'22', color: c, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 2, letterSpacing: 1 }),
  log:   { fontSize: 11, color: '#4eff91', background: '#0d200d', border: '1px solid #1a3a1a', borderRadius: 3, padding: '8px 12px', maxHeight: 140, overflowY: 'auto' },
}

const MARKETS = ['match','ou','btts','ah','next','scorer','sp_penalty','sp_freekick','sp_corner']

export function AdminPanel({
  gs, bets,
  adminKickOff, adminPause, adminResume, adminEndMatch, adminReset,
  adminAddStoppage, adminVoidMarket, adminInjectEvent,
  onSwitchToPlayer,
}) {
  const [authed, setAuthed] = useState(false)
  const [pwd, setPwd]       = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [log, setLog]       = useState([])

  // Free kick state
  const [fkTeam, setFkTeam]         = useState('portugal')
  const [fkTaker, setFkTaker]       = useState('')
  const [fkDist, setFkDist]         = useState('25')
  const [fkDistType, setFkDistType] = useState('med')
  const [fkPos, setFkPos]           = useState('central')

  // Penalty state
  const [penTeam, setPenTeam]   = useState('portugal')
  const [penTaker, setPenTaker] = useState('')

  // Corner state
  const [corTeam, setCorTeam]   = useState('portugal')
  const [corTaker, setCorTaker] = useState('')

  // Goal state
  const [goalTeam, setGoalTeam]     = useState('portugal')
  const [goalScorer, setGoalScorer] = useState('')

  // Card state
  const [cardTeam, setCardTeam] = useState('portugal')

  // Stoppage
  const [stoppageMins, setStoppageMins] = useState('1')

  // Void market
  const [voidMarket, setVoidMarket] = useState('match')

  const addLog = (msg) => setLog(p => [`${new Date().toLocaleTimeString()} — ${msg}`, ...p].slice(0, 40))
  const act = (fn, msg) => { fn(); addLog(msg) }

  if (!authed) return (
    <div style={{ ...S.panel, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 6, padding: 40, width: 340 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#c8ff00', marginBottom: 4, letterSpacing: 2 }}>⚙️ ADMIN</div>
        <div style={{ fontSize: 11, color: '#3a5a3a', marginBottom: 24 }}>BetForge Control Panel</div>
        <label style={S.label}>PASSWORD</label>
        <input type="password" value={pwd} onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (pwd === ADMIN_PASSWORD ? (setAuthed(true), setPwdErr('')) : setPwdErr('Wrong password'))}
          style={{ ...S.inp, marginBottom: 12 }} placeholder="Enter admin password" />
        {pwdErr && <div style={{ color: '#ff5555', fontSize: 11, marginBottom: 10 }}>⚠️ {pwdErr}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn()} onClick={() => pwd === ADMIN_PASSWORD ? (setAuthed(true), setPwdErr('')) : setPwdErr('Wrong password')}>
            ENTER
          </button>
          {onSwitchToPlayer && (
            <button style={{ ...S.btn('#1a3a1a'), color: '#558855' }} onClick={onSwitchToPlayer}>
              VIEW GAME
            </button>
          )}
        </div>
      </div>
    </div>
  )

  const score    = gs.score
  const isLive   = gs.status === 'live'
  const isPaused = gs.paused

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={S.h1}>⚙️ BETFORGE ADMIN</div>
          <div style={S.sub}>CONTROL PANEL — Math engine calculates all outcomes</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Mini scoreboard */}
          <div style={{ background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 4, padding: '8px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#3a5a3a', marginBottom: 2 }}>
              {gs.status === 'prematch' ? 'PRE-MATCH'
                : gs.status === 'halftime' ? 'HALF TIME'
                : gs.status === 'finished' ? 'FULL TIME'
                : `${gs.minute}' ${isPaused ? '⏸' : '▶'}`}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#c8ff00', lineHeight: 1 }}>{score.P} – {score.A}</div>
            <div style={{ fontSize: 9, color: '#3a5a3a', marginTop: 2 }}>POR – ARG</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={S.tag(gs.status === 'live' ? (isPaused ? '#ffaa00' : '#4eff91') : gs.status === 'finished' ? '#666' : '#ffaa00')}>
              {gs.status.toUpperCase()}{isPaused ? ' ⏸' : ''}
            </span>
            <span style={S.tag('#88aaff')}>{bets.filter(b => b.status === 'active').length} ACTIVE BETS</span>
          </div>
          {onSwitchToPlayer && (
            <button style={{ ...S.btn('#1a3a1a'), color: '#558855' }} onClick={onSwitchToPlayer}>
              👁 VIEW GAME
            </button>
          )}
        </div>
      </div>

      <div style={S.grid}>

        {/* ── MATCH CONTROL ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>🎮 MATCH CONTROL</div>
          <div style={S.btnRow}>
            <button style={S.btn('#4eff91')} disabled={isLive || gs.status === 'finished'}
              onClick={() => act(adminKickOff, 'Kick off triggered')}>
              ⚽ KICK OFF
            </button>
            {isLive && !isPaused && (
              <button style={S.btn('#ffaa00')} onClick={() => act(adminPause, 'Match paused')}>
                ⏸ PAUSE
              </button>
            )}
            {isLive && isPaused && (
              <button style={S.btn('#4eff91')} onClick={() => act(adminResume, 'Match resumed')}>
                ▶ RESUME
              </button>
            )}
            <button style={S.btn('#ff5555')} disabled={gs.status === 'prematch' || gs.status === 'finished'}
              onClick={() => { if (window.confirm('End match now? This will settle all bets.')) act(adminEndMatch, 'Match ended by admin') }}>
              🛑 END MATCH
            </button>
          </div>

          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>ADD STOPPAGE TIME</label>
              <div style={S.row}>
                <select value={stoppageMins} onChange={e => setStoppageMins(e.target.value)} style={{ ...S.sel, width: 80 }}>
                  {[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}
                </select>
                <button style={S.btn('#88aaff')} onClick={() => act(() => adminAddStoppage(parseInt(stoppageMins)), `+${stoppageMins} min stoppage`)}>
                  +{stoppageMins} MIN
                </button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>VOID MARKET</label>
              <div style={S.row}>
                <select value={voidMarket} onChange={e => setVoidMarket(e.target.value)} style={S.sel}>
                  {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <button style={S.btn('#ff8800')} onClick={() => { if (window.confirm(`Void market: ${voidMarket}? Stakes refunded.`)) act(() => adminVoidMarket(voidMarket), `Voided ${voidMarket}`) }}>
                  VOID
                </button>
              </div>
            </div>
          </div>

          <button style={{ ...S.btn('#1a1a1a'), color: '#666', border: '1px solid #1a3a1a' }}
            onClick={() => { if (window.confirm('Full reset? Clears all bets and scores.')) act(adminReset, 'Full reset') }}>
            🔄 FULL RESET
          </button>
        </div>

        {/* ── FREE KICK ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>🎯 INJECT FREE KICK</div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>TEAM</label>
              <select value={fkTeam} onChange={e => { setFkTeam(e.target.value); setFkTaker('') }} style={S.sel}>
                <option value="portugal">Portugal</option>
                <option value="argentina">Argentina</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={S.label}>TAKER (optional)</label>
              <select value={fkTaker} onChange={e => setFkTaker(e.target.value)} style={S.sel}>
                <option value="">— Auto (weighted random) —</option>
                {TEAMS[fkTeam].players.freekick.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>DISTANCE (yds)</label>
              <input type="number" value={fkDist} min={10} max={40}
                onChange={e => {
                  setFkDist(e.target.value)
                  const n = parseInt(e.target.value)
                  setFkDistType(n < 18 ? 'short' : n < 28 ? 'med' : 'long')
                }}
                style={S.inp} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>TYPE</label>
              <select value={fkDistType} onChange={e => setFkDistType(e.target.value)} style={S.sel}>
                <option value="short">Short (&lt;18yd)</option>
                <option value="med">Medium (18–28)</option>
                <option value="long">Long (&gt;28yd)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>POSITION</label>
              <select value={fkPos} onChange={e => setFkPos(e.target.value)} style={S.sel}>
                <option value="central">Central</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>
            Engine calculates outcome from distance + position + taker stats. Market opens 30s for bets.
          </div>
          <button style={S.btn('#c8ff00')} onClick={() => {
            const taker = fkTaker ? TEAMS[fkTeam].players.freekick.find(p => p.name === fkTaker) : null
            act(() => adminInjectEvent({
              type: 'freekick', team: fkTeam,
              distType: fkDistType, distNum: parseInt(fkDist),
              position: fkPos, forcedTaker: taker,
            }), `FK: ${fkTeam} — ${fkTaker || 'auto'}, ${fkDist}yds ${fkPos}`)
          }}>
            🎯 TRIGGER FREE KICK
          </button>
        </div>

        {/* ── PENALTY ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>🚨 INJECT PENALTY</div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>TEAM</label>
              <select value={penTeam} onChange={e => { setPenTeam(e.target.value); setPenTaker('') }} style={S.sel}>
                <option value="portugal">Portugal</option>
                <option value="argentina">Argentina</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={S.label}>TAKER (optional)</label>
              <select value={penTaker} onChange={e => setPenTaker(e.target.value)} style={S.sel}>
                <option value="">— Auto (weighted random) —</option>
                {TEAMS[penTeam].players.penalty.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>
            Direction duel (taker vs GK dive) calculated by engine. Pressure mod applied if min ≥ 80. Market opens 20s.
          </div>
          <button style={S.btn('#ff4444')} onClick={() => {
            const taker = penTaker ? TEAMS[penTeam].players.penalty.find(p => p.name === penTaker) : null
            act(() => adminInjectEvent({ type: 'penalty', team: penTeam, forcedTaker: taker }),
              `Penalty: ${penTeam} — ${penTaker || 'auto'}`)
          }}>
            🚨 TRIGGER PENALTY
          </button>
        </div>

        {/* ── CORNER ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>🚩 INJECT CORNER</div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>TEAM</label>
              <select value={corTeam} onChange={e => { setCorTeam(e.target.value); setCorTaker('') }} style={S.sel}>
                <option value="portugal">Portugal</option>
                <option value="argentina">Argentina</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={S.label}>TAKER (optional)</label>
              <select value={corTaker} onChange={e => setCorTaker(e.target.value)} style={S.sel}>
                <option value="">— Auto (weighted random) —</option>
                {TEAMS[corTeam].players.corner.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>
            Delivery type (inswinger/outswinger/short) + outcome from taker bonus stats. Market opens 25s.
          </div>
          <button style={S.btn('#aa44ff')} onClick={() => {
            const taker = corTaker ? TEAMS[corTeam].players.corner.find(p => p.name === corTaker) : null
            act(() => adminInjectEvent({ type: 'corner', team: corTeam, forcedTaker: taker }),
              `Corner: ${corTeam} — ${corTaker || 'auto'}`)
          }}>
            🚩 TRIGGER CORNER
          </button>
        </div>

        {/* ── DIRECT GOAL ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>⚽ INJECT GOAL (OPEN PLAY)</div>
          <div style={{ fontSize: 10, color: '#ffaa00', marginBottom: 4 }}>
            ⚠️ Skips set piece overlay. Scores immediately. Use for open-play goals or live match tracking.
          </div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>TEAM</label>
              <select value={goalTeam} onChange={e => { setGoalTeam(e.target.value); setGoalScorer('') }} style={S.sel}>
                <option value="portugal">Portugal</option>
                <option value="argentina">Argentina</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={S.label}>SCORER (optional)</label>
              <select value={goalScorer} onChange={e => setGoalScorer(e.target.value)} style={S.sel}>
                <option value="">— Unknown / Open Play —</option>
                {TEAMS[goalTeam].players.goalScorers.filter(p => p.name !== 'Other').map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button style={S.btn('#4eff91')} onClick={() =>
            act(() => adminInjectEvent({ type: 'goal', team: goalTeam, scorer: goalScorer || 'Open Play' }),
              `Goal: ${goalTeam} — ${goalScorer || 'open play'}`)
          }>
            ⚽ INJECT GOAL
          </button>
        </div>

        {/* ── CARDS ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>🟨🔴 INJECT CARD</div>
          <div>
            <label style={S.label}>TEAM</label>
            <select value={cardTeam} onChange={e => setCardTeam(e.target.value)} style={S.sel}>
              <option value="portugal">Portugal</option>
              <option value="argentina">Argentina</option>
            </select>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>
            Red card permanently reduces team's goal rate λ by 35% for remaining match. Odds recalculate immediately.
          </div>
          <div style={S.btnRow}>
            <button style={S.btn('#ffdd00')} onClick={() =>
              act(() => adminInjectEvent({ type: 'yellow', team: cardTeam }), `Yellow: ${cardTeam}`)}>
              🟨 YELLOW CARD
            </button>
            <button style={S.btn('#ff3333')} onClick={() =>
              act(() => adminInjectEvent({ type: 'redcard', team: cardTeam }), `Red card: ${cardTeam}`)}>
              🔴 RED CARD
            </button>
          </div>
        </div>

        {/* ── LIVE STATS ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>📊 LIVE MATCH STATS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['Minute',      gs.minute + "'"],
              ['Phase',       gs.phase || '—'],
              ['Score',       `${score.P} – ${score.A}`],
              ['Status',      gs.status + (gs.paused ? ' ⏸' : '')],
              ['λ Portugal',  ((gs.lambdaP || 0) * 90).toFixed(2) + ' xG/90'],
              ['λ Argentina', ((gs.lambdaA || 0) * 90).toFixed(2) + ' xG/90'],
              ['🔴 POR',      gs.redCards?.portugal || 0],
              ['🔴 ARG',      gs.redCards?.argentina || 0],
              ['🟨 POR',      gs.yellowCards?.portugal || 0],
              ['🟨 ARG',      gs.yellowCards?.argentina || 0],
              ['Stop 1st',    `+${gs.halfStoppage?.first || 0}'`],
              ['Stop 2nd',    `+${gs.halfStoppage?.second || 0}'`],
              ['Active Bets', bets.filter(b => b.status === 'active').length],
              ['Total Bets',  bets.length],
            ].map(([k, v]) => (
              <div key={k} style={{ background: '#0d1f0d', padding: '6px 10px', borderRadius: 3 }}>
                <div style={{ fontSize: 9, color: '#3a5a3a' }}>{k}</div>
                <div style={{ fontSize: 13, color: '#c8ff00', fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ACTION LOG ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>📋 ADMIN ACTION LOG</div>
          <div style={S.log}>
            {log.length === 0 && <span style={{ color: '#3a5a3a' }}>No actions yet.</span>}
            {log.map((l, i) => <div key={i} style={{ marginBottom: 3 }}>{l}</div>)}
          </div>
          <button style={{ ...S.btn('#1a1a1a'), color: '#558855', border: '1px solid #1a3a1a', fontSize: 10 }}
            onClick={() => setLog([])}>
            CLEAR LOG
          </button>
        </div>

      </div>
    </div>
  )
}
