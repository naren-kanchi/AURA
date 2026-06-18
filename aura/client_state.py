"""
aura/client_state.py — Per-Client State Isolation
===================================================

Provides a ClientStateStore that holds an independent anomaly timeline,
alert history, and AE explanation for each of the 5 federation clients.

Non-targeted clients continuously produce realistic benign traffic ticks
(low AE scores, green topology) so the dashboard shows proper per-client
isolation: attack a Hospital → only Hospital goes red, Bank/ISP stay green.
"""

from __future__ import annotations

import threading
import time
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import torch
import numpy as np

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config as cfg

logger = logging.getLogger(__name__)

# All 5 federation clients
ALL_CLIENTS = {
    "hospital":   {"label": "Hospital",   "id": "org_hospital_1",  "net": "192.168.1.0/24",  "icon": "H", "color": "#00cc6a"},
    "bank":       {"label": "Bank",       "id": "org_bank_2",       "net": "10.0.1.0/24",    "icon": "B", "color": "#3b82f6"},
    "university": {"label": "University", "id": "org_university_3", "net": "172.16.1.0/24",  "icon": "U", "color": "#a855f7"},
    "isp":        {"label": "ISP",        "id": "org_isp_4",        "net": "10.10.0.0/24",   "icon": "I", "color": "#f59e0b"},
    "retail":     {"label": "Retail",     "id": "org_retail_5",     "net": "172.31.0.0/24",  "icon": "R", "color": "#ec4899"},
}

NORMAL_COLOR  = "#00cc6a"
ATTACK_COLOR  = "#ff4444"
EVAL_COLOR    = "#ffd700"


def _write_fl_readiness(client_key: str, under_attack: bool, attack_type: str = None) -> None:
    """
    Write the current attack state for a client to fl_readiness.json.
    This is the critical bridge between the Operations Dashboard (where attacks
    are injected) and the FL Server Console (which reads this file to quarantine
    clients before starting a federation round).
    """
    try:
        readiness_path = Path(cfg.LOGS_DIR) / "fl_readiness.json"
        readiness_path.parent.mkdir(parents=True, exist_ok=True)
        rd: dict = {}
        if readiness_path.exists():
            try:
                import json
                rd = json.loads(readiness_path.read_text())
            except Exception:
                rd = {}
        entry = dict(rd.get(client_key, {}))
        entry["under_attack"] = under_attack
        entry["org"]          = client_key.capitalize()
        entry["net"]          = ALL_CLIENTS.get(client_key, {}).get("net", "")
        entry["ts"]           = time.time()
        if under_attack:
            entry["ready"]       = False   # force not-ready while quarantined
            entry["attack_type"] = attack_type or "Unknown"
        else:
            # When attack clears, restore ready status so org can rejoin FL
            entry["ready"]       = True
            entry.pop("attack_type", None)
        rd[client_key] = entry
        import json
        readiness_path.write_text(json.dumps(rd, indent=2))
        logger.info(f"[FL-READINESS] {client_key}: under_attack={under_attack}")
    except Exception as e:
        logger.warning(f"[FL-READINESS] Write failed for {client_key}: {e}")

