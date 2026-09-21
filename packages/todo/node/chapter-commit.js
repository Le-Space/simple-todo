/**
 * The commit a chapter's build is stamped with — at build time, in the
 * chapter's vite.config.js, never in the browser.
 *
 * The commit, not the clock: a build of the same commit has to produce the same
 * bytes, or every rebuild publishes a new IPFS CID for an unchanged page. And
 * the *chapter's* last commit rather than HEAD, by the rule deploy's app picker
 * uses (`.github/pick-apps.mjs`): the chapter's own folder, or anything outside
 * `apps/`. A commit to another chapter changes nothing here, so deploying every
 * chapter must not restamp this one.
 *
 * On a shallow clone the one commit there is counts as touching everything, so
 * a depth-1 checkout stamps HEAD; the deploy job fetches the full history.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * @param {string} chapterDir the chapter's folder, `apps/<chapter>`
 * @returns {{ commit: string, date: string }} the full sha and the commit's ISO
 *   date — or two empty strings without git, which leaves the stamp out rather
 *   than dating it by the clock
 */
export function chapterCommit(chapterDir) {
	/** @param {string[]} args @param {string} cwd */
	const git = (args, cwd) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

	try {
		const root = git(['rev-parse', '--show-toplevel'], chapterDir);
		const chapter = basename(chapterDir);
		const others = readdirSync(join(root, 'apps'), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name !== chapter)
			.map((entry) => `:(exclude)apps/${entry.name}`);
		const [commit = '', date = ''] = git(
			['log', '-1', '--format=%H%n%cI', '--', '.', ...others],
			root
		).split('\n');
		return commit && date ? { commit, date } : { commit: '', date: '' };
	} catch {
		// A tarball, or a checkout without git.
		return { commit: '', date: '' };
	}
}
