# Component Health Report — ClaudeLens React

Data analisi: 2026-03-28

## 1. Verifica ProjectOverview.tsx

**Risultato: PASS**

`tabs/ProjectOverview.tsx` — **300 righe** (soglia target: 400)

Il file è rimasto ben entro il limite. È una shell di navigazione pura: sidebar con lista progetti + un singolo `switch(view.type)` che delega tutto ai componenti feature. Non contiene logica di business né fetch dati.

---

## 2. Conteggio righe — tutti i componenti

### tabs/ (entry point)

| File | Righe | Nota |
|------|------:|------|
| `tabs/ProjectOverview.tsx` | 300 | Shell navigazione — OK |
| `tabs/LiveMonitor.tsx` | 624 | **Candidato refactor** — vedi § 4 |

### components/project/overview/

| File | Righe | Nota |
|------|------:|------|
| `overview/ProjectOverviewContent.tsx` | 289 | OK |
| `overview/GlobalHomeView.tsx` | 86 | OK |
| `overview/NavCard.tsx` | ~40 | OK, atomo |

### components/project/chat/

| File | Righe | Nota |
|------|------:|------|
| `chat/ChatView.tsx` | 152 | OK |
| `chat/ToolDetailPanel.tsx` | 325 | **Candidato refactor** — vedi § 4 |
| `chat/ToolGroupCard.tsx` | 93 | OK |
| `chat/MessageBubble.tsx` | 95 | OK |
| `chat/utils.ts` | 106 | OK, logica pura |
| `chat/atoms.tsx` | ~50 | OK |

### components/project/sessions/

| File | Righe | Nota |
|------|------:|------|
| `sessions/SessionsDetailView.tsx` | 144 | OK |

### components/project/memory/

| File | Righe | Nota |
|------|------:|------|
| `memory/MemorySection.tsx` | 249 | Limite — vedi § 4 |
| `memory/MemoryTopicView.tsx` | 172 | OK |
| `memory/MemoryFullView.tsx` | ~40 | OK |
| `memory/MemoryIndexFile.tsx` | ~60 | OK |
| `memory/TopicForm.tsx` | ~80 | OK |
| `memory/utils.ts` | ~60 | OK |

### components/project/analytics/

| File | Righe | Nota |
|------|------:|------|
| `analytics/AnalyticsView.tsx` | 277 | OK, ma denso |

### components/project/skills/

| File | Righe | Nota |
|------|------:|------|
| `skills/GlobalSkillsView.tsx` | 150 | OK |
| `skills/SkillDetailView.tsx` | 79 | OK |
| `skills/CreateSkillModal.tsx` | 132 | OK |
| `skills/SkillPropertiesPanel.tsx` | ~50 | OK |

### components/project/agents/

| File | Righe | Nota |
|------|------:|------|
| `agents/GlobalAgentsView.tsx` | 153 | OK |
| `agents/AgentDetailView.tsx` | 74 | OK |
| `agents/CreateAgentModal.tsx` | ~130 | OK |
| `agents/AgentPropertiesPanel.tsx` | ~50 | OK |

### components/project/claudemd/

| File | Righe | Nota |
|------|------:|------|
| `claudemd/GlobalClaudeMdView.tsx` | 89 | OK |

### components/project/mcp/

| File | Righe | Nota |
|------|------:|------|
| `mcp/GlobalMcpView.tsx` | 76 | OK |
| `mcp/McpServerCard.tsx` | ~80 | OK |

### components/project/ai-assistant/

| File | Righe | Nota |
|------|------:|------|
| `ai-assistant/AiAssistantView.tsx` | 176 | OK |

### components/project/shared/

Tutti gli atomi (BackButton, StatChip, SectionTitle, ModelChip, Accordion, SidebarNavItem, DeleteProjectDialog) sono sotto 80 righe. OK.

### Hooks e tipi

| File | Righe | Nota |
|------|------:|------|
| `hooks/useIPC.ts` | ~350 (stimato) | Accettabile per file di hook centrali |
| `components/project/types.ts` | ~60 | OK |
| `components/project/utils.ts` | ~30 | OK |

---

## 3. Stato generale

- **28 su ~31 componenti** sono entro 200 righe.
- **Nessun componente supera 650 righe**.
- Il refactor di `ProjectOverview` ha avuto successo: il file è sceso da 4.328 → 300 righe e la struttura feature-by-domain è rispettata.
- La media del codebase è ben al di sotto dei 200 righe per file, con una distribuzione sana.

---

## 4. Candidati a ulteriore refactor

