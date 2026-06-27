import { useState, useEffect, useRef } from 'react'
import { TEAMS, ADMIN_PASSWORD } from './constants'
import { fmt } from './math'
import { supabase } from './supabase'

const INITIAL_BALANCE = 1000

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
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  label:  { fontSize: 10, color: '#3a5a3a', letterSpacing: 1, marginBottom: 4, display: 'block' },
  sel:    { background: '#0d200d', border: '1px solid #1a3a1a', color: '#e8ffe8', fontFamily: 'inherit', fontSize: 12, padding: '6px 10px', borderRadius: 3, outline: 'none', width: '100%' },
  inp:    { background: '#0d200d', border: '1px solid #1a3a1a', color: '#c8ff00', fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 3, outline: 'none', width: '100%' },
  row:    { display: 'flex', gap: 8, alignItems: 'flex-end' },
  tag:    (c='#4eff91') => ({ background: c+'22', color: c, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 2, letterSpacing: 1 }),
  log:    { fontSize: 11, color: '#4eff91', background: '#0d200d', border: '1px solid #1a3a1a', borderRadius: 3, padding: '8px 12px', maxHeight: 140, overflowY: 'auto' },
  th:     { padding: '7px 10px', textAlign: 'left', color: '#3a5a3a', fontSize: 9, letterSpacing: 1, borderBottom: '1px solid #1a3a1a' },
  td:     { padding: '7px 10px', fontSize: 11 },
}

const MARKETS = ['match','ou','btts','ah','next','scorer','sp_penalty','sp_freekick','sp_corner']

