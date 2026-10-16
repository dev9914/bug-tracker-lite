# Task 2 — Technical Proposal: Production Monitoring for an Automotive Plant

*Simulated meeting notes + proposal. Assignment requirements are stated plainly; items
marked **(assumption)** or **(proposed)** need stakeholder confirmation.*

## 1. Simulated meeting notes

**Date:** discovery workshop. **Attendees (roles):** Plant Head, Maintenance Lead, Quality
Manager, IT/OT Engineer, Solution Architect (author). **Agenda:** current pain points,
monitoring scope, systems to integrate, phasing.

**Discussion and outcomes.** The plant loses output to unplanned stops that are noticed late
and diagnosed manually, and quality drift is caught only after rejects. Attendees agreed the
first goal is **faster detection and a clearer signal**, not advanced analytics. IT stated
that nothing may write back into the control network. **Decisions taken:** monitor
**read-only**; start with a **single-line pilot**; integrate through a **bus**, never
point-to-point; keep **raw and derived** data separate. Thresholds, phase-1 scope and
retention were parked for the questions in §9.

## 2. Goals, requirements and assumptions

- **G1 Reduce unplanned downtime** — detect/alert abnormal stops within minutes; track MTTR and MTBF per station. *(assignment)*
- **G2 Protect output and OEE** — availability/performance/quality by line and shift. *(assignment; exact KPIs = assumption)*
- **G3 Catch quality drift** — alert before out-of-spec parts are produced. *(assignment)*
- **G4 Traceability** — link a unit/batch to machine, station, shift and operator. *(assignment; unit- vs batch-level = assumption)*
- **G5 Actionable, not noisy** — alerts routed to the right role, clear severity, no alert storms. *(proposed)*
- **G6 Historical analysis** — retain history for trends, shift reports and audit. *(proposed)*

*Deliverable (assignment):* a technical proposal covering architecture, data flow,
sensors/gateways, metrics/logs/traces/alerts, integration with plant systems,
availability/security/retention, and a phased plan with risks and open questions.

## 3. Monitoring architecture and data flow

```
[Machines / PLCs / robots / sensors]
      │  OPC UA / Modbus TCP / Profinet / EtherNet/IP (digital & analog IO)
      ▼
[Edge gateway per line]  buffer-on-disconnect, filtering, protocol normalization
      │  MQTT/TLS (or OPC UA) over the plant network
      ▼
[Plant broker / ingestion]  store-and-forward, ordering, dedup
      ├──▶ [Time-series store] ─▶ [Dashboards & alert engine] ─▶ email / SMS / Teams
      ├──▶ [Log pipeline]      ─▶ [Log store + search]
      └──▶ [Integration bus]   ─▶ ERP / MES / QMS / CMMS
```

**Data flow:** machine signal → edge gateway (normalize, buffer, timestamp) → broker →
time-series store → rule/alert engine → dashboard and notification, with a parallel path to
ERP/MES/QMS for business context.

**Key decisions:** *edge-first* — gateways buffer and replay on reconnect, so a network or
cloud outage never loses production data. *One normalized tag model*
(`line.station.machine.signal`) keeps rules and dashboards vendor-agnostic. *Store raw +
derived* — raw signals for drill-down, computed KPIs for fast queries. *Loose coupling* —
monitoring is **read-only** on the control network and never writes to PLCs.

## 4. Sensors, gateways, connectivity, platform

- **Signals:** vibration, temperature, pressure, flow, torque/current, cycle/part counters, vision inspection results, PLC state bits. *(which exist per line = assumption)*
- **Gateways:** one industrial edge device per line/group, speaking machine protocols and publishing MQTT/TLS upstream; local buffering, store-and-forward, watchdogs, remote update and a hardened OS.
- **Connectivity:** wired industrial Ethernet in-plant where possible; segmented OT/IT network (§6); cellular/redundant links only where cabling is impractical.
- **Platform:** broker/ingestion; time-series DB for tags; rule/alert engine (threshold, rate-of-change, state) with dedup and flapping suppression; dashboards; API/bus connectors; RBAC for operator/supervisor/maintenance/IT.

## 5. Metrics, logs, traces, alerts, dashboards and reporting

**Metrics:** uptime and unplanned-stop count/duration per line/station; OEE and its three
factors; throughput vs target and cycle time vs standard; first-pass yield, scrap/rework,
out-of-spec counts; MTTR, MTBF, time-to-first-response; infrastructure health (gateway
online, message backlog, ingestion lag). **Logs:** gateway connects, PLC/comms errors, config
changes, operator overrides, alert lifecycle. **Traces:** follow a KPI/event from ingestion to
dashboard/ERP on the integration path (machine control loops are not traced — that is the PLC).

