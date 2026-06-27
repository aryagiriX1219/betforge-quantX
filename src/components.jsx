import React, { useState, useEffect } from 'react'
import { fmt } from './math'
import { TEAMS, SCORER_MARKET, INITIAL_BALANCE } from './constants'

// ─── MARKET CARD ──────────────────────────────────────────────────────────────

export function MarketCard({ title, subtitle, closed, children }) {
  return (
    <div style={{
      background: '#0a150a',
      border: `1px solid ${closed ? '#1a2a1a' : '#1e3e1e'}`,
      borderRadius: 4,
      overflow: 'hidden',
      opacity: closed ? 0.5 : 1,
      transition: 'opacity 0.3s',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1a3a1a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#0d1f0d',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#c8ff00', letterSpacing: 1.5 }}>{title}</span>
        <span style={{ fontSize: 9, color: closed ? '#ff5555' : '#558855', letterSpacing: 0.5 }}>
          {closed ? '🔒 CLOSED' : subtitle}
        </span>
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </div>
  )
}

// ─── BET OPTION ───────────────────────────────────────────────────────────────

export function BetOption({ label, odds, market, selection, onSelect, small, disabled }) {
  if (disabled) return null
  return (
    <button
      onClick={() => onSelect(market, selection, odds)}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#0d1f0d',
        border: '1px solid #1a3a1a',
        borderRadius: 2,
        padding: small ? '5px 8px' : '7px 10px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8ff00'; e.currentTarget.style.background = '#112211' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a3a1a'; e.currentTarget.style.background = '#0d1f0d' }}
    >
      <span style={{ fontSize: small ? 10 : 11, color: '#8aaa8a' }}>{label}</span>
      <span style={{ fontSize: small ? 12 : 14, fontWeight: 700, color: '#c8ff00' }}>{fmt(odds)}</span>
    </button>
  )
}

// ─── NOTIFICATION FEED ────────────────────────────────────────────────────────

const notifColors = {
  goal:    { bg: '#0d2a0d', border: '#4eff91', text: '#a0ffb0' },
  save:    { bg: '#0a1a2a', border: '#44aaff', text: '#88bbff' },
  post:    { bg: '#1a1a0a', border: '#ffdd44', text: '#ffee88' },
  miss:    { bg: '#1a0a0a', border: '#ff5555', text: '#ff9999' },
  penalty: { bg: '#2a0d0d', border: '#ff4444', text: '#ffaaaa' },
  freekick:{ bg: '#0d1a2a', border: '#4499ff', text: '#88bbff' },
  corner:  { bg: '#1a0d2a', border: '#aa44ff', text: '#cc88ff' },
  card:    { bg: '#1a1a0a', border: '#ffdd00', text: '#ffee66' },
  system:  { bg: '#0d1a0d', border: '#448844', text: '#88bb88' },
  warn:    { bg: '#2a1a0a', border: '#ff8800', text: '#ffbb44' },
  tick:    { bg: '#0d150d', border: '#1a3a1a', text: '#5a7a5a' },
}

export function NotifFeed({ notifications }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
      {notifications.map(n => {
        const c = notifColors[n.type] || notifColors.tick
        return (
          <div key={n.id} style={{
            padding: '7px 10px',
            marginBottom: 4,
            borderRadius: 2,
            fontSize: 11,
            lineHeight: 1.5,
            background: c.bg,
            borderLeft: `2px solid ${c.border}`,
            color: c.text,
            animation: 'slideIn 0.25s ease',
          }}>
            {n.msg}
          </div>
        )
      })}
    </div>
  )
}

// ─── BET LIST (right panel) ───────────────────────────────────────────────────

export function BetList({ bets }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
      {bets.length === 0 && (
        <div style={{ padding: 20, color: '#2a4a2a', fontSize: 11, textAlign: 'center' }}>
          No bets placed yet.<br />
          <span style={{ fontSize: 10, color: '#1a3a1a' }}>Click any odds to open bet slip.</span>
        </div>
      )}
      {[...bets].reverse().map(b => (
        <div key={b.id} style={{
          padding: '8px 10px',
          marginBottom: 4,
          borderRadius: 2,
          fontSize: 11,
          background: b.status === 'won' ? '#0d2a0d' : b.status === 'lost' ? '#1a0a0a' : '#0d150d',
          borderLeft: `2px solid ${b.status === 'won' ? '#4eff91' : b.status === 'lost' ? '#ff4444' : '#c8ff00'}`,
        }}>
          <div style={{ color: '#8aaa8a', marginBottom: 3, fontSize: 10 }}>{b.label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#558855' }}>
              {b.stake} @ <span style={{ color: '#c8ff00' }}>{fmt(b.odds)}</span>
            </span>
            <span style={{
              color: b.status === 'won' ? '#4eff91' : b.status === 'lost' ? '#ff4444' : '#888',
              fontWeight: 700,
            }}>
              {b.status === 'won'  ? `+${fmt(b.stake * b.odds)}` :
               b.status === 'lost' ? `-${b.stake}` : '● LIVE'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── SCOREBOARD ───────────────────────────────────────────────────────────────

export function Scoreboard({ gs, odds, onStart }) {
  const pWin  = odds?.match?.pWin  || 0
  const pDraw = odds?.match?.pDraw || 0

  const statusLabel = {
    prematch:  'PRE-MATCH',
    live:      `${gs.minute}'`,
    halftime:  'HALF TIME',
    finished:  'FULL TIME',
  }[gs.status]

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0d200d 0%, #081408 100%)',
      borderBottom: '1px solid #1a3a1a',
      padding: '16px 20px',
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center' }}>
        {/* Portugal */}
        <TeamInfo team={TEAMS.portugal} side="left" />

        {/* Score */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Score n={gs.score.P} />
            <span style={{ fontSize: 24, color: '#2a4a2a' }}>–</span>
            <Score n={gs.score.A} />
          </div>
          <div style={{
            fontSize: gs.status === 'live' ? 14 : 11,
            color: gs.status === 'live' ? '#4eff91' : '#558855',
            letterSpacing: 1,
            fontWeight: gs.status === 'live' ? 700 : 400,
          }}>
            {statusLabel}
          </div>
          {gs.status === 'prematch' && (
            <button
              onClick={onStart}
              style={{
                marginTop: 4,
                background: '#c8ff00',
                color: '#080d0a',
                fontFamily: 'inherit',
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 28px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                letterSpacing: 1,
              }}
            >
              ▶ KICK OFF
            </button>
          )}
        </div>

        {/* Argentina */}
        <TeamInfo team={TEAMS.argentina} side="right" />
      </div>

      {/* Win probability bar */}
      {odds && gs.status !== 'prematch' && (
        <>
          <div style={{ maxWidth: 1400, margin: '10px auto 0', display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 2 }}>
            <div style={{ background: '#006600', width: `${(pWin  * 100).toFixed(0)}%`, transition: 'width 0.6s ease' }} />
            <div style={{ background: '#444',    width: `${(pDraw * 100).toFixed(0)}%`, transition: 'width 0.6s ease' }} />
            <div style={{ background: '#74ACDF', flex: 1, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ maxWidth: 1400, margin: '4px auto 0', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#3a5a3a', letterSpacing: 0.5 }}>
            <span>POR {(pWin  * 100).toFixed(0)}%</span>
            <span>DRAW {(pDraw * 100).toFixed(0)}%</span>
            <span>ARG {((1 - pWin - pDraw) * 100).toFixed(0)}%</span>
          </div>
        </>
      )}
    </div>
  )
}

function TeamInfo({ team, side }) {
  const isRight = side === 'right'
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      flexDirection: isRight ? 'row-reverse' : 'row',
    }}>
      <div style={{
        width: 44, height: 44,
        background: team.color,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        flexShrink: 0,
      }}>
        {team.flag}
      </div>
      <div style={{ textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{team.name.toUpperCase()}</div>
        <div style={{ fontSize: 9, color: '#3a5a3a', letterSpacing: 0.5 }}>
          {side === 'left' ? `HOME · STR ${team.strength} × ${team.homeAdv}` : `AWAY · STR ${team.strength}`}
        </div>
      </div>
    </div>
  )
}

function Score({ n }) {
  return (
    <span style={{
      fontSize: 48,
      fontWeight: 700,
      color: '#c8ff00',
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums',
      textShadow: '0 0 30px #c8ff0055',
    }}>
      {n}
    </span>
  )
}

// ─── BET SLIP ─────────────────────────────────────────────────────────────────

export function BetSlip({ betSlip, stakeInput, setStakeInput, onPlace, onClose }) {
  if (!betSlip) return null
  const stake      = parseInt(stakeInput) || 0
  const potReturn  = stake * betSlip.odds

  return (
    <div style={{
      position: 'sticky',
      bottom: 0,
      background: '#0a1a0a',
      border: '1px solid #c8ff00',
      borderRadius: 4,
      padding: 14,
      marginTop: 10,
    }}>
      <div style={{ fontSize: 10, color: '#558855', marginBottom: 6, letterSpacing: 1 }}>BET SLIP</div>
      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{betSlip.selection}</div>
      <div style={{ fontSize: 22, color: '#c8ff00', fontWeight: 700, marginBottom: 10 }}>@ {fmt(betSlip.odds)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number"
          value={stakeInput}
          onChange={e => setStakeInput(e.target.value)}
          min={10} max={500}
          style={{
            width: 80,
            background: '#0d200d',
            border: '1px solid #1a3a1a',
            color: '#c8ff00',
            fontFamily: 'inherit',
            fontSize: 14,
            padding: '6px 10px',
            borderRadius: 2,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: '#558855' }}>coins</span>
        <span style={{ fontSize: 11, color: '#558855' }}>
          Return: <span style={{ color: '#4eff91', fontWeight: 700 }}>{fmt(potReturn)}</span>
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setStakeInput(String(Math.min(500, Math.floor(stake * 5))))}
          style={{ background: '#1a3a1a', color: '#c8ff00', border: '1px solid #1a3a1a', fontFamily: 'inherit', fontSize: 10, padding: '5px 8px', borderRadius: 2, cursor: 'pointer' }}
        >
          ALL IN
        </button>
        <button
          onClick={() => onPlace(betSlip.market, betSlip.selection, betSlip.odds)}
          style={{ background: '#c8ff00', color: '#080d0a', fontWeight: 700, fontSize: 12, padding: '7px 16px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          PLACE BET
        </button>
        <button
          onClick={onClose}
          style={{ background: 'transparent', color: '#558855', fontSize: 12, padding: '7px 8px', borderRadius: 2, fontFamily: 'inherit', border: '1px solid #1a3a1a', cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ─── SET PIECE OVERLAY ────────────────────────────────────────────────────────

export function SetPieceOverlay({ setpiece, spTimer, stakeInput, setStakeInput, onBet }) {
  const [selected, setSelected] = useState(null)

  // Reset selection when a new set piece appears
  useEffect(() => { setSelected(null) }, [setpiece?.market, setpiece?.type])

  if (!setpiece) return null
  const timerPct = (spTimer / (setpiece.timerSec || 20)) * 100
  const urgent   = spTimer <= 5
  const betPlaced = selected !== null
  const canBet    = !betPlaced && spTimer > 0

  const handleBet = (market, key, odds) => {
    if (!canBet) return
    const success = onBet(market, key, odds, 300)
    if (success !== false) setSelected(key)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000000cc',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
    }}>
      <div style={{
        background: '#0a1a0a',
        border: '2px solid #c8ff00',
        borderRadius: 6,
        padding: 32,
        maxWidth: 460,
        width: '90%',
        textAlign: 'center',
        animation: 'spIn 0.3s ease',
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#c8ff00', marginBottom: 4, letterSpacing: 2 }}>
          {setpiece.spTitle}
        </div>
        {setpiece.type === 'freekick' && (
          <div style={{ fontSize: 11, color: '#558855', marginBottom: 16 }}>
            {setpiece.distNum}yds · {setpiece.position} · bet now
          </div>
        )}
        {setpiece.type === 'corner' && (
          <div style={{ fontSize: 11, color: '#558855', marginBottom: 16 }}>
            Delivery incoming — bet on the outcome
          </div>
        )}
        {setpiece.type === 'penalty' && (
          <div style={{ fontSize: 11, color: '#558855', marginBottom: 16 }}>
            Spot kick — what happens?
          </div>
        )}

        {/* Bet placed confirmation */}
        {betPlaced && (
          <div style={{ marginBottom: 12, padding: '8px 16px', background: '#0d2a0d', border: '1px solid #4eff91', borderRadius: 3, fontSize: 12, color: '#4eff91', fontWeight: 700 }}>
            ✅ BET PLACED — {selected.toUpperCase()} · Waiting for result...
          </div>
        )}

        {/* Options — disabled after one bet placed */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
          {setpiece.spOptions?.map(opt => {
            const isChosen = selected === opt.key
            const isDisabled = betPlaced && !isChosen
            return (
              <button
                key={opt.key}
                onClick={() => handleBet(setpiece.market, opt.key, opt.odds)}
                disabled={!canBet}
                style={{
                  background: isChosen ? '#0d400d' : isDisabled ? '#0a100a' : '#0d200d',
                  border: `1px solid ${isChosen ? '#4eff91' : isDisabled ? '#1a2a1a' : '#c8ff00'}`,
                  color: isChosen ? '#4eff91' : isDisabled ? '#2a4a2a' : '#c8ff00',
                  fontFamily: 'inherit',
                  padding: '10px 16px',
                  borderRadius: 3,
                  minWidth: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  cursor: canBet ? 'pointer' : 'not-allowed',
                  opacity: isDisabled ? 0.4 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 12 }}>{opt.label}</span>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{fmt(opt.odds)}</span>
                {isChosen && <span style={{ fontSize: 9, color: '#4eff91' }}>✓ YOUR BET</span>}
              </button>
            )
          })}
        </div>

        {/* Stake input */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: '#558855' }}>Stake:</span>
          <input
            type="number"
            value={stakeInput}
            onChange={e => setStakeInput(e.target.value)}
            min={10} max={300}
            style={{
              width: 72,
              background: '#0a100a',
              border: '1px solid #1a3a1a',
              color: '#c8ff00',
              fontFamily: 'inherit',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 2,
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: '#558855' }}>coins (max 300)</span>
        </div>

        {/* Timer bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ width: 140, height: 5, background: '#1a3a1a', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: urgent ? '#ff4444' : '#c8ff00',
              width: `${timerPct}%`,
              transition: 'width 1s linear',
            }} />
          </div>
          <span style={{
            fontSize: 16,
            color: urgent ? '#ff4444' : '#c8ff00',
            fontWeight: 700,
            minWidth: 36,
            animation: urgent ? 'pulse 0.5s infinite' : 'none',
          }}>
            ⏳{spTimer}s
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── ALL MARKETS ──────────────────────────────────────────────────────────────

export function Markets({ gs, odds, onSelect }) {
  if (!odds || gs.status === 'prematch') return null

  const { minute, score } = gs
  const goalsNow = score.P + score.A

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

      {/* M1 — Match Result */}
      <MarketCard title="MATCH RESULT" subtitle="Closes min 85" closed={minute >= 85}>
        <BetOption label="Portugal Win"  odds={vigO(odds.match.pWin)}  market="match" selection="por"  onSelect={onSelect} />
        <BetOption label="Draw"          odds={vigO(odds.match.pDraw)} market="match" selection="draw" onSelect={onSelect} />
        <BetOption label="Argentina Win" odds={vigO(odds.match.pLoss)} market="match" selection="arg"  onSelect={onSelect} />
      </MarketCard>

      {/* M2 — Over/Under */}
      <MarketCard
        title="OVER / UNDER 2.5"
        subtitle="Closes min 70"
        closed={minute >= 70 || goalsNow >= 3}
      >
        <BetOption label="Over 2.5"  odds={vigO(odds.overUnder.pOver)}  market="ou" selection="over"  onSelect={onSelect} />
        <BetOption label="Under 2.5" odds={vigO(odds.overUnder.pUnder)} market="ou" selection="under" onSelect={onSelect} />
      </MarketCard>

      {/* M3 — BTTS */}
      <MarketCard title="BOTH TEAMS TO SCORE" subtitle="Closes min 75" closed={minute >= 75}>
        <BetOption label="Yes" odds={vigO(odds.btts.pYes)} market="btts" selection="yes" onSelect={onSelect} />
        <BetOption label="No"  odds={vigO(odds.btts.pNo)}  market="btts" selection="no"  onSelect={onSelect} />
      </MarketCard>

      {/* M4 — Asian Handicap */}
      <MarketCard title="ASIAN HANDICAP" subtitle="Closes min 80" closed={minute >= 80}>
        <BetOption label="Portugal -0.5"  odds={vigO(odds.asianH.pPor)} market="ah" selection="por" onSelect={onSelect} />
        <BetOption label="Argentina -0.5" odds={vigO(odds.asianH.pArg)} market="ah" selection="arg" onSelect={onSelect} />
      </MarketCard>

      {/* M5 — Next Goal */}
      <MarketCard title="NEXT GOAL" subtitle="Closes min 88 · resets on goal" closed={minute >= 88}>
        <BetOption label="Portugal"       odds={vigO(odds.nextGoal.pPor)}  market="next" selection="por"  onSelect={onSelect} />
        <BetOption label="Argentina"      odds={vigO(odds.nextGoal.pArg)}  market="next" selection="arg"  onSelect={onSelect} />
        <BetOption label="No More Goals"  odds={vigO(odds.nextGoal.pNone)} market="next" selection="none" onSelect={onSelect} />
      </MarketCard>

      {/* M6 — Anytime Scorer */}
      <MarketCard title="ANYTIME GOALSCORER" subtitle="Closes min 75" closed={minute >= 75}>
        {SCORER_MARKET.map(({ key, label }) => (
          <BetOption
            key={key}
            label={label}
            odds={vigO(odds.scorers?.[key] ?? 0.05)}
            market="scorer"
            selection={key}
            onSelect={onSelect}
            small
          />
        ))}
      </MarketCard>

    </div>
  )
}

function vigO(p) {
  if (p <= 0) return 50
  return Math.min(50, Math.max(1.01, (1 / p) * 0.95))
}

// ─── FINAL RESULT PANEL ───────────────────────────────────────────────────────

export function FinalResult({ gs, balance, bets, onReset }) {
  if (gs.status !== 'finished') return null
  const pnl     = balance - INITIAL_BALANCE
  const won     = bets.filter(b => b.status === 'won').length
  const lost    = bets.filter(b => b.status === 'lost').length
  const result  = gs.score.P > gs.score.A ? '🟢 Portugal Win'
                : gs.score.P < gs.score.A ? '🔵 Argentina Win'
                : '⚖️ Draw'

  return (
    <div style={{ padding: 16, borderTop: '1px solid #1a3a1a', background: '#0d200d' }}>
      <div style={{ fontSize: 11, color: '#c8ff00', fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>FINAL RESULT</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
        POR {gs.score.P} – {gs.score.A} ARG
      </div>
      <div style={{ fontSize: 12, color: '#8aaa8a', marginBottom: 8 }}>{result}</div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11 }}>
        <div>
          <div style={{ color: '#3a5a3a' }}>Balance</div>
          <div style={{ color: '#c8ff00', fontWeight: 700 }}>{balance} coins</div>
        </div>
        <div>
          <div style={{ color: '#3a5a3a' }}>P&L</div>
          <div style={{ color: pnl >= 0 ? '#4eff91' : '#ff4444', fontWeight: 700 }}>
            {pnl >= 0 ? '+' : ''}{pnl}
          </div>
        </div>
        <div>
          <div style={{ color: '#3a5a3a' }}>Bets</div>
          <div style={{ color: '#8aaa8a', fontWeight: 700 }}>
            {won}W / {lost}L
          </div>
        </div>
      </div>
      <button
        onClick={onReset}
        style={{
          width: '100%',
          background: '#c8ff00',
          color: '#080d0a',
          fontWeight: 700,
          fontSize: 12,
          padding: '9px 0',
          borderRadius: 2,
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          letterSpacing: 1,
        }}
      >
        🔄 NEW MATCH
      </button>
    </div>
  )
}
