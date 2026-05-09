import assert from "node:assert/strict";
import test from "node:test";
import { App } from "obsidian";
import { AnkiConnectClient } from "../../src/anki-connect";
import { CardConverter } from "../../src/conversion";
import { ANKI_URL, isAnkiReachable, makeSuffix, registerAnkiTestCleanup } from "./helpers";

interface RenderedCardInfo {
	question: string;
	answer: string;
}

test("integration: math survives the full pipeline (markdown -> Anki HTML -> stored + rendered)", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Math ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const tag = `tmc_it_math_${suffix}`;
	cleanup.trackTag(tag);

	const converter = new CardConverter(new App(), client, "media");

	const inlineMarkdown = `Energy: $E = mc^2$ end`;
	const blockMarkdown = `Identity:\n\n$$\na^2 + b^2 = c^2\n$$\n\nend`;

	const inlineHtml = await converter.markdownToAnkiHtml(inlineMarkdown, "test.md");
	const blockHtml = await converter.markdownToAnkiHtml(blockMarkdown, "test.md");

	// Sanity check on what we're sending: math delimiters must be present in the HTML
	// going into Anki, otherwise MathJax has nothing to render.
	assert.match(inlineHtml, /\\\(\s*E = mc\^2\s*\\\)/, "inline math delimiter must survive markdown rendering");
	assert.match(blockHtml, /\\\[[\s\S]*a\^2 \+ b\^2 = c\^2[\s\S]*\\\]/, "block math delimiter must survive markdown rendering");

	const inlineNoteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: inlineHtml, Back: "back" },
			tags: [tag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(inlineNoteId);

	const blockNoteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: blockHtml, Back: "back" },
			tags: [tag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(blockNoteId);

	// What Anki stored on the note
	const [inlineNote, blockNote] = await client.notesInfo([inlineNoteId, blockNoteId]);
	assert.match(inlineNote.fields.Front.value, /\\\(\s*E = mc\^2\s*\\\)/, "Anki should store inline math delimiters verbatim");
	assert.match(blockNote.fields.Front.value, /\\\[[\s\S]*a\^2 \+ b\^2 = c\^2[\s\S]*\\\]/, "Anki should store block math delimiters verbatim");

	// What Anki renders for the card (this is the HTML MathJax sees in the webview)
	const inlineCardIds = await client.invoke<number[]>("findCards", { query: `nid:${inlineNoteId}` });
	const blockCardIds = await client.invoke<number[]>("findCards", { query: `nid:${blockNoteId}` });
	const [inlineCard] = await client.invoke<RenderedCardInfo[]>("cardsInfo", { cards: inlineCardIds });
	const [blockCard] = await client.invoke<RenderedCardInfo[]>("cardsInfo", { cards: blockCardIds });

	assert.match(inlineCard.question, /\\\(\s*E = mc\^2\s*\\\)/, "rendered card question should keep inline math delimiters");
	assert.match(blockCard.question, /\\\[[\s\S]*a\^2 \+ b\^2 = c\^2[\s\S]*\\\]/, "rendered card question should keep block math delimiters");
});