**Tiered alerts** (rules must use **dedup, hysteresis and grouping** — one incident per line,
not per sensor; alarm fatigue is the biggest practical risk):

| Severity | Example | Routing |
| --- | --- | --- |
| P1 Critical | Line down; inspection/safety failure; gateway offline > 5 min | Supervisor + maintenance on-call (SMS/Teams), immediate |
| P2 Major | Quality param out of band; throughput below threshold for N min | Line supervisor, same shift |
| P3 Warning | Degrading vibration/temperature; minor comms retries | Maintenance queue, scheduled |

**Dashboards and reporting:** live Andon per line (green/amber/red), OEE per shift, downtime
Pareto and quality trend — each aimed at the person who acts on it — plus scheduled **shift
and daily reports** for supervisors and management (downtime, OEE, quality, top losses).
**Incident response:** fire → route by severity → acknowledge (stops re-paging) → contain →
resolve → post-incident review that records root cause and, where possible, becomes a
preventive rule or a CMMS task.

## 6. Integration with existing plant systems

- **MES** — exchange production orders, WIP status and unit/batch results so KPIs match MES.
- **ERP** — push production confirmations and downtime/cost; pull material/order context to attribute a stop.
- **QMS** — push inspection results and out-of-spec events; pull spec limits used by alert rules.
- **CMMS** — auto-raise a maintenance ticket from a P1/P3 alert.
- **Historian/SCADA** — read-only, to avoid duplicating high-frequency capture where it exists.

**Principles:** integrate through an API/bus with versioned contracts; never write back into
control systems; use business identifiers (line, station, product, order) as shared keys.

## 7. Availability, security, access control, retention

- **Availability:** edge buffering + redundant ingestion; a cloud outage degrades dashboards but never stops production; target 99.9% dashboard availability during shifts *(assumption)*.
- **Security:** read-only control-network access; **OT/IT segmentation** (firewall/DMZ, only required one-way flows); TLS gateway→broker; no inbound access to PLCs; signed gateway images; least-privilege service accounts.
- **Access control:** RBAC by role (operator = line view; supervisor = line + shift reports; maintenance = asset health; IT = platform admin), SSO where available, and an audit trail of logins, config changes and alert acknowledgements.
- **Retention:** raw signals short-term (e.g. 30–90 days); aggregated KPIs and alerts longer (e.g. 1–3 years). *(values = assumption)*
- **Network reliability:** monitor link quality and gateway heartbeat; show an explicit "data is stale" indicator so nobody trusts a frozen number.

## 8. Development approach, phasing and testing

**Approach:** iterative and pilot-first — prove the tag model, KPIs and alert rules on one
real line before standardizing across the plant.

| Phase | Scope | Outcome |
| --- | --- | --- |
| 0 Discovery | Lines, protocols, systems, KPIs, network | Agreed tag list, KPIs, integration map |
| 1 Pilot | One line: gateway → broker → time-series → dashboard + 3–5 alerts | Proven end-to-end on real data |
| 2 Rollout | Remaining lines; standard gateway config; Andon + OEE | Plant-wide live visibility |
| 3 Integrate | MES/ERP/QMS/CMMS connectors; alarm lifecycle; audit trail | Business-context-aware monitoring |
| 4 Optimize | Predictive maintenance, shift reports, tuning | Fewer stops, less alarm noise |

**Testing:** replay simulated tag/sensor data to validate rules and dashboards; verify
gateway buffer-and-replay by disconnecting the link; test alert routing, dedup and
acknowledgement; rehearse ingestion failover; validate each integration with recorded
contract samples before cutover.

## 9. Recommendations, risks and open questions

**Recommendations:** start with the pilot line and a small, high-value alert set; agree KPIs
and thresholds with stakeholders **before** writing rules; enforce a single edge tagging
standard; segment OT/IT from day one; keep monitoring read-only on the control network.

**Risks / trade-offs:** alarm fatigue if rules are not grouped (mitigated by hysteresis and
severity tiers, at the cost of slightly slower first detection); OT/IT segmentation slows
integration (deliberate — security over convenience); edge-box sprawl (standardize on one
gateway platform); cloud vs on-prem (a hybrid — edge buffering + cloud analytics — is
proposed); data-model drift across vendors (solved by an upfront tagging standard).

**Open questions:** (1) Which lines/stations are phase 1, and which KPIs are official
targets? (2) Unit-level or batch-level traceability — and does MES already hold it? (3)
Current PLC/SCADA/historian vendors and interfaces? (4) Agreed thresholds, and who owns each
severity? (5) Retention periods required by quality and finance? (6) Cloud, on-prem or
hybrid — any constraint on sending plant data off-site? (7) Who staffs alert response per
shift? (8) Which MES/ERP/CMMS integrate first, and who owns them?
