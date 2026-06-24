# ⚽ BetForge

> A real-time fake-coin football betting simulation. A full 90-minute match runs autonomously — goals, cards, penalties, corners, and free kicks all simulated by a probability engine. Six live betting markets with odds updating every match minute.

---

## Table of Contents

- [Demo & Stack](#demo--stack)
- [How It Works](#how-it-works)
- [Match Engine](#match-engine)
  - [Time Structure](#time-structure)
  - [Teams & Strength Ratings](#teams--strength-ratings)
  - [Event Simulation (Per Minute)](#event-simulation-per-minute)
  - [Set Pieces](#set-pieces)
- [Win Probability Model](#win-probability-model)
- [Betting Markets](#betting-markets)
  - [Market 1 — Match Result (1X2)](#market-1--match-result-1x2)
  - [Market 2 — Over / Under 2.5](#market-2--over--under-25)
  - [Market 3 — Both Teams to Score](#market-3--both-teams-to-score)
  - [Market 4 — Asian Handicap](#market-4--asian-handicap)
  - [Market 5 — Next Goal (Team)](#market-5--next-goal-team)
  - [Market 6 — Anytime Goalscorer](#market-6--anytime-goalscorer)
- [Odds System](#odds-system)
- [Coins & Betting Rules](#coins--betting-rules)
- [Live Notifications](#live-notifications)
- [UI Layout](#ui-layout)
- [Set Piece Overlay](#set-piece-overlay)
- [Edge Cases & Settlement Rules](#edge-cases--settlement-rules)
- [File Structure](#file-structure)
- [Getting Started](#getting-started)

---

## Demo & Stack

| Layer | Tech |
|---|---|
| Framework | React (functional components + hooks) |
| State | `useState`, `useEffect`, `useRef`, `useCallback` |
| Styling | Inline styles + CSS keyframe animations |
| Math | Custom Poisson engine (no external libs) |
| Fonts | JetBrains Mono (Google Fonts) |
| Data | All in-memory — no backend, no DB |

No dependencies outside React. Drop `BetForge.jsx` into any React project and it runs.

---

## How It Works

```
KICK OFF ──► every N seconds (TICK_SPEED):
               │
               ├── simulateMinute()
               │     ├── check set pieces (penalty / freekick / corner)
               │     ├── check open-play goals   [Poisson]
               │     ├── check red cards         [P = 0.001]
               │     └── check yellow cards      [P = 0.008]
               │
               ├── if set piece → pause clock → show overlay → resolve → resume
               │
               ├── update score / lambdas / red card state
               │
               ├── recalcAllOdds()   ← runs after every tick
               │
               └── check HT / FT → settle bets → show leaderboard
```

One match = 90 simulated minutes + stoppage time. Each real second = configurable match minutes (`TICK_SPEED` in ms, default `4000` = 4 real seconds per match minute → full match ≈ 6 real minutes).

---

## Match Engine

### Time Structure

| Phase | Match Minutes | Notes |
|---|---|---|
| First Half | 1 – 45 | Normal simulation |
| Half Time | — | 5-second real pause, odds recalculate |
| Second Half | 46 – 90 | Continues with updated state |
| Stoppage (HT) | 45+1 to 45+N | Poisson(μ=3), capped at 5 |
| Stoppage (FT) | 90+1 to 90+N | Same formula |

Stoppage time is calculated at minute 45 and 90 and announced via the notifications feed.

---

### Teams & Strength Ratings

Two teams are hardcoded (Portugal vs Argentina) with full player rosters for each set-piece type. The strength system is generic and can be swapped.

| Parameter | Portugal | Argentina |
|---|---|---|
| Strength | 1.40 | 1.60 |
| Home Advantage | 1.20 | 1.00 |
| Base λ (goals/min) | `(1.4 × 1.2) / 90 = 0.01867` | `1.6 / 90 = 0.01778` |

**λ formula:**
```
λ_home = (Strength × HomeAdvantage) / 90
λ_away = Strength / 90
```

**Red card penalty:** λ is permanently multiplied by `0.65` (35% reduction) for the affected team for the rest of the match.

---

### Event Simulation (Per Minute)

Each tick runs these checks in order. The first set-piece trigger short-circuits the rest of that minute (the clock pauses and the overlay fires).

```
Priority 1 → Penalty?          P = 0.008
Priority 2 → Free Kick?        P = 0.060
Priority 3 → Corner?           P = 0.050

If none of the above:
  Open-play goal (Team A)?     P = 1 - e^(-λ_A)
  Open-play goal (Team B)?     P = 1 - e^(-λ_B)
  Red card (per team)?         P = 0.001
  Yellow card (per team)?      P = 0.008
    └── Second yellow → red?   P = 0.003 (conditional on yellow)
```

Both teams are checked independently for goals, red cards, and yellow cards — two goals in one minute are possible.

---

### Set Pieces

The clock **pauses** when a set piece triggers. A betting overlay appears with a countdown timer. After the timer expires (or user bets), the set piece resolves and the clock resumes.

#### Penalty Resolution

```
Miss (over bar):    P = 0.06
Post:               P = 0.04
Direction duel:     taker direction vs GK dive direction

P(goal | same dir) = taker.same  (~0.60–0.62)
P(goal | diff dir) = taker.diff  (~0.80–0.92)

Pressure modifier (minute ≥ 80): × 0.92
E. Martínez Panenka read: if C vs C, P(goal) capped at 0.65
```

Each team has a `penalty` roster with weighted taker selection and directional probabilities (L / C / R). GK dive probabilities are defined per goalkeeper.

#### Free Kick Resolution

```
Position modifier:  central = 1.0 | wide = 0.6
Distance modifier:  short = 0.5  | med = 1.0 | long = 0.7

P(direct attempt) = taker.baseAttempt × posMod × distMod

If direct → P(goal) = taker.conv[distType]
           P(saved) ≈ 0.52 of misses
           P(off target) = remainder

If delivery → P(header goal) = 0.12
              P(saved)       = 0.20
              P(off target)  = 0.35
              P(blocked)     = remainder

Post: flat P = 0.08 (checked first)
```

#### Corner Resolution

Three delivery types: `inswinger`, `outswinger`, `short` (weighted 45 / 35 / 20).

```
Inswinger:   P(direct goal) = 0.03  +  P(header) = 0.11 × taker.bonus
Outswinger:  P(header goal) = 0.08 × taker.bonus
Short:       P(shot) → if scored P(goal) = 0.12, else chain to delivery

taker.bonus ∈ [1.0, 1.20]  ← specialist corner taker advantage
```

---

## Win Probability Model

At any match state, win probabilities are computed by iterating over all possible remaining scorelines using the Poisson distribution.

```
P(Team scores k goals in T remaining minutes) = Poisson(k, λ × T)

Poisson(k, μ) = e^(-μ) × μ^k / k!

P(A wins) = Σ_{i=0}^{10} Σ_{j=0}^{10}  Poisson(i, λ_A × T) × Poisson(j, λ_B × T)
            for all (i, j) where (score_A + i) > (score_B + j)

P(Draw)   = same double sum, where (score_A + i) = (score_B + j)
P(B wins) = 1 - P(A wins) - P(Draw)
```

Iterates i, j from 0 to 10 — covers >99.99% of the probability mass.

**Example probability table:**

| Situation | P(A wins) | P(Draw) | P(B wins) |
|---|---|---|---|
| 0-0 at kickoff, equal teams | 0.34 | 0.32 | 0.34 |
| 1-0 to A at 45 min | 0.72 | 0.17 | 0.11 |
| 1-0 to A at 75 min | 0.88 | 0.09 | 0.03 |
| 1-0 to A at 89 min | 0.97 | 0.02 | 0.01 |
| 2-0 to A at 60 min | 0.95 | 0.04 | 0.01 |
| 1-1 at 80 min | 0.22 | 0.58 | 0.22 |
| 1-2 to B at 70 min | 0.08 | 0.14 | 0.78 |

---

## Betting Markets

All six markets update live every minute. Odds are **locked at placement** — drift after bet doesn't affect payout.

### Market 1 — Match Result (1X2)

**Options:** Portugal Win / Draw / Argentina Win  
**Closes:** Minute 85

```
Raw odds(outcome) = 1 / P(outcome)
Vig-adjusted odds = Raw odds × (1 - 0.05)
```

**Example at 0-0 kickoff (equal teams):**

| Outcome | P | Raw | Adjusted |
|---|---|---|---|
| A Win | 0.34 | 2.94 | 2.79 |
| Draw | 0.32 | 3.13 | 2.97 |
| B Win | 0.34 | 2.94 | 2.79 |

---

### Market 2 — Over / Under 2.5

**Options:** Over 2.5 / Under 2.5  
**Closes:** Minute 70, or immediately when 3rd goal scored (Over settles as won)

```
μ_remaining = (λ_A + λ_B) × T_remaining
goals_needed = ceil(2.5 - current_goals + 1)

P(Over) = 1 - Poisson_CDF(floor(2.5 - G_current), μ_remaining)
P(Under) = 1 - P(Over)
```

If `G_current ≥ 3` → Over 2.5 settles as **won immediately**.  
If `T = 0` and `G_current ≤ 2` → Under 2.5 wins.

---

### Market 3 — Both Teams to Score

**Options:** Yes / No  
**Closes:** Minute 75

```
If both scored already → BTTS Yes = 1.0 (settled)
If neither scored:
  P(BTTS Yes) = (1 - e^(-λ_A × T)) × (1 - e^(-λ_B × T))
If one scored:
  P(BTTS Yes) = 1 - e^(-λ_other × T)
```

---

### Market 4 — Asian Handicap

**Options:** Portugal -0.5 / Argentina -0.5  
**Closes:** Minute 80

No draw option — team must win outright. Draw = loss for both sides.

```
P(Por -0.5) = P(Por wins outright) / (P(Por wins) + P(Arg wins))
P(Arg -0.5) = P(Arg wins outright) / (P(Por wins) + P(Arg wins))
```

---

### Market 5 — Next Goal (Team)

**Options:** Portugal / Argentina / No More Goals  
**Closes:** Minute 88. Resets after every goal.

```
P(any goal in T) = 1 - e^(-(λ_A + λ_B) × T)

P(Por scores next) = (λ_A / (λ_A + λ_B)) × P(any goal in T)
P(Arg scores next) = (λ_B / (λ_A + λ_B)) × P(any goal in T)
P(No more goals)  = e^(-(λ_A + λ_B) × T)
```

---

### Market 6 — Anytime Goalscorer

**Options:** Ronaldo / Messi / Bruno Fernandes / Álvarez / Di María / Bernardo Silva  
**Closes:** Minute 75

```
P(player scores) = 1 - e^(-(λ_team × T × player.weight))

player.weight = that player's share of team goals
  e.g. Ronaldo: 0.40 of Portugal goals
       Messi:   0.42 of Argentina goals
```

---

## Odds System

All odds displayed in **decimal (European) format**.

```
2.50 → bet 100 coins, win 250 total (150 profit)
1.05 → near certainty
15.0 → long shot
```

| Constraint | Value |
|---|---|
| Vig (bookmaker margin) | 5% |
| Odds floor | 1.01 |
| Odds cap | 50.00 |
| Formula | `max(1.01, (1 / P) × 0.95)` |

---

## Coins & Betting Rules

| Rule | Value |
|---|---|
| Starting balance | 1,000 coins |
| Minimum bet | 10 coins |
| Maximum single bet | 500 coins |
| Max active bets at once | 4 (3 for main markets + set-piece overlay) |
| Bet type | Single only (no accumulators) |

**Settlement:**
```
Winning bet:  balance += stake × odds_at_placement
Losing bet:   stake already deducted at placement
Void bet:     stake refunded
```

**Example:**
```
Bet 200 coins on Portugal Win @ 2.50
→ Balance immediately: 1000 - 200 = 800
→ If Portugal wins:    800 + (200 × 2.50) = 1300 coins
→ If Portugal doesn't: stays at 800 coins
```

Tiebreak (equal final balance): fewer total bets placed wins.

---

## Live Notifications

Every match minute produces one notification. Priority order:

| Priority | Event | Format |
|---|---|---|
| 1 | Goal | `⚽ GOAL! [Player] scores! [A]-[B] [min]'` |
| 2 | Equalizer | `🔥 EQUALIZER! [Player] levels it at [score]!` |
| 3 | Red card | `🔴 RED CARD! [Team] down to 10 men!` |
| 4 | Second yellow | `🔴 SECOND YELLOW! [Team] reduced to 10 men!` |
| 5 | Yellow card | `🟨 Yellow card — [Team]` |
| 6 | Stoppage time | `⏱️ [N] minutes of stoppage time added` |
| 7 | Penalty awarded | `🚨 PENALTY! [Team] awarded a penalty!` |
| 8 | Free kick | `🎯 FREE KICK! [Team] — [N] yards, [pos]!` |
| 9 | Corner | `🚩 CORNER! [Team] win a corner!` |
| 10 | Set piece outcome | Goal / Saved / Post / Miss messages |
| 11 | Odds big shift | `📊 Odds shift — [outcome] now [x.xx]` |
| 12 | Minute tick (every 5) | `[min]' — Match continues.` |

Special system messages: Kick Off, Half Time, Full Time, New Match.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  BETFORGE ● LIVE          💰 1,350 coins     P&L: +350          │  ← Header
├─────────────────────────────────────────────────────────────────┤
│    PORTUGAL          3 – 1          ARGENTINA                   │  ← Scoreboard
│    HOME · STR 1.40   67'   AWAY · STR 1.60                     │
│    [████████████████████░░░░░░░░░░░░░░░░] win probability bar   │
│    POR WIN 84%         DRAW 12%         ARG WIN 4%              │
├────────────┬──────────────────────────────┬────────────────────┤
│ LIVE FEED  │        MARKETS               │   MY BETS          │
│            │  ┌──────────┐ ┌──────────┐  │                    │
│ ⚽ GOAL!   │  │MATCH RES.│ │OVER/UNDER│  │  Match — Por Win   │
│ 🟨 Yellow  │  │Por  2.10 │ │Over 1.45 │  │  200 @ 2.79 ACTIVE │
│ 67' conts. │  │Draw 4.80 │ │Under 3.20│  │                    │
│            │  │Arg  9.50 │ └──────────┘  │  BTTS — Yes        │
│ 🎯 FREEKCK │  └──────────┘               │  100 @ 1.72 WON ✓  │
│ Ronaldo!   │  ┌──────────┐ ┌──────────┐  │  +172 coins        │
│            │  │  BTTS    │ │ASIAN H.  │  │                    │
│            │  │Yes  1.10 │ │Por -0.5  │  │                    │
│            │  │No   6.50 │ │Arg -0.5  │  │                    │
│            │  └──────────┘ └──────────┘  │                    │
│            │       [BET SLIP]             │                    │
└────────────┴──────────────────────────────┴────────────────────┘
```

**Three-column layout (280px | flex | 280px):**

- **Left panel** — scrolling live feed, newest at top, color-coded by event type
- **Centre** — 2-column grid of market cards, sticky bet slip at bottom
- **Right panel** — My Bets list (active / won / lost), final result + reset on FT

**Top bar** — live score, match clock, balance, P&L at all times.

**Win probability bar** — color-coded left (Portugal) / grey (Draw) / right (Argentina), width = probability, transitions animated.

---

## Set Piece Overlay

When a penalty, free kick, or corner is triggered, the main clock **pauses** and a full-screen modal appears:

```
┌──────────────────────────────────────┐
│   🚨 PENALTY — PORTUGAL! 🚨          │
│   Ronaldo vs E. Martínez             │
│                                      │
│  [ ⚽ Goal  ] [ 🧤 Saved ] [ ❌ Miss]│
│    1.35         4.80        9.00     │
│                                      │
│  Stake: [____] coins (max 300)       │
│                                      │
│  [████████████████░░░░░] ⏳ 12s      │
└──────────────────────────────────────┘
```

- Timer counts down (20s penalty / 30s free kick / 25s corner)
- Player can bet on outcome before it resolves
- On timer expiry → set piece resolves → notification fires → overlay closes → clock resumes
- Set piece bets settle immediately (not at FT)

---

## Edge Cases & Settlement Rules

| Situation | Behaviour |
|---|---|
| Balance hits 0 | Player stays on leaderboard, can no longer bet |
| Market already closed | Bet rejected, notification shown |
| Admin forces a goal | Treated identically to a simulated goal — all markets update |
| 0-0 at FT | BTTS No wins, Under 2.5 wins, Correct Score 0-0 wins |
| Over 2.5 already triggered | Market closes immediately, Over bets settle as won |
| BTTS Yes already triggered | Market closes immediately, Yes bets settle as won |
| Next Goal market | Resets and reopens after every goal throughout the match |
| Tied final balance | Fewer total bets placed = tiebreak win |
| Match abandoned | All active stakes refunded (void) |
| Odds drift after bet | Locked at time of placement — drift has no effect |

---

## File Structure

```
BetForge.jsx
│
├── CONSTANTS
│   ├── TEAMS          — player rosters for Portugal & Argentina
│   └── GK_DIVE        — goalkeeper dive direction probabilities
│
├── MATH HELPERS
│   ├── poisson(k, μ)          — Poisson PMF
│   ├── rand()                 — Math.random() alias
│   ├── weightedPick(items)    — weighted random selection
│   ├── calcWinProbs(...)      — double Poisson sum for 1X2
│   ├── vigOdds(p)             — apply 5% vig, clamp to [1.01, 50]
│   └── fmt(n)                 — toFixed(2)
│
├── ENGINE
│   ├── simulateMinute(state)  — per-tick event simulation
│   ├── resolveFreekick(...)   — free kick outcome
│   ├── resolveCorner(...)     — corner delivery + outcome
│   └── resolvePenalty(...)    — penalty direction duel
│
├── ODDS CALCULATOR
│   └── calcAllOdds(...)       — all 6 markets in one pass
│
├── MAIN COMPONENT — BetForge()
│   ├── State: gs, bets, balance, notifications, activeBetSlip, odds
│   ├── advanceMinute()        — main tick handler
│   ├── processSetpiece()      — resolve and settle set-piece bets
│   ├── settleBets()           — full-time settlement
│   ├── placeBet()             — validation + deduct + record
│   └── selectBet()            — open bet slip for a selection
│
└── COMPONENTS
    ├── MarketCard             — market container with closed state
    └── BetOption              — single clickable odds button
```

---

## Getting Started

```bash
# 1. Install React (if not already)
npx create-react-app betforge
cd betforge

# 2. Replace src/App.js content, or drop in as a component
cp BetForge.jsx src/BetForge.jsx

# 3. In src/App.js:
import BetForge from './BetForge';
export default function App() { return <BetForge />; }

# 4. Run
npm start
```

**To adjust match speed:** change `TICK_SPEED` at the top of the file.

```js
const TICK_SPEED = 4000;  // 4s per match minute → ~6 min full match
const TICK_SPEED = 8000;  // 8s per match minute → ~12 min full match
const TICK_SPEED = 1000;  // 1s per match minute → ~1.5 min (stress test)
```

**To change teams:** edit the `TEAMS` constant. The engine is team-agnostic — only the player names are specific to Portugal/Argentina.

---

## License

MIT — do whatever you want with it. Fake coins only.
