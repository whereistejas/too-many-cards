import { type TestContext } from "node:test";
import { AnkiConnectClient } from "../../src/anki-connect";

export const ANKI_URL = process.env.ANKI_CONNECT_URL ?? "http://localhost:8765";
export const SYNC_TAG = process.env.TMC_SYNC_TAG ?? "tmc_it_managed";

export async function isAnkiReachable(client: AnkiConnectClient): Promise<boolean> {
	try {
		await client.version();
		return true;
	} catch {
		return false;
	}
}

export function makeSuffix(): string {
	return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteDeckWithRetry(client: AnkiConnectClient, deck: string): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await client.invoke("deleteDecks", { decks: [deck], cardsToo: true });
			return;
		} catch (err) {
			if (attempt === 3) throw err;
			await sleep(150);
		}
	}
}

export function registerAnkiTestCleanup(t: TestContext, client: AnkiConnectClient) {
	const decks = new Set<string>();
	const notes = new Set<number>();
	const tags = new Set<string>();

	t.after(async () => {
		if (notes.size > 0) {
			await client.invoke("deleteNotes", { notes: [...notes] }).catch(() => undefined);
		}

		for (const tag of tags) {
			const tagged = await client.findNotes(`tag:${tag}`).catch(() => [] as number[]);
			if (tagged.length > 0) {
				await client.invoke("deleteNotes", { notes: tagged }).catch(() => undefined);
			}
		}

		for (const deck of decks) {
			await deleteDeckWithRetry(client, deck).catch((err) => {
				console.warn(`cleanup: failed deleting deck ${deck}:`, err);
			});
		}

		await client.invoke("clearUnusedTags").catch(() => undefined);

		const existingDecks = new Set(await client.invoke<string[]>("deckNames").catch(() => []));
		const leftovers = [...decks].filter((deck) => existingDecks.has(deck));
		if (leftovers.length > 0) {
			throw new Error(`cleanup failed; leftover decks: ${leftovers.join(", ")}`);
		}
	});

	return {
		trackDeck(deck: string): void {
			decks.add(deck);
		},
		trackNote(noteId: number): void {
			notes.add(noteId);
		},
		trackTag(tag: string): void {
			tags.add(tag);
		},
	};
}
