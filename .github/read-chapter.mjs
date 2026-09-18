#!/usr/bin/env node
/** Deploy settings of one chapter, as workflow outputs. */
import { appendFileSync, readFileSync } from 'node:fs';

const { aleph } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [key, value] of Object.entries({
	site: aleph.site,
	domain: aleph.domain,
	deployer: aleph.deployer
})) {
	appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
	console.log(`${key}: ${value}`);
}
