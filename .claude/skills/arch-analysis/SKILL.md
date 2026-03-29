---
description: Analisi architetturale del progetto ClaudeLens (Electron + React)
context: fork
agent: Explore
---

Esegui un'analisi architetturale completa del progetto ClaudeLens in `claudelens-app/`.

## 1. Main Process — IPC Handlers (`electron/main.ts`)
- Elenca tutti gli handler `ipcMain.handle` raggruppati per namespace (`memory:*`, `cost:*`, `sessions:*`, ecc.)
- Segnala handler senza corrispondente hook nel renderer (`useIPC.ts`)

## 2. Backend Modules (`electron/modules/`)
- Per ogni modulo elenca: responsabilità principale, funzioni esportate, dipendenze da filesystem (`~/.claude/`)
- Segnala moduli con funzioni che superano 50 righe (violazione convenzione CLAUDE.md)

## 3. Renderer — Componenti React (`src/components/`)
- Mappa la struttura delle cartelle e i componenti principali
- Identifica componenti con più di 200 righe (candidati a refactor)
- Verifica che `ProjectOverview.tsx` sia rimasto sotto le 400 righe dopo il refactor

## 4. React Query Hooks (`src/useIPC.ts`)
- Elenca tutte le query e le mutation definite
- Verifica che ogni mutation invalidi correttamente la cache
- Segnala chiamate `window.electronAPI` non tipizzate

## 5. Allineamento IPC
- Confronta gli handler in `main.ts` con le chiamate in `useIPC.ts`
- Segnala handler esposti ma non usati dal renderer, o viceversa

## 6. Preload Bridge (`electron/preload.ts`)
- Elenca tutti i metodi esposti via `contextBridge`
- Verifica coerenza con i tipi dichiarati in `useIPC.ts`

## Output
Presenta i risultati in sezioni markdown con:
- Tabelle per IPC handlers e hooks
- Lista problemi trovati con severità (warning / error)
- Suggerimenti concreti per i problemi più critici
