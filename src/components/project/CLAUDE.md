# components/project/ — Feature components di ClaudeLens

Tutti i componenti UI del progetto ClaudeLens, organizzati per dominio funzionale. Sono consumati da `tabs/ProjectOverview.tsx`, che funge da shell di navigazione.

## Fondamenta

### `types.ts`
- `View` — discriminated union con tutti i tipi di vista navigabili (~27 casi)
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
| `EntityDetailView.tsx` | `EntityDetailView`, `EntityConfig`, `TapeCell` | **Vista detail unificata config-driven** (look "manifesto" stile agent): toggle View/Edit + Save/Discard/Delete/Duplicate/Run nella TopBar, tape/properties grid in view, frontmatter+body editabili. Usata da Agent, Skill, CLAUDE.md, Plan. Edit mono-colonna (`is-single-col`) per le entità senza frontmatter (CLAUDE.md); read-only per Plan |
| `entityOptions.ts` | `OptionDef`, `OptionValue`, `OptionEditor`-data, `AGENT_OPTION_DEFS`, `SKILL_OPTION_DEFS`, `serializeAgent`, `serializeSkill`, `readOptions`, `entityTint`, `initialOf`, `fluidTitleSize`, helper | Logica condivisa per `EntityDetailView`: option defs per agent/skill, serializzazione frontmatter YAML **con preservazione delle chiavi non modellate** (es. `hooks`), tint identità |
| `MarkdownDocView.tsx` | `MarkdownDocView` | Shell markdown semplice (toggle View/Edit nell'hero). Usata **solo da `memory/MemoryTopicView`** |
| `CreateFormKit.tsx` | `ModelPicker`, `ToolsInput`, `FieldHint`, `CharCounter`, `openDocs`, `validateName`, `useCreateFormKeys`, `MODEL_PRESETS`, `KNOWN_TOOLS`, `NAME_MAX`, `DESC_MAX`, `NAME_RE` | Building blocks condivisi per le pagine "create" (skill, agent): picker modello accent-aware, autocomplete tools, hint, counter, validazione nome, hook keybinding (⌘↵/Esc) |

---

### `chat/` — Rendering sessioni chat
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `buildProcessedMessages`, `correlateSessionAgents`, `resolveToolIcon`, `stripLineNumbers`, `fileExt`, `parseMemoryFrontmatter`, tipi `ToolGroup`, `ProcessedMessage`, `SessionAgent`, `ChatDetailsFilter` | Pre-processing messaggi raw: abbina `tool_use` + `tool_result` per ID; rimuove messaggi utente con soli tool_result; `correlateSessionAgents` collega ogni dispatch `Task`/`Agent` al suo transcript subagent per prefisso-prompt |
| `atoms.tsx` | `PathChip`, `SectionLabel`, `CodeBlock` | UI atoms per il rendering degli input/output tool |
| `ToolDetailPanel.tsx` | `ToolDetailPanel` | Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria |
| `ToolGroupCard.tsx` | `ToolGroupCard` | Card compatta che mostra una coppia `tool_use` + `tool_result` |
| `MessageBubble.tsx` | `ThinkingBlock`, `MessageBubble` | Singolo messaggio con testo, thinking espandibile, tool cards |
| `AgentRail.tsx` | `AgentRail` | Rail destro persistente con i sub-agenti della sessione (`correlateSessionAgents`): chip `subagent_type`, span orario, stato; evidenzia l'agente al/sopra lo scroll corrente (via `activeTurn`). Click → apre il transcript; bottone locate → scrolla alla dispatch card nella chat |
| `SubagentTranscriptPanel.tsx` | `SubagentTranscriptPanel` | Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni |
| `ChatView.tsx` | `ChatView` | Vista completa chat: header stats, filtro minimal/all, lista messaggi, overlay `ToolDetailPanel`; quando ci sono sub-agenti aggiunge `AgentRail` a destra (`cl-chat-workspace--with-rail`) e apre `SubagentTranscriptPanel` |

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
| `GlobalClaudeMdView.tsx` | `GlobalClaudeMdView`, `ProjectClaudeMdView` | Wrapper detail per CLAUDE.md (global e per-layer) via `EntityDetailView`: edit mono-colonna (nessun frontmatter) + delete (`claudeMd:deleteGlobal`/`deleteFile`) |

---

### `skills/`
| File | Esporta | Descrizione |
|---|---|---|
| `SkillDetailView.tsx` | `SkillDetailView` | Wrapper che costruisce la `EntityConfig` skill (opzioni frontmatter editabili strutturate, `serializeSkill`) e delega a `EntityDetailView`. Supporta edit + delete (rimuove la cartella `skills/<name>/` se vuota) |
| `CreateSkillPage.tsx` | `CreateSkillPage` | Pagina dedicata per creare una nuova skill (globale o di progetto); on save torna alla lista |
| `GlobalSkillsView.tsx` | `GlobalSkillsView` | Lista skill globali con ricerca e navigazione al detail |

---

### `agents/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentDetailView.tsx` | `AgentDetailView` | Wrapper che costruisce la `EntityConfig` agent (`AGENT_OPTION_DEFS`, `serializeAgent`, tape Scope/Model/Color/Status, validation) e delega a `EntityDetailView`. Supporta edit + delete + Run agent |
| `RunAgentDialog.tsx` | `RunAgentDialog` | Dialog di dispatch background agent (overlay passato a `EntityDetailView` via `renderRunOverlay`) |
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

### `agents-live/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentsLiveView.tsx` | `AgentsLiveView` | Vista dei background/live agent: legge le sessioni agent in corso (`bg-sessions-reader` + `live:*`/`agents:*` IPC), con dispatch/stop/respawn. Click su una sessione → `chat` (con `from: 'agents-live'`) |

---

### `sessions/`
| File | Esporta | Descrizione |
|---|---|---|
| `TagBar.tsx` | `TagBar` | Barra dei tag di una sessione (lista + add) |
| `TagChip.tsx` | `TagChip` | Chip singolo tag (colore + remove) |
| `TagPicker.tsx` | `TagPicker` | Picker per assegnare/creare tag a una sessione |

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
| `PlanDetailView.tsx` | `PlanDetailView` | Vista dettaglio singolo piano: `EntityDetailView` con toggle View/Edit + Save/Delete (edit mono-colonna, nessun frontmatter — il body è l'intero markdown; `serialize` = identità). Save/delete via `markdownFile:write`/`delete` su `~/.claude/plans/*.md`, invalida `plans:project`; il piano fresco è ri-derivato da `useProjectPlans`. Tape status/created/branch + footer filePath. I piani vivono globali su disco ma sono linkati al progetto via `planFilePath` nei `.jsonl` |

---

### `settings/`
| File | Esporta | Descrizione |
|---|---|---|
| `SettingsView.tsx` | `SettingsView`, `SettingsGearIcon`, `GeneralTab`/`PermissionsTab`/`ToolsTab`/`McpTab`/`ExtensionsTab`/`SourcesTab`, `ReadOnlyHint` | Pagina Settings **globale** (deep view, trigger = ingranaggio nella top bar). Legge la config **effettiva** via `useEffectiveConfig()` (cwd = home) → IPC `config:getEffective` → SDK ufficiale. Rail di tab a sinistra (General, Permissions, Tools, MCP Servers, Extensions, Sources) + ricerca; read-only. I dati runtime (model risolto, status MCP, tool, versione) vengono dall'init dell'SDK; il merge settings + provenance da `resolveSettings`. I renderer di tab sono esportati per riuso |
| `ProjectConfigView.tsx` | `ProjectConfigView` | Variante **scoped al progetto** (subtab "Config" della vista progetto). `useEffectiveConfig(project.realPath)` → include i tier `project`/`local` di `.claude/settings*.json`. Riusa i renderer di `SettingsView` impilati verticalmente (scroll piatto, niente rail interno) per stare nella chrome editoriale. Read-only |

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
- **Styling:** Tailwind CSS + token `--cl-*` / classi `cl-*` in `index.css` (accent terracotta `#C15F3C`). Tema chiaro di default, dark derivato via `:root[data-theme='dark']`. Non introdurre nuove tinte d'accento — vedi root `CLAUDE.md`
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
