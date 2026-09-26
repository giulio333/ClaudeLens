import type { ArtifactPublish } from '../../../types';
import type { ToolGroup } from './utils';

/**
 * Reading the `Artifact` tool — the harness tool that publishes a page to
 * claude.ai.
 *
 * It is a recurring species in these transcripts (308 calls across nine of them
 * when this was written, 18 of which published a page) and, until now, one the
 * app had no idea about: a
 * publish rendered as a generic tool card whose body was the result prose, so
 * the page's title never appeared, its link was text inside a kilobyte of
 * boilerplate about live subscriptions, and nothing said which version this
 * was. The page itself — `ArtifactPublish`, read in `transcript-extras` — is
 * data Claude Code already writes; this module only decides what a reader is
 * shown of it.
 *
 * Two shapes, deliberately told apart: a **publish** produced a page and is the
 * turn's output, while a `quickstart`, a `read` or a `list` answered a question
 * and produced nothing. The second kind carries no `ArtifactPublish`, and that
 * absence — not the `action` in the input, which an older transcript may not
 * even have — is what the views branch on.
 */

export const ARTIFACT_TOOL = 'Artifact';

export function isArtifactTool(name: string): boolean {
  return name === ARTIFACT_TOOL;
}

/** The page this call published, or `undefined` when it published none. */
export function artifactOf(group: ToolGroup): ArtifactPublish | undefined {
  return group.result?.artifact;
}

/** What the call asked for (`publish` when the input does not say), for the
 *  chip that stands in for a call with no page of its own. */
export function artifactAction(group: ToolGroup): string {
  const action = (group.use.input as Record<string, unknown>).action;
  return typeof action === 'string' && action ? action : 'publish';
}

/** The one-line summary the call gave the page, when it gave one. It lives on
 *  the input — Claude Code does not echo it back on the result — so it is only
 *  ever known for the publish that carried it, which is normally the first. */
export function artifactDescription(group: ToolGroup): string | undefined {
  const d = (group.use.input as Record<string, unknown>).description;
  return typeof d === 'string' && d.trim() ? d.trim() : undefined;
}

/** `https://claude.ai/artifact/AbCdEf` → `claude.ai/artifact/AbCdEf`. The
 *  scheme is noise in a row that is already narrow; the host is not, because it
 *  is what says the link leaves the app. */
export function shortArtifactUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** `v4`, or nothing at all. An older transcript carries no `seq`, and a version
 *  counted from the publishes this session happens to show would be wrong on
 *  exactly the pages that were published from more than one. */
export function artifactVersion(page: ArtifactPublish): string {
  return page.seq && page.seq > 0 ? `v${page.seq}` : '';
}

/** `CREATED` on the publish that made the page, `UPDATED` on a republish. */
export function artifactStatusLabel(page: ArtifactPublish): string {
  return page.updated ? 'UPDATED' : 'CREATED';
}

/** Whether the page is still the owner's alone. `audience` is absent on older
 *  transcripts: unknown sharing reads as nothing, never as "private", which
 *  would be a claim about who can open a link. */
export function artifactIsPrivate(page: { audience?: string }): boolean | undefined {
  if (!page.audience) return undefined;
  return page.audience === 'owner';
}

/** Every publish of one page, newest first, with the calls behind it. */
export type ArtifactActivity = {
  id: string;
  url: string;
  /** Title of the most recent publish: a page can be retitled. */
  title: string;
  description?: string;
  /** Highest `seq` seen, when any publish carried one. */
  seq?: number;
  audience?: string;
  /** True when this session created the page rather than only republishing it. */
  created: boolean;
  publishes: number;
  items: ToolGroup[];
};

/**
 * The pages a session published, one entry each.
 *
 * Aggregating by `artifact_id` is what makes this readable: four republishes of
 * one page are one outcome, not four, and the rail already reads a file's edits
 * that way. The chat does not aggregate — there each publish sits at the moment
 * it happened, with a user turn between — which is why this lives here and not
 * in the card.
 *
 * A call that FAILED is absent here by construction: a refusal answers with no
 * `artifact_id`, so there is no page to key it on. The chat still shows it in
 * place, which is where a failure belongs — the rail's job is what the session
 * produced, and a refused publish produced nothing.
 */
export function buildArtifactActivity(groups: ToolGroup[]): ArtifactActivity[] {
  // Keyed on the URL, which is one-to-one with the id wherever both are
  // written: a page created from an Artifact type records only the URL, and
  // keying on the id would split it from the publishes that followed.
  const byUrl = new Map<string, ArtifactActivity>();
  for (const g of groups) {
    if (!isArtifactTool(g.use.name)) continue;
    const page = artifactOf(g);
    if (!page) continue;
    let a = byUrl.get(page.url);
    if (!a) {
      a = {
        id: page.id,
        url: page.url,
        title: page.title,
        created: false,
        publishes: 0,
        items: [],
      };
      byUrl.set(page.url, a);
    }
    a.items.push(g);
    a.publishes += 1;
    a.title = page.title || a.title;
    if (page.seq && page.seq > (a.seq ?? 0)) a.seq = page.seq;
    if (page.audience) a.audience = page.audience;
    if (!page.updated) a.created = true;
    a.description = a.description ?? artifactDescription(g);
  }
  return [...byUrl.values()];
}
