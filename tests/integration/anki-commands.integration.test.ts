import assert from "node:assert/strict";
import test from "node:test";
import { AnkiConnectClient } from "../../src/anki-connect";
import { addManagedTag, getNotesForDeck, getPluginManagedNotes, splitBasicNotes } from "../../src/anki-command-api";
import { ANKI_URL, SYNC_TAG, isAnkiReachable, makeSuffix, registerAnkiTestCleanup } from "./helpers";

test("integration: getNotesForDeck supports quoted deck names and splitBasicNotes", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `Too Many Cards Integration \"${suffix}\"`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const deckTag = `tmc_it_deck_${suffix}`;
	cleanup.trackTag(deckTag);

	const basicId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `deck-basic-${suffix}`, Back: "back" },
			tags: [deckTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(basicId);

	const clozeId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Cloze",
			fields: { Text: `Cloze {{c1::item}} ${suffix}`, Extra: "extra" },
			tags: [deckTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(clozeId);

	const infos = await getNotesForDeck(client, deckName);
	assert.equal(infos.length, 2, "deck query should return both notes");
	const split = splitBasicNotes(infos);
	assert.equal(split.basic.length, 1, "should keep one Basic note");
	assert.equal(split.skippedNonBasic, 1, "should skip one non-Basic note");
});

test("integration: getPluginManagedNotes returns only obsidian-tagged notes", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Managed ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const managedId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `managed-${suffix}`, Back: "back" },
			tags: [SYNC_TAG, `tmc_it_managed_${suffix}`],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(managedId);
	cleanup.trackTag(`tmc_it_managed_${suffix}`);

	const unmanagedId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `unmanaged-${suffix}`, Back: "back" },
			tags: [`tmc_it_unmanaged_${suffix}`],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(unmanagedId);
	cleanup.trackTag(`tmc_it_unmanaged_${suffix}`);

	const managed = await getPluginManagedNotes(client, SYNC_TAG);
	const managedIds = new Set(managed.map((x) => x.noteId));
	assert.ok(managedIds.has(managedId), "obsidian-tagged note should be returned");
});

test("integration: addManagedTag preserves existing note tags", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Tagging ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const keepTag = `tmc_it_keep_this_${suffix}`;
	cleanup.trackTag(keepTag);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `tagging-${suffix}`, Back: "back" },
			tags: [keepTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	await addManagedTag(client, [noteId], SYNC_TAG);
	const info = (await client.notesInfo([noteId]))[0];
	const tags = info.tags.map((x) => x.toLowerCase());
	assert.ok(tags.includes(keepTag.toLowerCase()));
	assert.ok(tags.includes(SYNC_TAG.toLowerCase()));
});
