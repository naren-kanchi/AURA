import type { DashboardState, FLServerState } from './types'

const API = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  // ── Global shared state ─────────────────────────────────────────────────────
  getState: () => request<DashboardState>('/state'),

  // ── Per-client isolated state ────────────────────────────────────────────────
  getClientState: (client: string) =>
    request<DashboardState>(`/client-state?client=${client}`),

  injectClientAttack: (type: string, client: string) =>
    request<{ state: DashboardState }>(`/client-attack/${type}?client=${client}`, { method: 'POST' }),

  injectClientNormal: (client: string) =>
    request<{ state: DashboardState }>(`/client-normal?client=${client}`, { method: 'POST' }),

  clearClientLogs: (client?: string) =>
    request<{ state: DashboardState }>(
      `/client-clear${client ? `?client=${client}` : ''}`,
      { method: 'POST' }
    ),

  getClientsSummary: () =>
    request<{ key: string; label: string; system_status: string; ae_score: number; attack_active: boolean }[]>(
      '/clients/summary'
    ),

  // ── Legacy global attack endpoints (kept for compatibility) ─────────────────
  injectAttack: (type: string) =>
    request<{ state: DashboardState }>(`/attack/${type}`, { method: 'POST' }),
  injectNormal: () => request<{ state: DashboardState }>('/normal', { method: 'POST' }),

  // ── Federation ───────────────────────────────────────────────────────────────
  runFederation: () => request<{ state: DashboardState }>('/federation/run', { method: 'POST' }),

  // ── Blockchain ───────────────────────────────────────────────────────────────
  registerHash: () => request<{ state: DashboardState }>('/blockchain/register', { method: 'POST' }),
  verifyChain: () => request<{ ok: boolean; message: string; entries?: unknown[] }>('/blockchain/verify'),

  // ── Logs ─────────────────────────────────────────────────────────────────────
  clearLogs: () => request<{ state: DashboardState }>('/logs/clear', { method: 'POST' }),

  // ── FL readiness ──────────────────────────────────────────────────────────────
  setFlReady: (ready: boolean) =>
    request<{ state: DashboardState }>('/fl/ready', { method: 'POST', body: JSON.stringify({ ready }) }),
  setUnderAttack: () => request<{ state: DashboardState }>('/fl/under-attack', { method: 'POST' }),
  resolveAttack: () => request<{ state: DashboardState }>('/fl/resolved', { method: 'POST' }),

  // ── Nodes / Custom injection ─────────────────────────────────────────────────
  getNodes: () => request<{ id: string; label: string; critical: boolean }[]>('/nodes'),
  injectCustom: (script: string, target_node: string, attack_type = 'custom') =>
    request<{ state: DashboardState; mse: number }>('/inject_custom', {
      method: 'POST',
      body: JSON.stringify({ script, target_node, attack_type }),
    }),

  // ── FL Server ────────────────────────────────────────────────────────────────
  getFLState: () => request<FLServerState>('/fl-server/state'),
  runFLSimulation: () => request<{ state: FLServerState }>('/fl-server/run', { method: 'POST' }),
}
