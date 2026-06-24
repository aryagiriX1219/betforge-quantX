import { useState } from 'react'
import { LoginScreen } from './LoginScreen'
import BetForge from './BetForge'
import { AdminPanel } from './AdminPanel'
import { useMatch } from './useMatch'
import { ADMIN_PASSWORD } from './constants'

export default function App() {
  const [view, setView]   = useState('login')
  const [user, setUser]   = useState(null)
  const isAdmin           = view === 'admin'
  const match             = useMatch(user, isAdmin)

  if (view === 'admin') {
    return (
      <AdminPanel
        gs={match.gs}
        bets={match.bets}
        connected={match.connected}
        adminKickOff={match.adminKickOff}
        adminPause={match.adminPause}
        adminResume={match.adminResume}
        adminEndMatch={match.adminEndMatch}
        adminReset={match.adminReset}
        adminAddStoppage={match.adminAddStoppage}
        adminVoidMarket={match.adminVoidMarket}
        adminInjectEvent={match.adminInjectEvent}
        onSwitchToPlayer={() => setView('player')}
      />
    )
  }

  if (view === 'player' && user) {
    return (
      <BetForge
        currentUser={user}
        match={match}
        onLogout={() => { setUser(null); setView('login') }}
        onAdmin={() => setView('admin')}
      />
    )
  }

  return (
    <LoginScreen
      onLogin={(u) => { setUser(u); setView('player') }}
      onAdmin={() => setView('admin')}
    />
  )
}