export function AdminPanel({
  gs, bets,
  adminKickOff, adminPause, adminResume, adminEndMatch, adminReset,
  adminAddStoppage, adminVoidMarket, adminInjectEvent, adminResolveSetpiece,
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

  // Stoppage / void
  const [stoppageMins, setStoppageMins] = useState('1')
  const [voidMarket, setVoidMarket]     = useState('match')

  // Leaderboard state
  const [lb, setLb]           = useState([])
  const [lbLoading, setLbLoading] = useState(false)
  const [lbDetail, setLbDetail]   = useState(null)

  const addLog = (msg) => setLog(p => [`${new Date().toLocaleTimeString()} — ${msg}`, ...p].slice(0, 40))
  const act = (fn, msg) => { fn(); addLog(msg) }

  // ── Load leaderboard from Supabase ──────────────────────────────────────
  const loadLB = async () => {
    setLbLoading(true)
    try {
      const { data: lbData }   = await supabase.from('leaderboard').select('*').order('balance', { ascending: false })
      const { data: betsData } = await supabase.from('bets').select('*').order('updated_at', { ascending: false })
      const enriched = (lbData || []).map((row, i) => ({
        ...row,
        rank: i + 1,
        bets: (betsData || []).filter(b => String(b.user_id) === String(row.user_id)),
      }))
      setLb(enriched)
    } catch (e) { console.error(e) }
    setLbLoading(false)
  }

  // ── Auto-load leaderboard on mount + refresh every 10s during match ────────
  const intervalRef = useRef(null)
  useEffect(() => {
    if (!authed) return
    loadLB() // load immediately when admin panel opens
    intervalRef.current = setInterval(loadLB, 10000) // refresh every 10s
    return () => clearInterval(intervalRef.current)
  }, [authed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Export summary CSV ───────────────────────────────────────────────────
  const exportSummaryCSV = () => {
    if (!lb.length) return
    const rows = [['Rank','Name','Balance','P&L','Total Bets','Won','Lost','Active','Best Return (coins)']]
    lb.forEach(e => {
      const won    = e.bets.filter(b => b.status === 'won').length
      const lost   = e.bets.filter(b => b.status === 'lost').length
      const active = e.bets.filter(b => b.status === 'active').length
      const best   = e.bets.filter(b => b.status === 'won').reduce((m, b) => Math.max(m, b.stake * b.odds), 0)
      rows.push([e.rank, e.user_name, e.balance, e.pnl >= 0 ? `+${e.pnl}` : e.pnl, e.bets_count, won, lost, active, best.toFixed(0)])
    })
    downloadCSV(rows, 'betforge_leaderboard.csv')
  }

  // ── Export all bets CSV ──────────────────────────────────────────────────
  const exportAllBetsCSV = () => {
    if (!lb.length) return
    const rows = [['Rank','Name','Market','Selection','Stake','Odds','Potential','Status','Return']]
    lb.forEach(e => e.bets.forEach(b => {
      const ret = b.status === 'won' ? `+${(b.stake * b.odds).toFixed(0)}` : b.status === 'lost' ? `-${b.stake}` : '0'
      rows.push([e.rank, e.user_name, b.market, b.selection, b.stake, Number(b.odds).toFixed(2), (b.stake * b.odds).toFixed(0), b.status, ret])
    }))
    downloadCSV(rows, 'betforge_all_bets.csv')
  }

  const downloadCSV = (rows, filename) => {
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = filename; a.click()
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
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
            <button style={{ ...S.btn('#1a3a1a'), color: '#558855' }} onClick={onSwitchToPlayer}>VIEW GAME</button>
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
      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={S.h1}>⚙️ BETFORGE ADMIN</div>
          <div style={S.sub}>CONTROL PANEL — Math engine calculates all outcomes</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 4, padding: '8px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#3a5a3a', marginBottom: 2 }}>
              {gs.status === 'prematch' ? 'PRE-MATCH' : gs.status === 'halftime' ? 'HALF TIME' : gs.status === 'finished' ? 'FULL TIME' : `${gs.minute}' ${isPaused ? '⏸' : '▶'}`}
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
            <button style={{ ...S.btn('#1a3a1a'), color: '#558855' }} onClick={onSwitchToPlayer}>👁 VIEW GAME</button>
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
              <button style={S.btn('#ffaa00')} onClick={() => act(adminPause, 'Match paused')}>⏸ PAUSE</button>
            )}
            {isLive && isPaused && (
              <button style={S.btn('#4eff91')} onClick={() => act(adminResume, 'Match resumed')}>▶ RESUME</button>
            )}
            {gs.status === 'halftime' && (
              <button style={S.btn('#4eff91')} onClick={() => act(adminResume, 'Second half started')}>▶ START 2ND HALF</button>
            )}
            {gs.setpiece && adminResolveSetpiece && (
              <button style={{ ...S.btn('#c8ff00') }}
                onClick={() => act(adminResolveSetpiece, `Resolved ${gs.setpiece.type}`)}>
                ⚡ RESOLVE {gs.setpiece?.type?.toUpperCase()}
              </button>
            )}
            <button style={S.btn('#ff5555')} disabled={gs.status === 'prematch' || gs.status === 'finished'}
              onClick={() => { if (window.confirm('End match now? This will settle all bets.')) act(adminEndMatch, 'Match ended') }}>
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
                {TEAMS[fkTeam].players.freekick.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>DISTANCE (yds)</label>
              <input type="number" value={fkDist} min={10} max={40}
                onChange={e => { setFkDist(e.target.value); const n = parseInt(e.target.value); setFkDistType(n < 18 ? 'short' : n < 28 ? 'med' : 'long') }}
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
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>Engine calculates outcome from distance + position + taker stats. Market opens 30s.</div>
          <button style={S.btn('#c8ff00')} onClick={() => {
            const taker = fkTaker ? TEAMS[fkTeam].players.freekick.find(p => p.name === fkTaker) : null
            act(() => adminInjectEvent({ type: 'freekick', team: fkTeam, distType: fkDistType, distNum: parseInt(fkDist), position: fkPos, forcedTaker: taker }),
              `FK: ${fkTeam} — ${fkTaker || 'auto'}, ${fkDist}yds ${fkPos}`)
          }}>🎯 TRIGGER FREE KICK</button>
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
                {TEAMS[penTeam].players.penalty.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>Direction duel (taker vs GK dive) calculated by engine. Pressure mod if min ≥ 80. Market opens 20s.</div>
          <button style={S.btn('#ff4444')} onClick={() => {
            const taker = penTaker ? TEAMS[penTeam].players.penalty.find(p => p.name === penTaker) : null
            act(() => adminInjectEvent({ type: 'penalty', team: penTeam, forcedTaker: taker }), `Penalty: ${penTeam} — ${penTaker || 'auto'}`)
          }}>🚨 TRIGGER PENALTY</button>
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
                {TEAMS[corTeam].players.corner.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>Delivery type + outcome from taker bonus stats. Market opens 25s.</div>
          <button style={S.btn('#aa44ff')} onClick={() => {
            const taker = corTaker ? TEAMS[corTeam].players.corner.find(p => p.name === corTaker) : null
            act(() => adminInjectEvent({ type: 'corner', team: corTeam, forcedTaker: taker }), `Corner: ${corTeam} — ${corTaker || 'auto'}`)
          }}>🚩 TRIGGER CORNER</button>
        </div>

        {/* ── DIRECT GOAL ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>⚽ INJECT GOAL (OPEN PLAY)</div>
          <div style={{ fontSize: 10, color: '#ffaa00', marginBottom: 4 }}>⚠️ Skips set piece overlay. Scores immediately.</div>
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
                {TEAMS[goalTeam].players.goalScorers.filter(p => p.name !== 'Other').map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <button style={S.btn('#4eff91')} onClick={() =>
            act(() => adminInjectEvent({ type: 'goal', team: goalTeam, scorer: goalScorer || 'Open Play' }), `Goal: ${goalTeam} — ${goalScorer || 'open play'}`)
          }>⚽ INJECT GOAL</button>
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
          <div style={{ fontSize: 10, color: '#3a5a3a' }}>Red card permanently reduces team λ by 35%. Odds recalculate immediately.</div>
          <div style={S.btnRow}>
            <button style={S.btn('#ffdd00')} onClick={() => act(() => adminInjectEvent({ type: 'yellow', team: cardTeam }), `Yellow: ${cardTeam}`)}>
              🟨 YELLOW CARD
            </button>
            <button style={S.btn('#ff3333')} onClick={() => act(() => adminInjectEvent({ type: 'redcard', team: cardTeam }), `Red card: ${cardTeam}`)}>
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
          <button style={{ ...S.btn('#1a1a1a'), color: '#558855', border: '1px solid #1a3a1a', fontSize: 10 }} onClick={() => setLog([])}>
            CLEAR LOG
          </button>
        </div>

        {/* ── LEADERBOARD ── */}
        <div style={{ ...S.card, gridColumn: '1 / -1' }}>
          <div style={S.cardTitle}>🏆 LIVE LEADERBOARD & PARTICIPANT STATS</div>
          <div style={S.btnRow}>
            <button onClick={loadLB} style={S.btn('#4eff91')}>
              {lbLoading ? '⏳ LOADING...' : '↻ REFRESH LEADERBOARD'}
            </button>
            <button onClick={exportSummaryCSV} disabled={!lb.length}
              style={{ ...S.btn('#c8ff00'), opacity: lb.length ? 1 : 0.4 }}>
              ↓ SUMMARY CSV
            </button>
            <button onClick={exportAllBetsCSV} disabled={!lb.length}
              style={{ ...S.btn('#88aaff'), opacity: lb.length ? 1 : 0.4 }}>
              ↓ ALL BETS CSV
            </button>
            {lb.length > 0 && (
              <span style={S.tag('#4eff91')}>{lb.length} PARTICIPANTS</span>
            )}
          </div>

          {lb.length === 0 && !lbLoading && (
            <div style={{ fontSize: 11, color: '#3a5a3a', padding: '12px 0' }}>
              No participants yet. Leaderboard updates every 10s automatically.
            </div>
          )}

          {lb.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0d200d' }}>
                    {['RANK','NAME','BALANCE','P&L','TOTAL BETS','WON','LOST','ACTIVE','BEST RETURN','DETAIL'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lb.map((e, i) => {
                    const won    = e.bets.filter(b => b.status === 'won').length
                    const lost   = e.bets.filter(b => b.status === 'lost').length
                    const active = e.bets.filter(b => b.status === 'active').length
                    const best   = e.bets.filter(b => b.status === 'won').reduce((m, b) => Math.max(m, b.stake * b.odds), 0)
                    const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`
                    const isOpen = lbDetail?.user_id === e.user_id
                    return (
                      <>
                        <tr key={e.user_id} style={{ background: i % 2 === 0 ? '#0a150a' : '#0d1a0d', borderBottom: '1px solid #1a2a1a' }}>
                          <td style={{ ...S.td, color: i < 3 ? '#c8ff00' : '#558855', fontWeight: 700 }}>{medal}</td>
                          <td style={{ ...S.td, color: '#e8ffe8', fontWeight: 600 }}>{e.user_name}</td>
                          <td style={{ ...S.td, color: '#c8ff00', fontWeight: 700 }}>{e.balance.toLocaleString()}</td>
                          <td style={{ ...S.td, color: e.pnl >= 0 ? '#4eff91' : '#ff4e4e', fontWeight: 700 }}>{e.pnl >= 0 ? '+' : ''}{e.pnl}</td>
                          <td style={{ ...S.td, color: '#888' }}>{e.bets_count}</td>
                          <td style={{ ...S.td, color: '#4eff91' }}>{won}</td>
                          <td style={{ ...S.td, color: '#ff4e4e' }}>{lost}</td>
                          <td style={{ ...S.td, color: '#ffaa00' }}>{active}</td>
                          <td style={{ ...S.td, color: '#c8ff00' }}>{best > 0 ? Math.round(best).toLocaleString() : '—'}</td>
                          <td style={S.td}>
                            <button onClick={() => setLbDetail(isOpen ? null : e)}
                              style={{ ...S.btn(isOpen ? '#1a3a1a' : '#0d2a0d'), color: isOpen ? '#c8ff00' : '#558855', fontSize: 9, padding: '3px 10px' }}>
                              {isOpen ? 'HIDE ▲' : 'BETS ▼'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${e.user_id}_detail`}>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <div style={{ padding: '10px 16px', background: '#070f07', borderBottom: '2px solid #1e3e1e' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#c8ff00', marginBottom: 8, letterSpacing: 1 }}>
                                  📋 {e.user_name} — FULL BET HISTORY ({e.bets.length} bets)
                                </div>
                                {e.bets.length === 0 ? (
                                  <div style={{ fontSize: 10, color: '#3a5a3a' }}>No bets placed yet.</div>
                                ) : (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                    <thead>
                                      <tr>
                                        {['MARKET','SELECTION','STAKE','ODDS','POTENTIAL','STATUS','RETURN'].map(h => (
                                          <th key={h} style={{ ...S.th, fontSize: 9 }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {e.bets.map((b, bi) => {
                                        const ret = b.status === 'won'
                                          ? `+${Math.round(b.stake * b.odds).toLocaleString()}`
                                          : b.status === 'lost' ? `-${b.stake}` : '—'
                                        return (
                                          <tr key={bi} style={{ background: b.status === 'won' ? '#0d2a0d' : b.status === 'lost' ? '#1a0808' : '#0d150d', borderBottom: '1px solid #1a2a1a' }}>
                                            <td style={{ padding: '5px 8px', color: '#888' }}>{b.market}</td>
                                            <td style={{ padding: '5px 8px', color: '#e8ffe8' }}>{b.selection}</td>
                                            <td style={{ padding: '5px 8px', color: '#888' }}>{b.stake}</td>
                                            <td style={{ padding: '5px 8px', color: '#c8ff00' }}>{Number(b.odds).toFixed(2)}</td>
                                            <td style={{ padding: '5px 8px', color: '#558855' }}>{Math.round(b.stake * b.odds)}</td>
                                            <td style={{ padding: '5px 8px', color: b.status === 'won' ? '#4eff91' : b.status === 'lost' ? '#ff4e4e' : b.status === 'active' ? '#ffaa00' : '#888', fontWeight: 700 }}>
                                              {b.status.toUpperCase()}
                                            </td>
                                            <td style={{ padding: '5px 8px', color: b.status === 'won' ? '#4eff91' : b.status === 'lost' ? '#ff4e4e' : '#888', fontWeight: 700 }}>
                                              {ret}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
