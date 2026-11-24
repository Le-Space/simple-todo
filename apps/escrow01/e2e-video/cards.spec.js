// The title cards of this language's film (films/<lang>/), recorded one by
// one: the page from the Le Space brand (escrow01.js), its animation started,
// the narrator, and a cues.json so compose treats each card like a scene.
//
//   pnpm video:cards                  # English
//   DEMO_LANG=de pnpm video:cards     # German
import { test } from '@playwright/test';
import { recordCards } from '@le-space/video-kit/record-cards';
import { cards, LANG, NIGHT, voice } from './escrow01.js';

recordCards(test, {
	films: new URL(`./films/${LANG}/`, import.meta.url),
	cards,
	scene: { voice, night: NIGHT }
});
