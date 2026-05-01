import assert from "node:assert/strict";
import test from "node:test";
import { AnkiConnectClient } from "../../src/anki-connect";
import { addIncomingLinkTagsToAnki } from "../../src/anki-tag-policy";
import { addManagedTag } from "../../src/anki-command-api";
import { ANKI_URL, SYNC_TAG, isAnkiReachable, makeSuffix, registerAnkiTestCleanup } from "./helpers";

test("integration: add incoming-link tags keeps existing note tags", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Tags ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const existingA = `tmc_it_existing_a_${suffix}`;
	const existingB = `tmc_it_existing_b_${suffix}`;
	cleanup.trackTag(existingA);
	cleanup.trackTag(existingB);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: {
				Front: `integration-front-${suffix}`,
				Back: "integration-back",
			},
			tags: [existingA, existingB],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	await addIncomingLinkTagsToAnki(client, noteId, ["From_Obsidian", "Topic::Biology"]);
	const info = (await client.notesInfo([noteId]))[0];
	assert.ok(info, "note should exist");
	const normalizedTags = info.tags.map((tag) => tag.toLowerCase());
	assert.ok(normalizedTags.includes(existingA.toLowerCase()), "existing tag should remain");
	assert.ok(normalizedTags.includes(existingB.toLowerCase()), "second existing tag should remain");
	assert.ok(normalizedTags.includes("from_obsidian"), "incoming-link tag should be added");
	assert.ok(normalizedTags.includes("topic::biology"), "nested incoming-link tag should be added");
});

test("integration: import-style managed tag add keeps existing tags", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Import Tags ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const existing = `tmc_it_import_existing_${suffix}`;
	cleanup.trackTag(existing);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: {
				Front: `integration-import-front-${suffix}`,
				Back: "integration-back",
			},
			tags: [existing],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	await addManagedTag(client, [noteId], SYNC_TAG);
	const info = (await client.notesInfo([noteId]))[0];
	const normalizedTags = info.tags.map((tag) => tag.toLowerCase());
	assert.ok(normalizedTags.includes(existing.toLowerCase()), "import-existing tag should remain");
	assert.ok(normalizedTags.includes(SYNC_TAG.toLowerCase()), "managed sync tag should be added");
});

test("integration: empty incoming-link tags does not mutate note tags", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Empty Tags ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const existing = `tmc_it_only_existing_${suffix}`;
	cleanup.trackTag(existing);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: {
				Front: `integration-empty-front-${suffix}`,
				Back: "integration-back",
			},
			tags: [existing],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	const before = (await client.notesInfo([noteId]))[0];
	await addIncomingLinkTagsToAnki(client, noteId, []);
	const after = (await client.notesInfo([noteId]))[0];
	assert.deepEqual(after.tags.slice().sort(), before.tags.slice().sort());
});
