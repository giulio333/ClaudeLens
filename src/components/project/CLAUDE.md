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
| `ModelChip.tsx` | `ModelChip`, `ModelUsageBadge` | Badge modello singolo con fill proporzionale; badge distribuzione multi-modello |
| `SectionTitle.tsx` | `SectionTitle` | Titolo sezione con divider orizzontale e slot opzionale per action |
| `BackButton.tsx` | `BackButton` | Bottone freccia indietro con label |
| `StatChip.tsx` | `StatChip` | Chip label + valore, variante accent indigo |
| `Accordion.tsx` | `Accordion` | Accordion espandibile con badge scope opzionale |

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

### `sessions/` — Lista sessioni
| File | Esporta | Descrizione |
|---|---|---|
| `SessionsDetailView.tsx` | `SessionsDetailView` | Lista tutte le sessioni di un progetto con barre visuali token/costo; click → `onOpenChat` |

---

### `memory/` — Gestione memoria Claude
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `extractHeadings`, `parseMemoryContent`, `readingTime`, `formatDate`, `SidebarLabel`, `SidebarRow` | Parser markdown per TOC + metadata topic; helper UI sidebar |
| `MemoryTopicView.tsx` | `MemoryTopicView` | Vista singolo topic: tab View/Raw, sidebar metadata, TOC |
| `MemoryIndexFile.tsx` | `MemoryIndexFile` | Accordion per `MEMORY.md` con progress bar entries |
| `TopicForm.tsx` | `TopicForm` | Form create/edit topic: nome, tipo, descrizione, contenuto |
| `MemorySection.tsx` | `MemorySection` | Lista topic + `TopicForm` inline + `MemoryIndexFile` |
| `MemoryFullView.tsx` | `MemoryFullView` | Wrapper con breadcrumb per la vista memoria di un progetto |

**Mutations:** `useCreateTopic`, `useUpdateTopic`, `useDeleteTopic` sono chiamati dentro `MemorySection` e `TopicForm`, non nel root.

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
| `CreateSkillModal.tsx` | `CreateSkillModal` | Modal per creare una nuova skill globale |
| `GlobalSkillsView.tsx` | `GlobalSkillsView` | Lista skill globali con ricerca e navigazione al detail |

---

### `agents/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentPropertiesPanel.tsx` | `AgentPropertiesPanel` | Pannello proprietà agent in sola lettura |
| `AgentDetailView.tsx` | `AgentDetailView` | Vista dettaglio singolo agent |
| `CreateAgentModal.tsx` | `CreateAgentModal` | Modal per creare un nuovo agent globale |
| `GlobalAgentsView.tsx` | `GlobalAgentsView` | Lista agent globali |

---

### `mcp/`
| File | Esporta | Descrizione |
|---|---|---|
| `McpServerCard.tsx` | `McpServerCard`, `mcpServiceColor` | Card singolo MCP server con stato enabled/disabled; colori brand per servizi noti |
| `GlobalMcpView.tsx` | `GlobalMcpView` | Vista lista MCP server (cloud + local) |

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

### `overview/`
| File | Esporta | Descrizione |
|---|---|---|
| `NavCard.tsx` | `NavCard` | Card navigazione con icona, stat principale e sottotitolo |
| `ProjectOverviewContent.tsx` | `ProjectOverviewContent` | Vista overview di un progetto: header metriche + 4 NavCard (memoria, sessioni, CLAUDE.md, analytics) |

---

## Convenzioni

- **Navigation:** ogni componente riceve `onNavigate(v: View)` e/o `onBack()` come callback — non gestisce stato di navigazione proprio
- **Data fetching:** tutti gli hook da `../../hooks/useIPC`; React Query gestisce cache e invalidazione
- **Styling:** Tailwind CSS; palette zinc/indigo/emerald/amber/violet; dark mode fisso (`#0d0f14` background)
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
