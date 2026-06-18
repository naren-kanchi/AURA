import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DashboardState } from '../types'
import { THEME } from '../theme'
import NetworkGraph from '../components/NetworkGraph'
import ScoreTimeline from '../components/ScoreTimeline'

// ─── 5 Federation clients ──────────────────────────────────────────────────────
const CLIENTS = [
  { key: 'hospital',   id: 'org_hospital_1',   label: 'Hospital',   icon: '🏥', net: '192.168.1.0/24', color: '#00cc6a' },
  { key: 'bank',       id: 'org_bank_2',        label: 'Bank',       icon: '🏦', net: '10.0.1.0/24',   color: '#3b82f6' },
  { key: 'university', id: 'org_university_3',  label: 'University', icon: '🎓', net: '172.16.1.0/24', color: '#a855f7' },
  { key: 'isp',        id: 'org_isp_4',         label: 'ISP',        icon: '🌐', net: '10.10.0.0/24',  color: '#f59e0b' },
  { key: 'retail',     id: 'org_retail_5',      label: 'Retail',     icon: '🛒', net: '172.31.0.0/24', color: '#ec4899' },
]

const ATTACKS = [
  { label: 'DDoS',      type: 'ddos',     icon: '🌊' },
  { label: 'Port Scan', type: 'portscan', icon: '🔍' },
  { label: 'Lateral',   type: 'lateral',  icon: '↔️' },
  { label: 'Exfil',     type: 'exfil',    icon: '📤' },
  { label: 'Web Atk',   type: 'web',      icon: '💉' },
]

const REFRESH_MS = 1500

// Severity colour helper
function sevColor(sev?: string): string {
  if (!sev) return THEME.dim
  const s = String(sev).toUpperCase()
  if (s === 'HIGH')   return '#f85149'
  if (s === 'MEDIUM') return '#f97316'
  if (s === 'LOW')    return THEME.yellow
  return THEME.dim
}

