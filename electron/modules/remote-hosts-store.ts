// The remote hosts the terminal pane can connect to (#242), kept in
// `~/.claudelens/remote-hosts.json` — ClaudeLens state, never `~/.claude`.
//
// An entry is a name, an ssh destination, an optional port and a starting
// folder: nothing secret. Authentication stays with the system ssh (keys,
// agent, `~/.ssh/config`), so there is no credential here to protect.
//
// A file that exists but does not parse is refused rather than overwritten: the
// next save would otherwise replace the user's hosts with the one being added.

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  normalizeRemoteHost,
  remoteHostProblem,
  type RemoteHost,
  type RemoteHostInput,
} from '../shared/remote-host';

interface HostsFile {
  version: 1;
  hosts: RemoteHost[];
}

/** The saved hosts, in the order they were added; [] when there is no file yet. */
export function readRemoteHosts(file: string): RemoteHost[] {
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    throw new Error(`The remote hosts file is not valid JSON, so it was left untouched: ${file}`);
  }
  const hosts = (parsed as Partial<HostsFile> | null)?.hosts;
  if (!Array.isArray(hosts)) {
    throw new Error(`The remote hosts file has no host list, so it was left untouched: ${file}`);
  }
  // An entry that no longer passes the rules is skipped, not repaired: what
  // reaches ssh is only ever what `remoteHostProblem` accepts.
  return hosts.filter(
    (h): h is RemoteHost =>
      !!h && typeof h.id === 'string' && !!h.id && remoteHostProblem(h) === null
  );
}

function writeHosts(file: string, hosts: RemoteHost[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const body: HostsFile = { version: 1, hosts };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
  renameSync(tmp, file);
}

/** Add a host (no `id`) or replace the one with that id. */
export function saveRemoteHost(file: string, input: RemoteHostInput): RemoteHost {
  const problem = remoteHostProblem(input);
  if (problem) throw new Error(problem);
  const hosts = readRemoteHosts(file);
  if (input.id && !hosts.some(h => h.id === input.id)) {
    throw new Error('That host is no longer saved.');
  }
  const host = normalizeRemoteHost(input, input.id ?? randomUUID());
  const next = input.id ? hosts.map(h => (h.id === host.id ? host : h)) : [...hosts, host];
  writeHosts(file, next);
  return host;
}

export function deleteRemoteHost(file: string, id: string): void {
  const hosts = readRemoteHosts(file);
  if (!hosts.some(h => h.id === id)) return;
  writeHosts(
    file,
    hosts.filter(h => h.id !== id)
  );
}

export function findRemoteHost(file: string, id: string): RemoteHost | null {
  return readRemoteHosts(file).find(h => h.id === id) ?? null;
}
