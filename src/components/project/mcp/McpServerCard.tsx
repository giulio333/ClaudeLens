import type { McpStatus } from '../../../types';

export interface McpStatusMeta {
  label: string;
  color: string;
  /** Longer explanation, surfaced as a tooltip. */
  hint: string;
}

// Status comes straight from `claude mcp list` — the same health check `/mcp`
// runs — so these labels describe the live server, not a cached file entry.
export function mcpStatusMeta(status: McpStatus): McpStatusMeta {
  switch (status) {
    case 'connected':
      return {
        label: 'connected',
        color: 'var(--cl-ok)',
        hint: 'Health-checked and serving tools.',
      };
    case 'pending':
      return {
        label: 'pending approval',
        color: 'var(--cl-warn)',
        hint: 'Declared in a .mcp.json that has not been approved yet, so Claude Code does not connect to it.',
      };
    case 'needs-auth':
      return {
        label: 'needs auth',
        color: 'var(--cl-warn)',
        hint: 'The server exists but its authentication has not been completed. Run /mcp in Claude Code to authenticate.',
      };
    case 'failed':
      return {
        label: 'failed',
        color: 'var(--cl-danger)',
        hint: 'The health check could not reach this server.',
      };
    case 'unlisted':
      return {
        label: 'not listed',
        color: 'var(--cl-ink-4)',
        hint: 'Recorded in ~/.claude.json but absent from the last `claude mcp list`. Usually a connector disconnected from your account; the list Claude Code reports also varies between runs, so it may reappear.',
      };
    default:
      return {
        label: 'unknown',
        color: 'var(--cl-ink-4)',
        hint: 'Claude Code reported no recognizable status for this server.',
      };
  }
}

export interface McpServiceMeta {
  category: string;
  description: string;
}

// Registry curato: categoria + descrizione per i servizi cloud più noti.
// Il match è per sottostringa sul nome (case-insensitive).
export function mcpServiceMeta(name: string): McpServiceMeta {
  const n = name.toLowerCase();
  if (n.includes('calendar'))
    return {
      category: 'Productivity',
      description: 'Gestione eventi e disponibilità su Google Calendar.',
    };
  if (n.includes('gmail'))
    return {
      category: 'Productivity',
      description: 'Lettura, ricerca e composizione email su Gmail.',
    };
  if (n.includes('drive'))
    return { category: 'Productivity', description: 'Ricerca e lettura di file su Google Drive.' };
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence'))
    return {
      category: 'Productivity',
      description: 'Issue Jira e pagine Confluence di Atlassian.',
    };
  if (n.includes('notion'))
    return {
      category: 'Productivity',
      description: 'Lettura e scrittura di pagine e database Notion.',
    };
  if (n.includes('microsoft 365'))
    return {
      category: 'Productivity',
      description: 'Posta, calendario e documenti Microsoft 365.',
    };
  if (n.includes('microsoft learn'))
    return { category: 'Reference', description: 'Documentazione tecnica Microsoft Learn.' };
  if (n.includes('figma'))
    return { category: 'Design', description: 'Accesso a file e componenti di design Figma.' };
  if (n.includes('canva'))
    return { category: 'Design', description: 'Creazione e modifica di grafiche su Canva.' };
  if (n.includes('eraser'))
    return { category: 'Design', description: 'Diagrammi e documenti tecnici su Eraser.' };
  if (n.includes('mermaid'))
    return { category: 'Design', description: 'Validazione e rendering di diagrammi Mermaid.' };
  if (n.includes('spotify'))
    return { category: 'Music', description: 'Ricerca brani, playlist e libreria Spotify.' };
  if (n.includes('booking') || n.includes('expedia') || n.includes('tripadvisor'))
    return { category: 'Travel', description: 'Ricerca hotel, voli e recensioni di viaggio.' };
  if (n.includes('paypal'))
    return { category: 'Payments', description: 'Pagamenti e transazioni PayPal.' };
  if (n.includes('ifttt'))
    return { category: 'Automation', description: 'Automazioni e applet IFTTT.' };
  if (n.includes('synthesize bio'))
    return { category: 'Science', description: 'Dati e analisi biologiche di Synthesize Bio.' };
  if (n.includes('slack'))
    return { category: 'Communication', description: 'Messaggi e canali Slack.' };
  if (n.includes('github'))
    return { category: 'Development', description: 'Repository, issue e pull request GitHub.' };
  if (n.includes('linear'))
    return { category: 'Development', description: 'Issue e progetti su Linear.' };
  return {
    category: 'MCP server',
    description: 'Server MCP che estende Claude con strumenti esterni.',
  };
}

export function mcpServiceColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('google') || n.includes('calendar') || n.includes('gmail') || n.includes('drive'))
    return '#4285f4';
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence')) return '#0052cc';
  if (n.includes('notion')) return 'var(--cl-ink)';
  if (n.includes('figma')) return 'var(--cl-violet)';
  if (n.includes('canva')) return 'var(--cl-cyan)';
  if (n.includes('mermaid')) return 'var(--cl-danger)';
  if (n.includes('slack')) return '#4a154b';
  if (n.includes('github')) return 'var(--cl-ink)';
  if (n.includes('linear')) return 'var(--cl-accent)';
  if (n.includes('spotify')) return 'var(--cl-ok)';
  if (n.includes('booking') || n.includes('expedia') || n.includes('tripadvisor'))
    return 'var(--cl-cyan)';
  return 'var(--cl-cyan)';
}
