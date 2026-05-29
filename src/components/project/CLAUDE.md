# components/project/ — Feature components di ClaudeLens

Tutti i componenti UI del progetto ClaudeLens, organizzati per dominio funzionale. Sono consumati da `tabs/ProjectOverview.tsx`, che funge da shell di navigazione.

## Fondamenta

### `types.ts`
- `View` — discriminated union con tutti i tipi di vista navigabili (15 casi)
- `TYPE_STYLES` — classi Tailwind per i badge dei topic di memoria (`user`, `feedback`, `project`, `reference`)
- `SCOPE_STYLES` — classi Tailwind per i badge di scope CLAUDE.md (`global`, `project`, `local`, `subdir`)

> Quando si aggiunge una nuova vista, aggiungere prima il caso qui, poi il `case` nello switch di `ProjectOverview.tsx`.

### `utils.ts`
Formatter puri (nessuna dipendenza React):
- `fmt(n)` — numero con separatori migliaia
- `fmtCost(n)` — costo in dollari (`$0.0042`)
- `fmtDate(d)` — data localizzata `it-IT`
- `fmtModel(m)` — ID modello → nome leggibile (`claude-sonnet-4-6` → `Sonnet 4.6`)
- `modelColor(m)` — colore hex accent per famiglia modello

---

## Struttura per dominio

### `shared/` — Atomi UI riutilizzabili
| File | Esporta | Descrizione |
|---|---|---|
| `BackButton.tsx` | `BackButton` | Bottone freccia indietro con label |
| `StatChip.tsx` | `StatChip` | Chip label + valore, variante accent indigo |
| `TopBar.tsx` | `TopBar`, `Crumb` | Top bar editoriale condivisa (52px, drag region, back + breadcrumbs + right slot) |
| `CreateFormKit.tsx` | `ModelPicker`, `ToolsInput`, `FieldHint`, `CharCounter`, `openDocs`, `validateName`, `useCreateFormKeys`, `MODEL_PRESETS`, `KNOWN_TOOLS`, `NAME_MAX`, `DESC_MAX`, `NAME_RE` | Building blocks condivisi per le pagine "create" (skill, agent): picker modello accent-aware, autocomplete tools, hint, counter, validazione nome, hook keybinding (⌘↵/Esc) |

---

### `chat/` — Rendering sessioni chat
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `buildProcessedMessages`, `resolveToolIcon`, `stripLineNumbers`, `fileExt`, `parseMemoryFrontmatter`, tipi `ToolGroup`, `ProcessedMessage`, `ChatDetailsFilter` | Pre-processing messaggi raw: abbina `tool_use` + `tool_result` per ID; rimuove messaggi utente con soli tool_result |
| `atoms.tsx` | `PathChip`, `SectionLabel`, `CodeBlock` | UI atoms per il rendering degli input/output tool |
| `ToolDetailPanel.tsx` | `ToolDetailPanel` | Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria |
| `ToolGroupCard.tsx` | `ToolGroupCard` | Card compatta che mostra una coppia `tool_use` + `tool_result` |
| `MessageBubble.tsx` | `ThinkingBlock`, `MessageBubble` | Singolo messaggio con testo, thinking espandibile, tool cards |
| `ChatView.tsx` | `ChatView` | Vista completa chat: header stats, filtro minimal/all, lista messaggi, overlay `ToolDetailPanel` |

**Props navigation pattern:**
```tsx
<ChatView
  project={{ hash, realPath }}
  session={session}
  onBack={() => onNavigate({ type: 'sessions', project })}
/>
```

---

### `memory/` — Gestione memoria Claude
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `extractHeadings`, `parseMemoryContent`, `readingTime`, `formatDate`, `SidebarLabel`, `SidebarRow` | Parser markdown per TOC + metadata topic; helper UI sidebar |
| `MemoryTopicView.tsx` | `MemoryTopicView` | Vista singolo topic: tab View/Raw, sidebar metadata, TOC |

> La lista dei topic della vista `project-memory` è renderizzata da `ProjectView` (`overview/ProjectOverviewContent.tsx`, `section === 'memory'`) con `cl-tile-grid`/`cl-tile`, allineata a Skills/Agents.

---

### `claudemd/`
| File | Esporta | Descrizione |
|---|---|---|
| `GlobalClaudeMdView.tsx` | `GlobalClaudeMdView` | Visualizza la gerarchia di file CLAUDE.md (global → project → local → subdir) con accordion per layer |

---