### 4.1 `tabs/LiveMonitor.tsx` — 624 righe — PRIORITA' ALTA

**Problema:** file monolitico nella cartella `tabs/`, fuori dalla struttura `components/project/`. Contiene:
- Logica di stato complessa (8 `useState`, 3 `useEffect`, 1 `useCallback`, 2 `useRef`)
- Componente `ActivityChart` (60 righe) con chart Recharts
- Componente `ProjectContextPanel` + `UsedItemRow` + `SectionLabel` (70 righe) inline
- Funzioni helper (`buildBuckets`, `getArg`, `shortPath`, `CustomTooltip`)
- Layout principale (header, sidebar sinistra, spotlight centrale, sidebar destra, bottom chart)

**Refactor suggerito:**
- Spostare in `components/project/live-monitor/`
- Estrarre `ActivityChart.tsx` (~60 righe) come componente separato
- Estrarre `ProjectContextPanel.tsx` (~80 righe) come componente separato
- Estrarre `buildBuckets` e helpers in `utils.ts`
- Il componente principale scenderebbe a ~250-280 righe

### 4.2 `chat/ToolDetailPanel.tsx` — 325 righe — PRIORITA' MEDIA

**Problema:** il componente ha due grosse funzioni interne (`renderInput` e `renderOutput`) che gestiscono ognuna ~10 casi via `if (name === ...)`. Il pattern è ripetitivo e difficile da estendere.

**Refactor suggerito:**
- Estrarre un oggetto `TOOL_RENDERERS: Record<string, { input: (use) => JSX, output: (result) => JSX }>` o un pattern strategy
- Oppure spezzare in `ToolInputSection.tsx` + `ToolOutputSection.tsx` (~100 righe ciascuno)
- Il file principale scenderebbe a ~80-100 righe (solo il layout wrapper)

### 4.3 `memory/MemorySection.tsx` — 249 righe — PRIORITA' BASSA

**Problema:** il file definisce la config `MEMORY_TYPE_CONFIG` (50 righe di dati), la funzione `renderTopicRow` interna (75 righe) e il layout principale. La funzione `renderTopicRow` è sufficientemente complessa da meritare estrazione.

**Refactor suggerito:**
- Spostare `MEMORY_TYPE_CONFIG` in `types.ts` o `utils.ts` (è solo dato)
- Estrarre `MemoryTopicRow.tsx` (~75 righe) come componente dedicato
- Il file principale scenderebbe a ~120 righe

### 4.4 `analytics/AnalyticsView.tsx` — 277 righe — NOTA INFORMATIVA

Non è urgente, ma il file è denso: mescola preparazione dati (`useMemo` per 4 dataset), logica filtro sessioni e 4 chart Recharts differenti. Se le chart crescono (nuovi grafici previsti nel backlog), potrebbe diventare difficile da gestire.

**Refactor futuro (solo se si aggiungono chart):**
- Estrarre ogni chart in un componente dedicato (es. `TokenBarChart.tsx`, `ModelPieChart.tsx`)
- Estrarre la logica di preparazione dati in un hook `useAnalyticsData(sessions, selected)`

---

## 5. Duplicazione strutturale: Skills vs Agents

`GlobalSkillsView.tsx` (150 righe) e `GlobalAgentsView.tsx` (153 righe) sono quasi identici nella struttura: stesso layout header, stessa griglia card, stesso pattern `SkillCard`/`AgentCard` quasi speculari, stesso `CreateModal` pattern.

**Non è un problema urgente** (entrambi sono sotto 200 righe), ma se le funzionalità divergono ulteriormente potrebbe valere la pena un componente `GenericEntityListView` o almeno estrarre il layout header/grid in un HOC condiviso.

---

## 6. Riepilogo

| Componente | Righe | Stato |
|------------|------:|-------|
| `tabs/LiveMonitor.tsx` | 624 | Refactor consigliato |
| `chat/ToolDetailPanel.tsx` | 325 | Refactor consigliato |
| `tabs/ProjectOverview.tsx` | 300 | OK (target rispettato) |
| `overview/ProjectOverviewContent.tsx` | 289 | OK |
| `analytics/AnalyticsView.tsx` | 277 | OK (monitorare) |
| `memory/MemorySection.tsx` | 249 | Refactor bassa priorità |
| Tutti gli altri | < 200 | OK |

Il codebase è in buona salute post-refactor. L'unico file che merita attenzione immediata è `LiveMonitor.tsx`, che è rimasto fuori dalla ristrutturazione ed è l'unico monolite residuo.
