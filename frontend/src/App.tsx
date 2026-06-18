import { Routes, Route, NavLink } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import FLServerPage from './pages/FLServerPage'

export default function App() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">🛡️ AURA</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            🖥️ Operations Dashboard
          </NavLink>
          <NavLink to="/fl-server" className={({ isActive }) => (isActive ? 'active' : '')}>
            ⚙️ FL Server Console
          </NavLink>
        </nav>
        <hr className="divider" />
        <div className="sidebar-info">
          <p><strong style={{ color: '#00ccff' }}>Layer 1</strong> — Flow Autoencoder</p>
          <p><strong style={{ color: '#00ccff' }}>Layer 2</strong> — GraphSAGE STGNN</p>
          <p><strong style={{ color: '#00ccff' }}>FL</strong> — FLTrust + Flower</p>
          <p><strong style={{ color: '#00ccff' }}>Audit</strong> — SHA-256 Ledger</p>
          <div style={{ marginTop: '1.2rem', fontSize: '0.7rem', color: '#253856', letterSpacing: '0.04em' }}>
            5 FEDERATED CLIENTS ACTIVE
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/fl-server" element={<FLServerPage />} />
        </Routes>
      </main>
    </div>
  )
}
