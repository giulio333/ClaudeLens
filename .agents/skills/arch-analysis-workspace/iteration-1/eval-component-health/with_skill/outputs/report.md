# Analisi Salute Componenti React — ClaudeLens

> Data analisi: 2026-03-28
> Scope: `claudelens-app/src/` — tutti i file `.tsx`/`.ts` del renderer

---

## Verifica ProjectOverview.tsx

| Metrica | Valore | Soglia | Stato |
|---|---|---|---|
| Righe attuali | 300 | 400 | OK |
| Righe pre-refactor | ~4.328 | — | — |
| Riduzione | -93% | — | |

`tabs/ProjectOverview.tsx` è ora una thin shell di navigazione da 300 righe. Contiene esclusivamente:
- stato `selected` + `view` (discriminated union `View`)
- sidebar progetto con lista progetti
- `renderMainView()` — switch con 17 case, ciascuno delega a un componente di dominio
- `DeleteProjectDialog`

Il refactor è andato a buon fine: nessuna logica di business rimane nel file, solo navigazione e rendering della sidebar.

---

## Mappa Componenti per Dimensione

### Oltre 200 righe (candidati a refactor)

| File | Righe | Motivo |
|---|---|---|
| `tabs/LiveMonitor.tsx` | 624 | Monolite: logica eventi, chart, rendering UI tutto nello stesso file |
| `components/project/chat/ToolDetailPanel.tsx` | 325 | Rendering specializzato per 10+ tool types diversi |
| `tabs/ProjectOverview.tsx` | 300 | Accettabile: è solo routing/sidebar |
| `components/project/overview/ProjectOverviewContent.tsx` | 289 | Mix di 9 hook IPC + rendering + logica conteggio |
| `components/project/analytics/AnalyticsView.tsx` | 277 | Aggregazioni dati + 4 grafici inline |
| `hooks/useIPC.ts` | 274 | File di hook, struttura accettabile per centralizzazione |
| `components/project/memory/MemorySection.tsx` | 249 | Logica CRUD + renderTopicRow con molte varianti inline |

### 150–200 righe (borderline)

| File | Righe | Note |
|---|---|---|
| `components/project/agents/AgentPropertiesPanel.tsx` | 190 | Dati statici `AGENT_FIELDS` aumentano il conteggio; logica contenuta |
| `components/project/ai-assistant/AiAssistantView.tsx` | 176 | Gestione streaming + UI; struttura già pulita |
| `components/project/memory/MemoryTopicView.tsx` | 172 | Accettabile |
| `components/project/skills/SkillPropertiesPanel.tsx` | 170 | Analogo ad AgentPropertiesPanel |

### Sotto 150 righe (OK)

Tutti gli altri componenti: `ChatView.tsx` (152), `SessionsDetailView.tsx` (144), `GlobalSkillsView.tsx` (150), `CreateAgentModal.tsx` (167), `GlobalAgentsView.tsx` (153), `CreateSkillModal.tsx` (132), `MemoryIndexFile.tsx` (55), `MemoryFullView.tsx` (29), `GlobalHomeView.tsx` (86), `McpServerCard.tsx` (115), e tutti i shared atoms.

---

## Analisi Dettagliata dei Candidati a Refactor

### 1. `tabs/LiveMonitor.tsx` — 624 righe [WARNING]

Il componente più grande del codebase. Contiene internamente:
- `buildBuckets()` — logica di time-bucketing eventi (34 righe)
- `CustomTooltip` — componente tooltip (19 righe)
- `ActivityChart` — componente grafico autonomo (61 righe)
- `getArg()`, `shortPath()` — helper puri (8 righe)
- `SectionLabel`, `UsedItemRow`, `ProjectContextPanel` — UI atoms specifici (69 righe)
- Logica di stato del componente principale con 8 `useState`, 2 `useRef`, 4 `useEffect`
- Il rendering è un layout a 3 colonne + chart in fondo (300+ righe JSX)

**Refactor suggerito:**
- Estrarre `ActivityChart` in `components/project/live/ActivityChart.tsx`
- Estrarre `ProjectContextPanel` + `UsedItemRow` in `components/project/live/ProjectContextPanel.tsx`
- Estrarre la logica di stato (eventi, processi, tool tracking) in un hook custom `useLiveMonitor(projectHash)`
- Spostare il file in `components/project/live/LiveMonitorView.tsx`

