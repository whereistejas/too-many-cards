import { AnkiConnectClient, type AnkiNoteInfo } from "./anki-connect";
import { toAnkiTag } from "./anki-tag-policy";

function escapeQueryTerm(term: string): string {
	const escaped = term.replace(/"/g, '\\"');
	return `"${escaped}"`;
}

export async function getNotesForDeck(anki: AnkiConnectClient, deckName: string): Promise<AnkiNoteInfo[]> {
	const query = `deck:${escapeQueryTerm(deckName)}`;
	const noteIds = await anki.findNotes(query);
	return anki.notesInfo(noteIds);
}

export async function getPluginManagedNotes(anki: AnkiConnectClient, syncTag: string): Promise<AnkiNoteInfo[]> {
	const noteIds = await anki.findNotes(`tag:${toAnkiTag(syncTag)}`);
	return anki.notesInfo(noteIds);
}

export function splitBasicNotes(infos: AnkiNoteInfo[]): {
	basic: AnkiNoteInfo[];
	skippedNonBasic: number;
} {
	const basic: AnkiNoteInfo[] = [];
	let skippedNonBasic = 0;
	for (const info of infos) {
		if (info.modelName === "Basic") basic.push(info);
		else skippedNonBasic += 1;
	}
	return { basic, skippedNonBasic };
}

export async function addManagedTag(anki: AnkiConnectClient, noteIds: number[], syncTag: string): Promise<void> {
	if (noteIds.length === 0) return;
	await anki.invoke("addTags", { notes: noteIds, tags: toAnkiTag(syncTag) });
}
