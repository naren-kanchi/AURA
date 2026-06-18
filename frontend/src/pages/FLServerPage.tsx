import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { FLServerState } from '../types'
import { FL_THEME as T } from '../theme'

const REFRESH_MS = 1000

// All 5 clients with visual identity
const FL_CLIENTS = [
  { key: 'hospital',   id: 'org_hospital_1',   label: 'Hospital',   icon: '🏥', net: '192.168.1.0/24',  color: '#00cc6a', desc: 'General hospital network — benign baseline' },
  { key: 'bank',       id: 'org_bank_2',        label: 'Bank',       icon: '🏦', net: '10.0.1.0/24',     color: '#3b82f6', desc: 'Financial network — adversarial detection' },
  { key: 'university', id: 'org_university_3',  label: 'University', icon: '🎓', net: '172.16.1.0/24',   color: '#a855f7', desc: 'Academic campus network — mixed traffic' },
  { key: 'isp',        id: 'org_isp_4',         label: 'ISP',        icon: '🌐', net: '10.10.0.0/24',    color: '#f59e0b', desc: 'Internet service provider — backbone traffic' },
  { key: 'retail',     id: 'org_retail_5',      label: 'Retail',     icon: '🛒', net: '172.31.0.0/24',   color: '#ec4899', desc: 'Retail POS network — e-commerce flows' },
]