Dimensione attesa dopo refactor: ~200 righe per il componente root.

---

### 2. `components/project/chat/ToolDetailPanel.tsx` — 325 righe [WARNING]

Il file gestisce il rendering dettagliato di 10+ tool diversi tramite due funzioni `renderInput()` e `renderOutput()` con catene di `if` per nome tool. Il pattern è corretto ma la lunghezza deriva dalla ripetizione.

**Refactor suggerito:**
- Creare un oggetto `TOOL_RENDERERS: Record<string, { input: (use) => JSX, output: (use, result) => JSX }>` per ogni tool noto
- Ridurrebbe `renderInput` e `renderOutput` a dispatch da 2-3 righe ciascuno
- Alternativa più leggera: estrarre `MemoryToolPanel`, `FileToolPanel`, `BashToolPanel` come renderer separati

---

### 3. `components/project/overview/ProjectOverviewContent.tsx` — 289 righe [WARNING]

Chiama 9 hook IPC al top level (costo, memoria, sessioni, claudeMd, rules, MCP, skills, agentsGlobali, agentsProgetto) e li aggrega per calcolare conteggi. La parte JSX è ben strutturata in sezioni.

**Problema principale:** La logica di aggregazione degli agenti (righe 62-65) e il calcolo `enabledMcp` (righe 67-70) sono inline nel corpo del componente.

**Refactor suggerito (leggero):**
- Estrarre in un hook `useProjectOverviewData(project)` che raggruppa tutti i 9 hook e restituisce i valori derivati già calcolati
- Riduce il componente a ~180 righe con logica di rendering pura

---

### 4. `components/project/analytics/AnalyticsView.tsx` — 277 righe [WARNING]

Contiene `ChartCard` come componente interno (14 righe) e 4 sezioni grafici recharts inline. La logica di data preparation (tokenData, modelTotals, pieData, messagesData, histData) occupa ~30 righe.

**Refactor suggerito (leggero):**
- Estrarre la data preparation in `useMemo` già presenti o in un hook `useAnalyticsData(sessions)`
- Estrarre `ChartCard` in `shared/ChartCard.tsx` (già riutilizzabile)
- Il componente rimarrebbe ~200 righe, accettabile

---

### 5. `components/project/memory/MemorySection.tsx` — 249 righe [WARNING]

Contiene `MEMORY_TYPE_CONFIG` (dati statici, 50 righe) e `renderTopicRow` come funzione interna (76 righe) che gestisce tre stati (view, edit, confirmDelete) con JSX annidata.

**Refactor suggerito:**
- Spostare `MEMORY_TYPE_CONFIG` in `memory/utils.ts` (già esiste)
- Estrarre `TopicRow` come componente separato in `memory/TopicRow.tsx`
- Riduce `MemorySection` a ~130 righe

---

## Riepilogo

| Priorità | Componente | Impatto | Sforzo |
|---|---|---|---|
| Alta | `LiveMonitor.tsx` | -300 righe, migliore testabilità | Alto |
| Media | `MemorySection.tsx` | -100 righe, pulizia logica | Basso |
| Media | `ProjectOverviewContent.tsx` | -100 righe, separation of concerns | Basso |
| Bassa | `ToolDetailPanel.tsx` | -100 righe, manutenibilità | Medio |
| Bassa | `AnalyticsView.tsx` | -50 righe, riuso ChartCard | Basso |

### Componenti già ben strutturati (nessuna azione necessaria)

- `ProjectOverview.tsx` — 300 righe, thin shell corretta
- `GlobalHomeView.tsx` — 86 righe, eccellente
- Tutti i componenti `shared/` — sotto 40 righe ciascuno
- `ChatView.tsx`, `SessionsDetailView.tsx` — dimensioni appropriate
- `AiAssistantView.tsx` — 176 righe, struttura pulita nonostante la complessità streaming
- `AgentPropertiesPanel.tsx` / `SkillPropertiesPanel.tsx` — la lunghezza è giustificata dai dati statici di configurazione

### Conclusione

Il refactor di `ProjectOverview` ha avuto pieno successo: da 4.328 a 300 righe, con tutti i domini correttamente estratti in `components/project/`. L'unica anomalia significativa nel codebase è `LiveMonitor.tsx` (624 righe), che è rimasto un monolite perché non era parte del refactor originale. È il candidato principale per il prossimo ciclo di refactor.
