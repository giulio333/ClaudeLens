/**
 * Build-time feature flags.
 *
 * Agent Studio (the visual editor for native workflow scripts) is still under
 * development and has never shipped in a release, so its entry point stays
 * hidden: the code is kept in the tree and the `studio*` views remain wired,
 * but nothing can navigate to them. Flip this back to `true` to re-enable the
 * "Agent Studio" item in the top-bar nav.
 */
export const STUDIO_ENABLED: boolean = false;

/**
 * Notebook (one session as a sentence, a plan, a diff and its checks) is a beta
 * that is not released yet: it shows in a dev build (`npm run dev`) and is
 * absent from a packaged one. Replace with `true` to ship it.
 */
export const NOTEBOOK_ENABLED: boolean = import.meta.env.DEV;