export default function FLServerPage() {
  const [state, setState] = useState<FLServerState | null>(null)
  const [busy,  setBusy]  = useState(false)

  const refresh = useCallback(async () => {
    try { setState(await api.getFLState()) }
    catch { /* API starting */ }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const runFL = async () => {
    setBusy(true)
    try {
      const res = await api.runFLSimulation()
      setState(res.state)
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div style={{ padding: '3rem', color: T.dim, textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚙️</div>
        <div>Loading FL Server Console…</div>
      </div>
    )
  }

  const runColor = state.fl_running ? T.yellow : state.fl_done ? T.green : T.dim
  const readinessMap = new Map(state.orgs.map(o => [o.key, o]))

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #0c1828 0%, #080f1e 100%)',
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: '0.9rem 1.3rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.75rem',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, transparent, #58d1e8, #388bfd, transparent)',
        }} />
        <div>
          <span style={{ fontSize: '1.4em', fontWeight: 800, color: T.cyan }}>⚙️ FL Server Console</span>
          <span style={{ color: T.dim, marginLeft: '0.8em', fontSize: '0.8em' }}>
            FLTrust-Aggregated · Blockchain-Audited · 5 Federation Clients
          </span>
        </div>
        <div>
          <span style={{ color: runColor, fontWeight: 700 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              backgroundColor: runColor, marginRight: 5,
              animation: state.fl_running ? 'blink-dot 1s infinite' : 'none',
            }} />
            {state.run_state}
          </span>
          <span style={{ color: T.dim, marginLeft: '1em', fontSize: '0.76em' }}>
            Round {state.current_round}/{state.total_rounds}
          </span>
        </div>
      </div>

      {/* ── Metrics ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          ['Rounds Done',    `${state.current_round} / ${state.total_rounds}`, T.cyan],
          ['FLTrust Trusted', state.fl_done ? '5 / 5' : '— / 5',             T.green],
          ['Global Version', state.global_version ?? '—',                     T.purple],
          ['Status',         state.run_state,                                  runColor],
        ].map(([label, val, col]) => (
          <div key={String(label)} style={{
            background: T.panel, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.68rem', color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              {label}
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: String(col), marginTop: '0.3rem' }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '0.75rem 0' }} />

      {/* ── 5 Org Client Cards ───────────────────────────────────────────── */}
      <h4 style={{ color: T.green, marginBottom: '0.6rem', fontSize: '0.88rem', fontWeight: 700 }}>
        📡 Federation Clients — Node Readiness ({FL_CLIENTS.length} Orgs)
      </h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.7rem', marginBottom: '1rem' }}>
        {FL_CLIENTS.map((cl) => {
          const orgData = readinessMap.get(cl.key)
          const isReady = orgData?.ready ?? false
          const isAttacked = orgData?.under_attack ?? false
          const isByzantine = state.byzantine_org === cl.id
          const isQuarantined = state.quarantined_orgs?.includes(cl.id)
          const cardState = isAttacked || isByzantine ? 'danger' : isReady ? 'ready' : 'idle'
          const borderCol = cardState === 'danger' ? '#f85149' : cardState === 'ready' ? cl.color : T.border

          return (
            <div key={cl.key} style={{
              background: `linear-gradient(145deg, ${T.panel} 0%, #0b1220 100%)`,
              border: `1px solid ${borderCol}`,
              borderRadius: 12,
              padding: '0.85rem 0.9rem',
              transition: 'box-shadow 0.2s',
              boxShadow: cardState !== 'idle' ? `0 0 16px ${borderCol}33` : 'none',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Accent top bar */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: borderCol,
                opacity: cardState === 'idle' ? 0.3 : 0.8,
              }} />

              {/* Org identity */}
              <div style={{ fontSize: '1.4em', marginBottom: '0.3rem' }}>{cl.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: T.text }}>{cl.label}</div>
              <div style={{ fontSize: '0.68rem', color: T.dim, marginTop: '0.15rem', fontFamily: 'monospace' }}>
                {cl.net}
              </div>

              {/* Status badge */}
              <div style={{
                marginTop: '0.5rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: cardState === 'danger' ? '#f85149' : cardState === 'ready' ? cl.color : T.dim,
                display: 'flex',
                alignItems: 'center',
                gap: '0.3em',
              }}>
                {isAttacked || isByzantine ? '🚨 QUARANTINED' :
                 isReady ? '✅ READY' : '⏸ IDLE'}
              </div>

              {/* Byzantine badge */}
              {isByzantine && (
                <div style={{
                  marginTop: '0.35rem', fontSize: '0.65rem', fontWeight: 700,
                  color: '#f85149', background: '#f8514920', borderRadius: 4,
                  padding: '2px 5px', display: 'inline-block',
                }}>
                  ⚠ BYZANTINE
                </div>
              )}

              {/* Description */}
              <div style={{
                fontSize: '0.64rem', color: T.dim, marginTop: '0.4rem',
                lineHeight: 1.4, opacity: 0.75,
              }}>
                {cl.desc}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <h4 style={{ color: T.cyan, marginBottom: '0.5rem', fontSize: '0.88rem', fontWeight: 700 }}>
        🔄 Aggregation Pipeline
      </h4>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${state.pipe_steps.length}, 1fr)`,
        gap: '0.5rem',
        marginBottom: '1rem',
      }}>
        {state.pipe_steps.map((step, i) => {
          const done    = step.state === 2
          const active  = step.state === 1
          return (
            <div key={i} style={{
              background: done ? '#0f2117' : active ? '#1a2a38' : T.panel,
              border: `1px solid ${done ? T.green : active ? T.cyan : T.border}`,
              borderRadius: 10,
              padding: '0.6rem 0.5rem',
              textAlign: 'center',
              fontSize: '0.76em',
              opacity: (!done && !active) ? 0.45 : 1,
              transition: 'all 0.3s',
              boxShadow: done ? `0 0 10px ${T.green}33` : active ? `0 0 10px ${T.cyan}33` : 'none',
            }}>
              <div style={{ fontSize: '1.3em', marginBottom: '0.2rem' }}>{step.icon}</div>
              <div style={{
                whiteSpace: 'pre-line',
                color: done ? T.green : active ? T.cyan : T.dim,
                fontWeight: done || active ? 600 : 400,
              }}>
                {step.label}
              </div>
              {done && <div style={{ fontSize: '0.65em', color: T.green, marginTop: '0.2rem' }}>✓ Done</div>}
              {active && <div style={{ fontSize: '0.65em', color: T.cyan, marginTop: '0.2rem' }}>▶ Active</div>}
            </div>
          )
        })}
      </div>

      {/* ── Run Button ───────────────────────────────────────────────────── */}
      <button
        style={{
          width: '100%', marginBottom: '1rem',
          padding: '0.7rem',
          borderRadius: 10,
          border: `1px solid ${T.cyan}`,
          background: state.fl_running ? 'rgba(88,209,232,0.05)' : 'rgba(88,209,232,0.08)',
          color: T.cyan,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          fontSize: '0.9rem',
          cursor: busy || state.fl_running ? 'not-allowed' : 'pointer',
          opacity: busy || state.fl_running ? 0.6 : 1,
          transition: 'all 0.2s',
        }}
        disabled={busy || state.fl_running}
        onClick={runFL}
      >
        {state.fl_running ? '⏳ FL Running across 5 clients…' : '🚀 Start FL Simulation (5 Clients)'}
      </button>

      {/* ── Hash + Log ───────────────────────────────────────────────────── */}
      {state.global_hash && (
        <div style={{
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: '0.7rem 1rem', marginBottom: '1rem',
          fontFamily: 'monospace', fontSize: '0.76rem',
        }}>
          <span style={{ color: T.dim }}>Global hash: </span>
          <span style={{ color: T.purple }}>{state.global_hash}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Hash Ledger */}
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: '1rem' }}>
          <h4 style={{ color: T.purple, fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 700 }}>⛓ Hash Ledger</h4>
          {state.hash_ledger.length === 0 ? (
            <span style={{ color: T.dim, fontSize: '0.78rem' }}>No hashes minted yet.</span>
          ) : state.hash_ledger.map((e, i) => (
            <div key={i} style={{
              borderLeft: `3px solid ${T.purple}`,
              padding: '0.35rem 0.6rem',
              margin: '0.25rem 0',
              fontSize: '0.73em',
              fontFamily: 'monospace',
              color: T.text,
            }}>
              R{e.round} {e.version}: <span style={{ color: T.purple }}>{e.hash.slice(0, 28)}…</span>
              {' @ '}<span style={{ color: T.dim }}>{e.time}</span>
            </div>
          ))}
        </div>

        {/* FL Log */}
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: '1rem' }}>
          <h4 style={{ color: T.dim, fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 700 }}>📋 FL Log</h4>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {state.fl_log.length === 0 ? (
              <span style={{ color: T.dim, fontSize: '0.78rem' }}>Waiting for FL run…</span>
            ) : state.fl_log.map((line, i) => (
              <div key={i} style={{
                color: line.includes('✅') ? T.green :
                       line.includes('❌') ? '#f85149' :
                       line.includes('Round') ? T.cyan : T.dim,
                fontSize: '0.74em',
                fontFamily: 'monospace',
                padding: '0.2rem 0',
                borderBottom: `1px solid ${T.border}44`,
              }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
