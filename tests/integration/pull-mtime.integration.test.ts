import assert from "node:assert/strict";
import test from "node:test";
import { AnkiConnectClient } from "../../src/anki-connect";
import { SyncService } from "../../src/sync-service";
import { DEFAULT_SETTINGS, type PluginSettings, type PluginState } from "../../src/types";
import type TooManyCardsPlugin from "../../src/main";
import { makeFakeApp, type FakeVault } from "./fake-vault";
import { ANKI_URL, SYNC_TAG, isAnkiReachable, makeSuffix, registerAnkiTestCleanup } from "./helpers";

interface FakePlugin {
	app: ReturnType<typeof makeFakeApp>["app"];
	settings: PluginSettings;
	state: PluginState;
	firstConnectionFailureShown: boolean;
	notifications: Array<{ message: string; timeout?: number; type?: string }>;
	notify(message: string, timeout?: number, type?: string): void;
	debug(message: string, data?: unknown): void;
	savePluginData(): Promise<void>;
}

function makeFakePlugin(settings: PluginSettings): { plugin: FakePlugin; vault: FakeVault } {
	const { app, vault } = makeFakeApp();
	const plugin: FakePlugin = {
		app,
		settings,
		state: { inFlightSync: false, lastSuccessfulSyncTs: null },
		firstConnectionFailureShown: false,
		notifications: [],
		notify(message, timeout, type) {
			this.notifications.push({ message, timeout, type });
		},
		debug() {},
		async savePluginData() {},
	};
	return { plugin, vault };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("integration: pull overwrites local card when Anki note has newer mod", async (t) => {
	const anki = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(anki))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, anki);

	const suffix = makeSuffix();
	const deckName = `TMC IT Pull ${suffix}`;
	cleanup.trackDeck(deckName);
	await anki.invoke("createDeck", { deck: deckName });

	const noteTag = `tmc_it_pull_${suffix}`;
	cleanup.trackTag(noteTag);
	cleanup.trackTag(SYNC_TAG);

	const initialFront = `pull-mtime-${suffix} v1`;
	const noteId = await anki.invoke<number>("addNote", {
		note: {
			deckName,
			modelName: "Basic",
			fields: { Front: initialFront, Back: "back v1" },
			tags: [SYNC_TAG, noteTag],
			options: { allowDuplicate: true },
		},
	});
	cleanup.trackNote(noteId);

	const settings: PluginSettings = {
		...DEFAULT_SETTINGS,
		ankiConnectUrl: ANKI_URL,
		deckName,
		syncTag: SYNC_TAG,
		cardsFolder: "Cards",
		mediaFolder: "Cards/_media",
	};
	const { plugin, vault } = makeFakePlugin(settings);
	const sync = new SyncService(plugin as unknown as TooManyCardsPlugin);

	await sync.pullPluginManagedNotes();

	const path = `Cards/${noteId}.md`;
	const afterFirstPull = vault.getFileContent(path);
	assert.ok(afterFirstPull, `expected vault file at ${path} after first pull`);
	assert.match(afterFirstPull, /v1/, "first pull should write v1 content");
	const initialInfo = (await anki.notesInfo([noteId]))[0];
	assert.ok(initialInfo, "Anki should return info for the new note");
	const initialMod = initialInfo.mod;

	// Anki's `mod` is in seconds; ensure enough wall-clock has passed for
	// the field update to register a new mod value.
	await sleep(1100);
	const updatedFront = `pull-mtime-${suffix} v2`;
	await anki.invoke("updateNoteFields", {
		note: {
			id: noteId,
			fields: { Front: updatedFront, Back: "back v2" },
		},
	});

	const updatedInfo = (await anki.notesInfo([noteId]))[0];
	assert.ok(updatedInfo, "Anki should return info after update");
	assert.ok(
		updatedInfo.mod > initialMod,
		`Anki mod should advance after updateNoteFields (was ${initialMod}, now ${updatedInfo.mod})`,
	);

	await sync.pullPluginManagedNotes();

	const afterSecondPull = vault.getFileContent(path);
	assert.ok(afterSecondPull, "vault file should still exist after second pull");
	assert.match(
		afterSecondPull,
		/v2/,
		"second pull should overwrite local card with newer Anki content",
	);
	assert.doesNotMatch(
		afterSecondPull,
		/v1/,
		"second pull should not retain stale v1 content",
	);
});

test("integration: pull deletes local card when Anki note no longer exists", async (t) => {
	const anki = new AnkiConnectClient(ANKI_URL);
	if (!(await isAnkiReachable(anki))) {
		t.skip(`AnkiConnect not reachable at ${ANKI_URL}`);
		return;
	}
	const cleanup = registerAnkiTestCleanup(t, anki);

	const suffix = makeSuffix();
	const deckName = `TMC IT PullDelete ${suffix}`;
	cleanup.trackDeck(deckName);
	await anki.invoke("createDeck", { deck: deckName });

	const noteTag = `tmc_it_pull_delete_${suffix}`;
	cleanup.trackTag(noteTag);
	cleanup.trackTag(SYNC_TAG);

	// Create four notes so the orphan-ratio sanity check (>25%) doesn't abort
	// after one is deleted (1/4 = 25%, not greater).
	const ids: number[] = [];
	for (let i = 0; i < 4; i++) {
		const id = await anki.invoke<number>("addNote", {
			note: {
				deckName,
				modelName: "Basic",
				fields: { Front: `pull-delete-${suffix}-${i}`, Back: `back ${i}` },
				tags: [SYNC_TAG, noteTag],
				options: { allowDuplicate: true },
			},
		});
		cleanup.trackNote(id);
		ids.push(id);
	}

	const settings: PluginSettings = {
		...DEFAULT_SETTINGS,
		ankiConnectUrl: ANKI_URL,
		deckName,
		syncTag: SYNC_TAG,
		cardsFolder: "Cards",
		mediaFolder: "Cards/_media",
	};
	const { plugin, vault } = makeFakePlugin(settings);
	const sync = new SyncService(plugin as unknown as TooManyCardsPlugin);

	await sync.pullPluginManagedNotes();

	for (const id of ids) {
		assert.ok(vault.getFileContent(`Cards/${id}.md`), `expected vault file for note ${id}`);
	}

	// Delete one note in Anki, then pull again.
	const deletedId = ids[0]!;
	await anki.invoke("deleteNotes", { notes: [deletedId] });

	await sync.pullPluginManagedNotes();

	assert.equal(
		vault.getFileContent(`Cards/${deletedId}.md`),
		null,
		"expected vault file to be removed after pull when Anki note is gone",
	);
	for (const id of ids.slice(1)) {
		assert.ok(
			vault.getFileContent(`Cards/${id}.md`),
			`expected remaining vault file for note ${id} to be untouched`,
		);
	}

	const summaries = plugin.notifications.filter((n) =>
		n.message.startsWith("Pulled from Anki:"),
	);
	const lastSummary = summaries[summaries.length - 1];
	assert.ok(lastSummary, "expected a 'Pulled from Anki' summary notification");
	assert.match(
		lastSummary.message,
		/1 deleted/,
		`summary should report 1 deleted (got: ${lastSummary.message})`,
	);
});
