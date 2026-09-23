import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  deleteRemoteHost,
  findRemoteHost,
  readRemoteHosts,
  saveRemoteHost,
} from '../electron/modules/remote-hosts-store';
import { remoteDirProblem, remoteHostProblem } from '../electron/shared/remote-host';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'remote-hosts-'));
  file = join(dir, 'state', 'remote-hosts.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = { name: 'Build server', target: 'user@build.example.com' };

describe('the hosts file', () => {
  it('is empty before anything is saved', () => {
    expect(readRemoteHosts(file)).toEqual([]);
  });

  it('adds, edits and removes a host', () => {
    const saved = saveRemoteHost(file, { ...build, port: 2222, defaultDir: ' ~/projects ' });
    expect(saved).toMatchObject({ ...build, port: 2222, defaultDir: '~/projects' });
    expect(saved.id).toBeTruthy();

    const edited = saveRemoteHost(file, { ...saved, name: 'CI', defaultDir: '' });
    expect(edited.id).toBe(saved.id);
    expect(edited).not.toHaveProperty('defaultDir');
    expect(readRemoteHosts(file)).toEqual([edited]);
    expect(findRemoteHost(file, saved.id)?.name).toBe('CI');

    deleteRemoteHost(file, saved.id);
    expect(readRemoteHosts(file)).toEqual([]);
    expect(findRemoteHost(file, saved.id)).toBeNull();
  });

  it('refuses an entry the rules reject, and writes nothing', () => {
    expect(() => saveRemoteHost(file, { name: 'x', target: '-oProxyCommand=id' })).toThrow(
      /cannot start with "-"/
    );
    expect(readRemoteHosts(file)).toEqual([]);
  });

  it('refuses to edit a host that is no longer saved', () => {
    expect(() => saveRemoteHost(file, { ...build, id: 'gone' })).toThrow(/no longer saved/);
  });

  it('leaves a file it cannot parse untouched rather than replacing it', async () => {
    saveRemoteHost(file, build);
    await writeFile(file, '{ not json');
    expect(() => readRemoteHosts(file)).toThrow(/left untouched/);
    expect(() => saveRemoteHost(file, { name: 'Other', target: 'other' })).toThrow();
    expect(await readFile(file, 'utf-8')).toBe('{ not json');
  });

  it('skips a stored entry that no longer passes the rules', async () => {
    await saveRemoteHost(file, build);
    const body = JSON.parse(await readFile(file, 'utf-8'));
    body.hosts.push({ id: 'bad', name: 'Bad', target: '-oProxyCommand=id' });
    await writeFile(file, JSON.stringify(body));
    expect(readRemoteHosts(file).map(h => h.name)).toEqual(['Build server']);
  });
});

describe('the host rules', () => {
  it.each([['build'], ['build-01.lan'], ['user@build.example.com'], ['[::1]'], ['fe80::1%en0']])(
    'accepts the destination %s',
    target => {
      expect(remoteHostProblem({ name: 'h', target })).toBeNull();
    }
  );

  it.each([['-oProxyCommand=id'], ['two words'], ['a;b'], ['$(id)'], ['']])(
    'refuses the destination %j',
    target => {
      expect(remoteHostProblem({ name: 'h', target })).not.toBeNull();
    }
  );

  it.each([[0], [65536], [22.5]])('refuses the port %s', port => {
    expect(remoteHostProblem({ name: 'h', target: 'build', port })).toMatch(/port/);
  });

  it('refuses an empty name and an unsafe default folder', () => {
    expect(remoteHostProblem({ name: ' ', target: 'build' })).toMatch(/name/);
    expect(remoteHostProblem({ name: 'h', target: 'build', defaultDir: '~/a$b' })).toMatch(
      /cannot contain/
    );
  });

  it('accepts absolute and home-relative folders only', () => {
    expect(remoteDirProblem('/srv/app')).toBeNull();
    expect(remoteDirProblem('~')).toBeNull();
    expect(remoteDirProblem('~/code/app')).toBeNull();
    expect(remoteDirProblem('code/app')).toMatch(/absolute/);
    expect(remoteDirProblem('~other/app')).toMatch(/absolute/);
  });
});
