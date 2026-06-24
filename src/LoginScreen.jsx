import { useState } from 'react'
import { USERS } from './users'
import { ADMIN_PASSWORD } from './constants'

export function LoginScreen({ onLogin, onAdmin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = () => {
    setError('')
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.')
      return
    }
    // Admin shortcut
    if (username.trim().toLowerCase() === 'admin' && password.trim() === ADMIN_PASSWORD) {
      onAdmin()
      return
    }
    setLoading(true)
    setTimeout(() => {
      const user = USERS.find(
        u => u.username === username.trim().toLowerCase() &&
             u.password === password.trim()
      )
      setLoading(false)
      if (user) onLogin(user)
      else setError('Invalid credentials. Check your username and password.')
    }, 400)
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#080d0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'JetBrains Mono','Courier New',monospace",
    }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚽</div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 3, color: '#c8ff00' }}>
            BET<span style={{ color: '#fff' }}>FORGE</span>
          </div>
          <div style={{ fontSize: 11, color: '#3a5a3a', marginTop: 6, letterSpacing: 1 }}>
            QUANTX FOOTBALL SIMULATION
          </div>
        </div>

        <div style={{ background: '#0a150a', border: '1px solid #1e3e1e', borderRadius: 6, padding: '32px 28px' }}>
          <div style={{ fontSize: 11, color: '#558855', fontWeight: 700, letterSpacing: 1.5, marginBottom: 24 }}>SIGN IN</div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, color: '#3a5a3a', letterSpacing: 1, display: 'block', marginBottom: 6 }}>USERNAME</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. arya"
              style={{ width: '100%', background: '#0d200d', border: '1px solid #1a3a1a', borderRadius: 3, color: '#e8ffe8', fontFamily: 'inherit', fontSize: 14, padding: '10px 12px', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = '#c8ff00'}
              onBlur={e => e.target.style.borderColor = '#1a3a1a'}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 10, color: '#3a5a3a', letterSpacing: 1, display: 'block', marginBottom: 6 }}>PASSWORD</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. arya1234"
              style={{ width: '100%', background: '#0d200d', border: '1px solid #1a3a1a', borderRadius: 3, color: '#e8ffe8', fontFamily: 'inherit', fontSize: 14, padding: '10px 12px', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = '#c8ff00'}
              onBlur={e => e.target.style.borderColor = '#1a3a1a'}
            />
          </div>

          {error && (
            <div style={{ background: '#1a0808', border: '1px solid #ff444422', borderRadius: 3, padding: '8px 12px', fontSize: 11, color: '#ff8888', marginBottom: 16 }}>
              ⚠️ {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading}
            style={{ width: '100%', background: loading ? '#8aaa00' : '#c8ff00', color: '#080d0a', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '11px 0', borderRadius: 3, border: 'none', cursor: loading ? 'wait' : 'pointer', letterSpacing: 1.5 }}>
            {loading ? 'CHECKING...' : '▶ ENTER'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: '#2a4a2a', lineHeight: 1.8 }}>
          Username: first 4 letters of your name<br />
          Password: username + last 4 digits of phone
        </div>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={onAdmin}
            style={{ background: 'none', border: '1px solid #1a3a1a', color: '#2a4a2a', fontFamily: 'inherit', fontSize: 10, padding: '5px 16px', borderRadius: 2, cursor: 'pointer', letterSpacing: 1 }}>
            ⚙️ ADMIN
          </button>
        </div>
      </div>
    </div>
  )
}