// Group residuals bar
function GroupResidualBars({ groups }: { groups: Record<string, number> }) {
  const max = Math.max(...Object.values(groups), 0.001)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {Object.entries(groups).sort(([, a], [, b]) => b - a).map(([name, val]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem' }}>
          <span style={{ color: THEME.dim, width: 130, flexShrink: 0 }}>{name}</span>
          <div style={{
            height: 6, flex: 1, background: '#1a2a38', borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.round((val / max) * 100)}%`,
              background: `linear-gradient(90deg, ${THEME.cyan}, ${THEME.orange})`,
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ color: THEME.text, width: 45, textAlign: 'right', fontFamily: 'monospace' }}>
            {val.toFixed(4)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [state,         setState]        = useState<DashboardState | null>(null)
  const [globalState,   setGlobalState]  = useState<DashboardState | null>(null)
  const [loading,       setLoading]      = useState(true)
  const [busy,          setBusy]         = useState(false)
  const [toast,         setToast]        = useState<string | null>(null)
  const [customScript,  setCustomScript] = useState('')
  const [targetNode,    setTargetNode]   = useState('')
  const [injectStatus,  setInjectStatus] = useState('')
  const [activeClient,  setActiveClient] = useState<string>('hospital')
  const [clientSummary, setClientSummary] = useState<Record<string, { attack_active: boolean; ae_score: number; system_status: string }>>({})

  const activeClientRef = useRef(activeClient)
  activeClientRef.current = activeClient

  // Fetch per-client state + global state + client summaries
  const refresh = useCallback(async () => {
    try {
      const [cs, gs, summaries] = await Promise.all([
        api.getClientState(activeClientRef.current),
        api.getState(),
        api.getClientsSummary(),
      ])
      setState(cs)
      setGlobalState(gs)
      // Build client summary lookup
      const lookup: Record<string, { attack_active: boolean; ae_score: number; system_status: string }> = {}
      for (const s of summaries) {
        lookup[s.key] = { attack_active: s.attack_active, ae_score: s.ae_score, system_status: s.system_status }
      }
      setClientSummary(lookup)
    } catch { /* API may be starting */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Re-fetch immediately on client switch
  useEffect(() => { refresh() }, [activeClient, refresh])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const runAction = async (fn: () => Promise<{ state: DashboardState }>, successMsg?: string) => {
    setBusy(true)
    try {
      const res = await fn()
      setState(res.state)
      if (successMsg) showToast(successMsg)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleAttack = (type: string, label: string) =>
    runAction(() => api.injectClientAttack(type, activeClient), `💥 ${label} injected on ${activeClient.toUpperCase()}!`)

  const handleNormal = () =>
    runAction(() => api.injectClientNormal(activeClient), `✅ Normal traffic for ${activeClient.toUpperCase()}`)

  const handleCustomInject = async () => {
    if (!targetNode)          { setInjectStatus('⚠ Please select a target node.'); return }
    if (!customScript.trim()) { setInjectStatus('⚠ Script cannot be empty.'); return }
    setBusy(true)
    setInjectStatus('Submitting…')
    try {
      const res = await api.injectCustom(customScript, targetNode)
      setState(res.state)
      setInjectStatus(`⚡ Script injected → ${targetNode} (MSE: ${res.mse?.toFixed(4) ?? '—'})`)
      setTimeout(() => setInjectStatus(''), 3000)
    } catch (e) {
      setInjectStatus(`✗ ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  if (loading && !state) {
    return (
      <div style={{ padding: '3rem', color: THEME.dim, textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚡</div>
        <div>Initialising AURA…</div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="panel" style={{ margin: '2rem', color: THEME.red }}>
        API unreachable. Start backend: <code>python api_server.py</code>
      </div>
    )
  }

  const activeInfo    = CLIENTS.find(c => c.key === activeClient) ?? CLIENTS[0]
  const isUnderAttack = (clientSummary[activeClient]?.system_status ?? state.system_status) === 'UNDER ATTACK'
  const statusColor   = isUnderAttack ? THEME.red : THEME.green
  const expl          = state.last_explanation as Record<string, unknown> | null

  return (
    <>
      {/* ── Client Switcher Bar ─────────────────────────────────────────────── */}
      <div className="client-bar">
        <span className="client-bar-label">🖥 View Client</span>
        {CLIENTS.map(c => {
          const cs     = clientSummary[c.key]
          const isAtk  = cs?.attack_active
          const badge  = isAtk ? '🔴' : '🟢'
          return (
            <button
              key={c.key}
              data-org={c.key}
              className={`client-btn ${activeClient === c.key ? 'active' : ''}`}
              onClick={() => setActiveClient(c.key)}
              title={`${c.label} — ${c.net}\nAE: ${cs?.ae_score?.toFixed(4) ?? '—'} | ${cs?.system_status ?? 'Loading'}`}
              style={{ '--client-color': c.color } as React.CSSProperties}
            >
              <span style={{ fontSize: '0.7em', marginRight: 3 }}>{badge}</span>
              {c.icon} {c.label}
              {isAtk && (
                <span style={{ marginLeft: 4, fontSize: '0.62em', color: THEME.red, fontWeight: 800 }}>ATK</span>
              )}
            </button>
          )
        })}
        <div style={{
          marginLeft: 'auto', padding: '0.3rem 0.85rem',
          background: `${activeInfo.color}18`, border: `1px solid ${activeInfo.color}55`,
          borderRadius: 20, fontSize: '0.72rem', color: activeInfo.color, fontWeight: 600,
        }}>
          {activeInfo.icon} {activeInfo.net}
        </div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="header-panel" style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '1.4em', fontWeight: 800, color: THEME.cyan }} className="glow-cyan">
            🛡️ AURA
          </span>
          <span style={{ color: THEME.dim, fontSize: '0.82em' }}>Autonomous Unified Resilience Architecture</span>
          <span style={{
            background: `${activeInfo.color}18`, border: `1px solid ${activeInfo.color}88`,
            borderRadius: 20, padding: '3px 14px', fontSize: '0.78em',
            color: activeInfo.color, fontWeight: 700,
          }}>
            {activeInfo.icon} {activeInfo.label.toUpperCase()} · {activeInfo.id}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ color: statusColor, fontWeight: 700 }}>
            <span className="status-dot" style={{ backgroundColor: statusColor }} />
            {isUnderAttack ? 'UNDER ATTACK' : 'ACTIVE'}
          </span>
          <span style={{ color: THEME.dim, marginLeft: '1em', fontSize: '0.73em' }}>
            {globalState?.model_status ?? state.model_status} | Chain: {(globalState?.blockchain_mode ?? state.blockchain_mode)?.toUpperCase()}
          </span>
        </div>
      </div>

      {/* ── Metrics Row ─────────────────────────────────────────────────────── */}
      <div className="grid-6" style={{ marginBottom: '1rem' }}>
        {([
          ['Windows',    state.metrics?.window_counter ?? 0,                THEME.cyan],
          ['Threats',    state.metrics?.total_attacks  ?? 0,                THEME.red],
          ['Blocked',    state.metrics?.total_blocked  ?? 0,                THEME.orange],
          ['FL Rounds',  globalState?.metrics?.fl_rounds_done ?? 0,         THEME.blue],
          ['Chain Logs', globalState?.metrics?.chain_entries  ?? 0,         '#a855f7'],
          ['AE Score',   (state.metrics?.current_ae_score ?? 0).toFixed(4), THEME.green],
        ] as [string, string | number, string][]).map(([label, val, col]) => (
          <div key={label} className="metric-card">
            <div className="metric-label">{label}</div>
            <div className="metric-value" style={{ color: col, fontSize: '1.35rem' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Network + Timeline ───────────────────────────────────────────────── */}
      <div className="grid-2" style={{ marginBottom: '1rem' }}>
        <div className="panel">
          <h4 className="panel-title" style={{ color: THEME.cyan }}>
            🌐 Network Topology — <span style={{ color: activeInfo.color }}>{activeInfo.label}</span>
          </h4>
          <NetworkGraph nodes={state.nodes} edgeIndex={state.edge_index} />
          <div style={{ fontSize: '0.72em', color: THEME.dim, marginTop: '0.35rem', display: 'flex', gap: '1rem' }}>
            <span style={{ color: THEME.green }}>◆ Normal</span>
            <span style={{ color: THEME.yellow }}>◆ Evaluating</span>
            <span style={{ color: THEME.red }}>◆ Threat</span>
          </div>
        </div>
        <div className="panel">
          <h4 className="panel-title" style={{ color: THEME.cyan }}>
            📈 Anomaly Score — <span style={{ color: activeInfo.color }}>{activeInfo.label}</span>
          </h4>
          <ScoreTimeline
            scores={state.timeline?.scores ?? []}
            thresholds={state.timeline?.thresholds ?? []}
          />
          {(state.ema?.warmup_left ?? 0) > 0 ? (
            <div style={{ fontSize: '0.78rem', color: THEME.blue, marginTop: '0.5rem' }}>
              🔄 EMA calibrating… {state.ema!.warmup_left} windows remaining
            </div>
          ) : (
            <div style={{ fontSize: '0.73rem', color: THEME.dim, marginTop: '0.4rem', fontFamily: 'monospace' }}>
              μ={(state.ema?.mean ?? 0).toFixed(4)} · σ={(state.ema?.std ?? 0).toFixed(4)} · threshold={(state.ema?.threshold ?? 0).toFixed(4)}
            </div>
          )}
        </div>
      </div>

      {/* ── AE Explanation Panel ─────────────────────────────────────────────── */}
      {expl && (
        <>
          <hr className="divider" />
          <div className="panel" style={{ marginBottom: '1rem', border: `1px solid ${sevColor(String(expl.severity ?? ''))}44` }}>
            <h4 className="panel-title" style={{ color: THEME.orange }}>
              🧠 AE Explainability — Why did the score spike on <span style={{ color: activeInfo.color }}>{activeInfo.label}</span>?
            </h4>

            {/* Row 1: inferred attack + severity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', marginBottom: '0.75rem', alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: THEME.orange, marginBottom: '0.2rem' }}>
                  {(expl.explanation as Record<string, string>)?.icon ?? '⚡'}{' '}
                  {String(expl.inferred_attack)}
                </div>
                <div style={{ fontSize: '0.83rem', color: THEME.dim, marginBottom: '0.5rem' }}>
                  {(expl.explanation as Record<string, string>)?.summary}
                </div>
                <div style={{ fontSize: '0.78rem', color: THEME.text, lineHeight: 1.5, marginBottom: '0.5rem' }}>
                  {(expl.explanation as Record<string, string>)?.detail}
                </div>
                <div style={{
                  fontSize: '0.76rem', color: THEME.cyan,
                  background: '#0c1e30', borderRadius: 6, padding: '0.4rem 0.6rem',
                  borderLeft: `3px solid ${THEME.cyan}`,
                }}>
                  <strong>Why these features?</strong>{' '}
                  {(expl.explanation as Record<string, string>)?.why_high}
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 160 }}>
                <div style={{
                  display: 'inline-block',
                  padding: '0.4rem 1rem',
                  borderRadius: 8,
                  background: `${sevColor(String(expl.severity ?? ''))}22`,
                  border: `1px solid ${sevColor(String(expl.severity ?? ''))}`,
                  color: sevColor(String(expl.severity ?? '')),
                  fontWeight: 800,
                  fontSize: '1rem',
                  marginBottom: '0.5rem',
                }}>
                  {String(expl.severity ?? 'LOW')}
                </div>
                <div style={{ fontSize: '0.78rem', color: THEME.dim }}>
                  Confidence: <span style={{ color: THEME.text, fontWeight: 700 }}>
                    {Number(expl.confidence ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: THEME.dim, marginTop: '0.2rem' }}>
                  RF Match: <span style={{ color: THEME.text, fontWeight: 700 }}>
                    {(Number(expl.match_score ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: group residuals + top features side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: THEME.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', fontWeight: 700 }}>
                  Feature Group Residuals
                </div>
                {expl.group_residuals && Object.keys(expl.group_residuals as object).length > 0 ? (
                  <GroupResidualBars groups={expl.group_residuals as Record<string, number>} />
                ) : (
                  <span style={{ color: THEME.dim, fontSize: '0.76rem' }}>No group data.</span>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: THEME.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', fontWeight: 700 }}>
                  Top Anomalous Features
                </div>
                {(expl.top_features as [string, number, number][] | undefined)?.slice(0, 6).map(([name, val], i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '0.2rem 0', borderBottom: `1px solid ${THEME.border}44`,
                    fontSize: '0.74rem',
                  }}>
                    <span style={{ color: THEME.cyan }}>{name}</span>
                    <span style={{ color: THEME.text, fontFamily: 'monospace' }}>{Number(val).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <hr className="divider" />

      {/* ── Control Panels ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.85fr', gap: '1rem', marginBottom: '1rem' }}>

        {/* Attack Simulation — targeted at active client */}
        <div className="panel" style={{ borderColor: THEME.red + '44' }}>
          <h4 className="panel-title" style={{ color: THEME.red }}>
            🔴 Attack Simulation →{' '}
            <span style={{ color: activeInfo.color }}>{activeInfo.icon} {activeInfo.label}</span>
          </h4>
          <div className="grid-3" style={{ marginBottom: '0.75rem' }}>
            {ATTACKS.map(a => (
              <button
                key={a.type}
                className="btn btn-danger"
                disabled={busy}
                onClick={() => handleAttack(a.type, a.label)}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
          <div>
            <label style={{ fontSize: '0.7em', color: THEME.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ⚡ Custom Script Injection
            </label>
            <textarea
              className="custom-script"
              placeholder="# Write your attack script here"
              value={customScript}
              onChange={(e) => setCustomScript(e.target.value)}
              style={{ marginTop: '0.4rem' }}
            />
            <select className="node-select" value={targetNode} onChange={(e) => setTargetNode(e.target.value)}>
              <option value="">Select target node…</option>
              {(state.nodes ?? []).map(n => (
                <option key={n.id} value={n.id}>
                  {n.id} — {n.label}{n.critical ? ' 🔑' : ''}
                </option>
              ))}
            </select>
            <button
              className="btn btn-amber"
              style={{ width: '100%', marginTop: '0.5rem' }}
              disabled={busy}
              onClick={handleCustomInject}
            >
              ⚡ Inject Custom Script
            </button>
            {injectStatus && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.73rem', color: THEME.yellow }}>{injectStatus}</div>
            )}
          </div>
          <button
            className="btn"
            style={{ width: '100%', marginTop: '0.75rem', borderColor: THEME.green, color: THEME.green }}
            disabled={busy}
            onClick={handleNormal}
          >
            🟢 Generate Normal Traffic for {activeInfo.label}
          </button>
        </div>

        {/* Federation */}
        <div className="panel" style={{ borderColor: THEME.blue + '44' }}>
          <h4 className="panel-title" style={{ color: THEME.blue }}>🌐 Federation</h4>
          <div style={{
            background: `${activeInfo.color}12`, border: `1px solid ${activeInfo.color}33`,
            borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.78rem',
          }}>
            <div style={{ color: activeInfo.color, fontWeight: 700, marginBottom: '0.2rem' }}>
              {activeInfo.icon} {activeInfo.label} Node
            </div>
            <div style={{ color: THEME.dim }}>{activeInfo.net} · {activeInfo.id}</div>
          </div>
          {state.org && (
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: state.under_attack ? THEME.red : THEME.dim }}>
              {state.under_attack ? '🚨 UNDER ATTACK — Quarantined' : state.fl_ready ? '✅ Ready for FL' : '⏸ Not ready'}
            </div>
          )}
          {state.org && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
              {state.under_attack ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => runAction(() => api.resolveAttack())}>
                  ✅ Issue Resolved — Resume
                </button>
              ) : (
                <>
                  <button className="btn" disabled={busy} onClick={() => runAction(() => api.setFlReady(!state.fl_ready))}>
                    {state.fl_ready ? '⏸ Revoke FL Readiness' : '✅ Signal FL Ready'}
                  </button>
                  <button className="btn btn-danger" disabled={busy} onClick={() => runAction(() => api.setUnderAttack())}>
                    🚨 Report Under Attack — Quarantine
                  </button>
                </>
              )}
            </div>
          )}
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={busy || (globalState ?? state).fl_running}
            onClick={() => runAction(() => api.runFederation(), '🚀 Federation complete')}
          >
            {(globalState ?? state).fl_running ? '⏳ Running FL…' : '🚀 Run FL Simulation (5 Clients)'}
          </button>
          {(globalState ?? state).fed_log?.length > 0 && (
            <div className="log-list" style={{ marginTop: '0.75rem', color: THEME.blue }}>
              {(globalState ?? state).fed_log.map((line, i) => (
                <div key={i} className="log-item">{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* Blockchain */}
        <div className="panel" style={{ borderColor: '#a855f755' }}>
          <h4 className="panel-title" style={{ color: '#a855f7' }}>⛓ Blockchain Audit</h4>
          <button
            className="btn"
            style={{ width: '100%', marginBottom: '0.5rem', borderColor: '#a855f7', color: '#a855f7' }}
            disabled={busy}
            onClick={() => runAction(() => api.registerHash(), 'Hash registered')}
          >
            📝 Register Test Hash
          </button>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '0.75rem' }}
            disabled={busy}
            onClick={async () => {
              try {
                const r = await api.verifyChain()
                showToast(r.ok ? '✅ Chain INTACT' : '⚠ TAMPER DETECTED')
              } catch (e) {
                showToast(e instanceof Error ? e.message : 'Verify failed')
              }
            }}
          >
            🔍 Verify Chain
          </button>
          <div className="log-list">
            {(globalState ?? state).chain_log?.length === 0 ? (
              <span style={{ color: THEME.dim, fontSize: '0.78rem' }}>No hashes minted yet.</span>
            ) : (globalState ?? state).chain_log?.map((e, i) => (
              <div key={i} className="log-item" style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#a855f7' }}>
                R{e.round} {e.version}: {e.hash.slice(0, 20)}… @ {e.time}
              </div>
            ))}
          </div>
        </div>
      </div>

      <hr className="divider" />

      {/* ── Logs ──────────────────────────────────────────────────────────────── */}
      <div className="grid-2">
        <div className="panel">
          <h4 className="panel-title" style={{ color: THEME.yellow }}>
            🔔 Alerts — <span style={{ color: activeInfo.color }}>{activeInfo.label}</span>
          </h4>
          {!state.alerts?.length ? (
            <span style={{ color: THEME.dim, fontSize: '0.8rem' }}>No alerts triggered yet.</span>
          ) : (
            <div className="log-list">
              {state.alerts.map((a, i) => (
                <div key={i} className="log-item">
                  <span style={{ color: sevColor(a.severity), fontWeight: 700 }}>{String(a.severity)}</span>
                  {' · '}
                  <span style={{ color: THEME.orange }}>{String(a.inferred_attack ?? a.tag ?? 'Alert')}</span>
                  {' · MSE '}
                  <span style={{ fontFamily: 'monospace' }}>{Number(a.ae_score ?? 0).toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <h4 className="panel-title" style={{ color: THEME.orange }}>
            🛡️ Response Actions — <span style={{ color: activeInfo.color }}>{activeInfo.label}</span>
          </h4>
          {!state.incidents?.length ? (
            <span style={{ color: THEME.dim, fontSize: '0.8rem' }}>No responses triggered yet.</span>
          ) : (
            <div className="log-list">
              {state.incidents.map((r, i) => (
                <div key={i} className="log-item">
                  <strong style={{ color: THEME.text }}>{String(r.action_taken)}</strong>
                  {' → '}{String(r.node_id)} ({String(r.node_label)})
                  <br />
                  <span style={{ color: THEME.dim, fontSize: '0.7rem' }}>{String(r.policy_reason)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '1rem', textAlign: 'right' }}>
        <button className="btn" disabled={busy}
          onClick={() => runAction(() => api.clearClientLogs(activeClient), 'Logs cleared')}
        >
          🗑️ Clear {activeInfo.label} Logs
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
