import { McpData, McpServer } from '../../../hooks/useIPC'

export interface McpServiceMeta {
  category: string
  description: string
}

// Registry curato: categoria + descrizione per i servizi cloud più noti.
// Il match è per sottostringa sul nome (case-insensitive).
export function mcpServiceMeta(name: string): McpServiceMeta {
  const n = name.toLowerCase()
  if (n.includes('calendar')) return { category: 'Productivity', description: 'Gestione eventi e disponibilità su Google Calendar.' }
  if (n.includes('gmail')) return { category: 'Productivity', description: 'Lettura, ricerca e composizione email su Gmail.' }
  if (n.includes('drive')) return { category: 'Productivity', description: 'Ricerca e lettura di file su Google Drive.' }
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence')) return { category: 'Productivity', description: 'Issue Jira e pagine Confluence di Atlassian.' }
  if (n.includes('notion')) return { category: 'Productivity', description: 'Lettura e scrittura di pagine e database Notion.' }
  if (n.includes('microsoft 365')) return { category: 'Productivity', description: 'Posta, calendario e documenti Microsoft 365.' }
  if (n.includes('microsoft learn')) return { category: 'Reference', description: 'Documentazione tecnica Microsoft Learn.' }
  if (n.includes('figma')) return { category: 'Design', description: 'Accesso a file e componenti di design Figma.' }
  if (n.includes('canva')) return { category: 'Design', description: 'Creazione e modifica di grafiche su Canva.' }
  if (n.includes('eraser')) return { category: 'Design', description: 'Diagrammi e documenti tecnici su Eraser.' }
  if (n.includes('mermaid')) return { category: 'Design', description: 'Validazione e rendering di diagrammi Mermaid.' }
  if (n.includes('spotify')) return { category: 'Music', description: 'Ricerca brani, playlist e libreria Spotify.' }
  if (n.includes('booking') || n.includes('expedia') || n.includes('tripadvisor')) return { category: 'Travel', description: 'Ricerca hotel, voli e recensioni di viaggio.' }
  if (n.includes('paypal')) return { category: 'Payments', description: 'Pagamenti e transazioni PayPal.' }
  if (n.includes('ifttt')) return { category: 'Automation', description: 'Automazioni e applet IFTTT.' }
  if (n.includes('synthesize bio')) return { category: 'Science', description: 'Dati e analisi biologiche di Synthesize Bio.' }
  if (n.includes('slack')) return { category: 'Communication', description: 'Messaggi e canali Slack.' }
  if (n.includes('github')) return { category: 'Development', description: 'Repository, issue e pull request GitHub.' }
  if (n.includes('linear')) return { category: 'Development', description: 'Issue e progetti su Linear.' }
  return { category: 'MCP server', description: 'Server MCP che estende Claude con strumenti esterni.' }
}

export function mcpServiceColor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('google') || n.includes('calendar') || n.includes('gmail') || n.includes('drive')) return '#4285f4'
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence')) return '#0052cc'
  if (n.includes('notion')) return 'var(--cl-ink)'
  if (n.includes('figma')) return 'var(--cl-violet)'
  if (n.includes('canva')) return 'var(--cl-cyan)'
  if (n.includes('mermaid')) return 'var(--cl-danger)'
  if (n.includes('slack')) return '#4a154b'
  if (n.includes('github')) return 'var(--cl-ink)'
  if (n.includes('linear')) return 'var(--cl-accent)'
  if (n.includes('spotify')) return 'var(--cl-ok)'
  if (n.includes('booking') || n.includes('expedia') || n.includes('tripadvisor')) return 'var(--cl-cyan)'
  return 'var(--cl-cyan)'
}

export function McpServerCard({
  server,
  totalProjects,
  onSelect,
}: {
  server: McpData['cloudServers'][number]
  totalProjects: number
  onSelect: (server: McpServer) => void
}) {
  const displayName = server.name.replace(/^claude\.ai\s*/i, '')
  const color = mcpServiceColor(server.name)
  const initial = displayName.trim()[0]?.toUpperCase() ?? '?'
  const meta = mcpServiceMeta(server.name)

  const isLocal = server.source === 'local'
  const fullyEnabled = server.disabledInProjects === 0
  const fullyDisabled = server.enabledInProjects === 0
  const statusColor = fullyEnabled ? 'var(--cl-ok)' : fullyDisabled ? 'var(--cl-danger)' : 'var(--cl-warn)'

  const envKeys = server.env ? Object.keys(server.env) : []
  const pct = totalProjects > 0 ? Math.round((server.enabledInProjects / totalProjects) * 100) : 0

  return (
    <button type="button" className="cl-mcp-card" onClick={() => onSelect(server)}>
      <span
        className="badge"
        style={{
          background: `color-mix(in oklch, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in oklch, ${color} 28%, transparent)`,
          color,
        }}
      >
        {initial}
      </span>

      <div className="body">
        <div className="head">
          <span className="name">{displayName}</span>
          <span className="led" style={{ background: statusColor }} />
          <span
            className="src"
            style={
              isLocal
                ? { background: 'var(--cl-warn-soft)', color: 'var(--cl-warn)' }
                : { background: 'var(--cl-accent-soft)', color: 'var(--cl-accent-ink)' }
            }
          >
            {server.source}
          </span>
        </div>
        <div className="cat">{meta.category}</div>
        <div className="desc">{meta.description}</div>

        <div className="foot">
          {!isLocal && totalProjects > 0 && (
            <>
              <span className="frac">
                {server.enabledInProjects}<small>/{totalProjects}</small>
              </span>
              <span className="bar"><i style={{ width: `${pct}%`, background: statusColor }} /></span>
              <span className="pct">{pct}%</span>
            </>
          )}
          {isLocal && (
            <>
              {envKeys.length > 0 && (
                <span className="env"><b>{envKeys.length}</b> env</span>
              )}
              {server.command && (
                <span className="cmd" title={server.command}>{server.command}</span>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  )
}
