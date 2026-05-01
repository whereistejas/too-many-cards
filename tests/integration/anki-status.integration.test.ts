import assert from "node:assert/strict";
import test from "node:test";
import { AnkiConnectClient } from "../../src/anki-connect";
import { getAnkiStatusForNote } from "../../src/anki-status-policy";
import { ANKI_URL, isAnkiReachable, makeSuffix, registerAnkiTestCleanup } from "./helpers";

test("integration: getAnkiStatusForNote returns suspended when card is suspended", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Status ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const statusTag = `tmc_it_status_${suffix}`;
	cleanup.trackTag(statusTag);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `status-front-${suffix}`, Back: "status-back" },
			tags: [statusTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	const cardIds = await client.invoke<number[]>("findCards", { query: `nid:${noteId}` });
	await client.invoke("suspend", { cards: cardIds });

	const status = await getAnkiStatusForNote(client, noteId);
	assert.deepEqual(status, ["suspended"]);
});

test("integration: getAnkiStatusForNote clears suspended after unsuspend", async (t) => {
	const client = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(client))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, client);

	const suffix = makeSuffix();
	const deckName = `TMC IT Status Unsuspend ${suffix}`;
	cleanup.trackDeck(deckName);
	await client.invoke("createDeck", { deck: deckName });

	const statusTag = `tmc_it_status_${suffix}`;
	cleanup.trackTag(statusTag);

	const noteId = await client.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: `status-unsuspend-front-${suffix}`, Back: "status-back" },
			tags: [statusTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	const cardIds = await client.invoke<number[]>("findCards", { query: `nid:${noteId}` });
	await client.invoke("suspend", { cards: cardIds });
	await client.invoke("unsuspend", { cards: cardIds });

	const status = await getAnkiStatusForNote(client, noteId);
	assert.deepEqual(status, []);
});