### `skills/`
| File | Esporta | Descrizione |
|---|---|---|
| `SkillPropertiesPanel.tsx` | `SkillPropertiesPanel` | Pannello proprietà skill in sola lettura |
| `SkillDetailView.tsx` | `SkillDetailView` | Vista dettaglio singola skill con prompt e metadata |
| `CreateSkillPage.tsx` | `CreateSkillPage` | Pagina dedicata per creare una nuova skill (globale o di progetto); on save torna alla lista |
| `GlobalSkillsView.tsx` | `GlobalSkillsView` | Lista skill globali con ricerca e navigazione al detail |

---

### `agents/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentPropertiesPanel.tsx` | `AgentPropertiesPanel` | Pannello proprietà agent in sola lettura |
| `AgentDetailView.tsx` | `AgentDetailView` | Vista dettaglio singolo agent |
| `CreateAgentPage.tsx` | `CreateAgentPage` | Pagina dedicata per creare un nuovo agent (globale o di progetto); on save torna alla lista |
| `GlobalAgentsView.tsx` | `GlobalAgentsView` | Lista agent globali |

---

### `mcp/`
| File | Esporta | Descrizione |
|---|---|---|
| `McpServerCard.tsx` | `McpServerCard`, `mcpServiceColor`, `mcpServiceMeta` | Card singolo MCP server (click → `mcp-detail`); colori brand + registry curato categoria/descrizione per servizi noti |
| `GlobalMcpView.tsx` | `GlobalMcpView` | Vista lista MCP server (cloud + local); `onSelectServer` apre il dettaglio |
| `McpServerDetailView.tsx` | `McpServerDetailView` | Pagina dettaglio singolo server: hero brand, metriche adoption, config locale, liste progetti enabled/disabled |

---

### `analytics/`
| File | Esporta | Descrizione |
|---|---|---|
| `AnalyticsView.tsx` | `AnalyticsView` | Grafici recharts: token stacked bar per giorno, distribuzione modelli pie, messaggi area chart, bucket distribuzione |

---

### `ai-assistant/`
| File | Esporta | Descrizione |
|---|---|---|
| `AiAssistantView.tsx` | `AiAssistantView` | Terminale-like per eseguire istruzioni AI sul progetto; output markdown in streaming via `electronAPI.ai` |

---

### `tasks/`
| File | Esporta | Descrizione |
|---|---|---|
| `TasksSection.tsx` | `TasksSection` | Subtab "Tasks": legge i task creati da Claude (`~/.claude/tasks/{sessionUUID}/*.json`) via `useProjectTasks`, raggruppati per sessione con badge di stato (pending/in_progress/completed). Click sull'header del gruppo → apre la chat della sessione (`onOpenChat`) |

---

### `plans/`
| File | Esporta | Descrizione |
|---|---|---|
| `PlansSection.tsx` | `PlansSection` | Subtab "Plans": legge i piani referenziati negli attachment `plan_mode`/`plan_mode_exit` delle sessioni e ne legge il markdown dal dir globale `~/.claude/plans/*.md` via `useProjectPlans`, raggruppati per sessione con badge `proposed`/`approved`/`deleted`. Click sul piano → `plan-detail`; click sull'header del gruppo → chat della sessione |
| `PlanDetailView.tsx` | `PlanDetailView` | Vista dettaglio singolo piano: render markdown read-only via `MarkdownDocView`, sidebar con status/created/branch/filePath. I piani vivono globali su disco ma sono linkati al progetto via `planFilePath` nei `.jsonl` |

---

### `overview/`
| File | Esporta | Descrizione |
|---|---|---|
| `GlobalHomeView.tsx` | `GlobalHomeView` | Home globale: progetti, panoramica MCP, link a sezioni globali |
| `Lens.tsx` | `Lens` | Componente "lente" usata per inquadrare le metriche/sezioni della overview |
| `ProjectOverviewContent.tsx` | `ProjectOverviewContent` | Vista overview di un progetto: header metriche + sezioni (memoria, sessioni, CLAUDE.md, analytics, mcp) |
| `ProjectSubtabs.tsx` | `ProjectSubtabs` | Subtab di navigazione interna a un progetto |
| `DuplicateProjectsNotice.tsx` | `DuplicateProjectsBadge`, `DuplicateProjectsNotice` | Notice/badge per progetti duplicati (cwd rewrite + merge) |

---

## Convenzioni

- **Navigation:** ogni componente riceve `onNavigate(v: View)` e/o `onBack()` come callback — non gestisce stato di navigazione proprio
- **Data fetching:** tutti gli hook da `../../hooks/useIPC`; React Query gestisce cache e invalidazione
- **Styling:** Tailwind CSS; palette zinc/indigo/emerald/amber/violet; dark mode fisso (`#0d0f14` background)
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