@dataclass
class PerClientState:
    """Isolated state for one federation client."""
    client_key:      str
    ae_scores:       List[float]  = field(default_factory=list)
    thresholds:      List[float]  = field(default_factory=list)
    timestamps:      List[float]  = field(default_factory=list)
    alerts:          List[dict]   = field(default_factory=list)
    incidents:       List[dict]   = field(default_factory=list)
    node_colors:     Dict[int, str] = field(default_factory=dict)
    node_states:     Dict[int, str] = field(default_factory=dict)
    current_graph:   Optional[dict] = None
    last_explanation: Optional[dict] = None
    system_status:   str = "ACTIVE"
    attack_active:   bool = False
    attack_type:     Optional[str] = None
    total_attacks:   int = 0
    total_blocked:   int = 0
    window_counter:  int = 0

    def __post_init__(self):
        N = cfg.NUM_SYNTHETIC_NODES
        self.node_colors = {i: NORMAL_COLOR for i in range(N)}
        self.node_states = {i: "Normal" for i in range(N)}

    def trim(self):
        MAX = 100
        if len(self.ae_scores) > MAX:
            self.ae_scores   = self.ae_scores[-MAX:]
            self.thresholds  = self.thresholds[-MAX:]
            self.timestamps  = self.timestamps[-MAX:]
        if len(self.alerts) > 30:
            self.alerts = self.alerts[:30]
        if len(self.incidents) > 20:
            self.incidents = self.incidents[:20]

    def clear(self):
        N = cfg.NUM_SYNTHETIC_NODES
        self.ae_scores.clear()
        self.thresholds.clear()
        self.timestamps.clear()
        self.alerts.clear()
        self.incidents.clear()
        self.node_colors = {i: NORMAL_COLOR for i in range(N)}
        self.node_states = {i: "Normal" for i in range(N)}
        self.last_explanation = None
        self.system_status = "ACTIVE"
        self.attack_active = False
        self.total_attacks = 0
        self.total_blocked = 0
        self.window_counter = 0

    def to_dict(self) -> dict:
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).parent.parent))
        import config as cfg
        
        nodes = []
        for i in range(cfg.NUM_SYNTHETIC_NODES):
            node_id = f"node_{i}"
            label = cfg.CRITICAL_ALLOWLIST.get(node_id, f"Host-{i:02d}")
            nodes.append({
                "id": node_id,
                "label": label,
                "index": i,
                "critical": node_id in cfg.CRITICAL_ALLOWLIST,
                "color": self.node_colors.get(i, NORMAL_COLOR),
                "state": self.node_states.get(i, "Normal"),
            })
            
        edge_index = None
        if self.current_graph and "edge_index" in self.current_graph:
            ei = self.current_graph["edge_index"]
            if hasattr(ei, "numpy"):
                ei = ei.numpy()
            edge_index = ei[:, : min(ei.shape[1], 60)].tolist()

        return {
            "client_key":    self.client_key,
            "client_info":   ALL_CLIENTS.get(self.client_key, {}),
            "system_status": self.system_status,
            "attack_active": self.attack_active,
            "attack_type":   self.attack_type,
            "nodes":         nodes,
            "edge_index":    edge_index,
            "metrics": {
                "window_counter":  self.window_counter,
                "total_attacks":   self.total_attacks,
                "total_blocked":   self.total_blocked,
                "current_ae_score": round(self.ae_scores[-1] if self.ae_scores else 0.0, 4),
            },
            "timeline": {
                "scores":     self.ae_scores[-60:],
                "thresholds": self.thresholds[-60:],
                "timestamps": self.timestamps[-60:],
            },
            "last_explanation": self.last_explanation,
            "alerts":    self.alerts[:10],
            "incidents": self.incidents[:10],
        }


class ClientStateStore:
    """
    Thread-safe store for all 5 per-client states.

    Wraps a DashboardService-style inference engine and routes inject()
    calls to the correct client, while all other clients produce realistic
    benign traffic in the background.
    """

    _instance: Optional["ClientStateStore"] = None
    _lock = threading.Lock()

    def __init__(self, engine, responder, injector):
        self._rlock    = threading.RLock()
        self.engine    = engine
        self.responder = responder
        self.injector  = injector
        self.states: Dict[str, PerClientState] = {
            k: PerClientState(client_key=k) for k in ALL_CLIENTS
        }
        # Background benign tick thread
        self._bg_running = True
        self._bg_thread  = threading.Thread(target=self._bg_tick, daemon=True)
        self._bg_thread.start()

    @classmethod
    def create(cls, engine, responder, injector) -> "ClientStateStore":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(engine, responder, injector)
        return cls._instance

    @classmethod
    def get(cls) -> Optional["ClientStateStore"]:
        return cls._instance

    def _bg_tick(self):
        """Every 4 seconds, push a benign tick for ALL non-attacked clients."""
        while self._bg_running:
            time.sleep(4)
            with self._rlock:
                for key, cs in self.states.items():
                    if not cs.attack_active:
                        try:
                            self._run_benign_tick(key)
                        except Exception as e:
                            logger.debug(f"[BG-TICK] {key}: {e}")

    def _run_benign_tick(self, client_key: str):
        """Run one normal traffic window for the given client (no alerts expected)."""
        cs = self.states[client_key]
        graph = self.injector._generate_healthy_graph()
        graph["window_id"] = f"NORMAL_{client_key}_{cs.window_counter}"
        from aura.detector import AlertSeverity
        event = self.engine.process(graph)
        cs.ae_scores.append(event.ae_score)
        threshold = event.ae_threshold if event.ae_threshold > 0 else 0.0
        cs.thresholds.append(threshold)
        cs.timestamps.append(event.timestamp)
        cs.window_counter += 1
        # Keep nodes green for benign ticks (even if EMA occasionally fires during warmup)
        N = cfg.NUM_SYNTHETIC_NODES
        cs.node_colors = {i: NORMAL_COLOR for i in range(N)}
        cs.node_states = {i: "Normal" for i in range(N)}
        cs.trim()

    def inject_attack(self, client_key: str, attack_type: str) -> dict:
        """Inject an attack targeted at a specific client."""
        with self._rlock:
            from aura.detector import AlertSeverity
            from aura.ae_explainer import ATTACK_EXPLANATIONS
            cs = self.states[client_key]
            cs.attack_active = True
            cs.attack_type   = attack_type
            cs.system_status = "UNDER ATTACK"

            # ── KEY FIX: notify FL Server Console via shared readiness file ──
            # This quarantines the client BEFORE the next FL round runs,
            # preventing compromised weights from entering the federation.
            _write_fl_readiness(client_key, under_attack=True, attack_type=attack_type)

            attack_graph = self.injector.inject(attack_type)
            event = self.engine.process(attack_graph)

            cs.ae_scores.append(event.ae_score)
            thresh = event.ae_threshold if event.ae_threshold > 0 else 0.0
            cs.thresholds.append(thresh)
            cs.timestamps.append(event.timestamp)
            cs.window_counter += 1

            N = cfg.NUM_SYNTHETIC_NODES
            colors = {i: NORMAL_COLOR for i in range(N)}
            states = {i: "Normal" for i in range(N)}

            if event.severity != AlertSeverity.NORMAL:
                cs.total_attacks += 1
                for nid in event.triggered_nodes:
                    colors[nid] = ATTACK_COLOR
                    states[nid] = f"ALERT {event.severity.name}"
                cs.alerts.insert(0, event.to_dict())
            else:
                # Attack not yet above threshold (still during warmup / low MSE)
                # Mark attack nodes as evaluating
                for nid in attack_graph.get("attack_nodes", []):
                    colors[nid] = EVAL_COLOR
                    states[nid] = "Evaluating..."

            # Always compute AE explanation for attack events regardless of threshold
            if event.inferred_attack and event.inferred_attack != "Normal":
                expl_dict = ATTACK_EXPLANATIONS.get(
                    event.inferred_attack,
                    ATTACK_EXPLANATIONS.get("Unknown Anomaly", {})
                )
                cs.last_explanation = {
                    "inferred_attack": event.inferred_attack,
                    "match_score":     event.match_score,
                    "top_features":    event.top_features,
                    "group_residuals": event.group_residuals,
                    "severity":        event.severity.name,
                    "confidence":      round(event.confidence * 100, 1),
                    "explanation":     expl_dict,
                }
            else:
                # Force-run the explainer on attack edge_attr directly
                try:
                    from aura.ae_explainer import explain_ae, ATTACK_EXPLANATIONS as AE_EXPL
                    edge_attr = attack_graph.get("edge_attr")
                    if edge_attr is not None:
                        feat_res = self.engine.ae.explain_features(edge_attr)
                        expl = explain_ae(feat_res)
                        expl_dict = AE_EXPL.get(
                            expl["inferred_attack"],
                            AE_EXPL.get("Unknown Anomaly", {})
                        )
                        cs.last_explanation = {
                            "inferred_attack": expl["inferred_attack"],
                            "match_score":     expl["match_score"],
                            "top_features":    expl["top_features"],
                            "group_residuals": expl["group_residuals"],
                            "severity":        event.severity.name,
                            "confidence":      round(max(event.confidence, expl["match_score"]) * 100, 1),
                            "explanation":     expl_dict,
                        }
                except Exception as _e:
                    logger.debug(f"[EXPLAINER] {_e}")

            if self.responder and event.severity != AlertSeverity.NORMAL:
                for r in self.responder.act(event):
                    if r.action_taken not in ("LOG_ONLY", "ALREADY_ACTIONED"):
                        cs.total_blocked += 1
                    cs.incidents.insert(0, r.to_dict())

            cs.node_colors = colors
            cs.node_states = states
            cs.current_graph = attack_graph
            cs.trim()
            return {
                "severity":   event.severity.name,
                "confidence": round(event.confidence * 100, 1),
                "label":      attack_type,
            }

    def inject_normal(self, client_key: str):
        """Manually push one normal traffic tick for a client and clear attack state."""
        with self._rlock:
            cs = self.states[client_key]
            cs.attack_active = False
            cs.attack_type   = None
            cs.system_status = "ACTIVE"
            N = cfg.NUM_SYNTHETIC_NODES
            cs.node_colors = {i: NORMAL_COLOR for i in range(N)}
            cs.node_states = {i: "Normal" for i in range(N)}
            # Clear quarantine in FL readiness file so org can rejoin federation
            _write_fl_readiness(client_key, under_attack=False)
            self._run_benign_tick(client_key)

    def clear_client(self, client_key: str):
        with self._rlock:
            self.states[client_key].clear()

    def clear_all(self):
        with self._rlock:
            for cs in self.states.values():
                cs.clear()

    def get_client_state(self, client_key: str) -> dict:
        with self._rlock:
            cs = self.states.get(client_key) or self.states["hospital"]
            return cs.to_dict()

    def get_all_clients_summary(self) -> List[dict]:
        """Return a summary for all clients (for multi-client overview panel)."""
        with self._rlock:
            result = []
            for key, info in ALL_CLIENTS.items():
                cs = self.states[key]
                result.append({
                    "key":           key,
                    "label":         info["label"],
                    "icon":          info["icon"],
                    "net":           info["net"],
                    "color":         info["color"],
                    "system_status": cs.system_status,
                    "attack_active": cs.attack_active,
                    "attack_type":   cs.attack_type,
                    "ae_score":      round(cs.ae_scores[-1] if cs.ae_scores else 0.0, 4),
                    "total_attacks": cs.total_attacks,
                    "window_counter": cs.window_counter,
                })
            return result
