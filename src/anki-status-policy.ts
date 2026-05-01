import { AnkiConnectClient } from "./anki-connect";

export async function getAnkiStatusForNote(
	anki: Pick<AnkiConnectClient, "invoke">,
	noteId: number,
): Promise<string[]> {
	const cardIds = await anki.invoke<number[]>("findCards", { query: `nid:${noteId}` });
	if (cardIds.length === 0) return [];
	const suspended = await anki.invoke<boolean[]>("areSuspended", { cards: cardIds });
	return suspended.some(Boolean) ? ["suspended"] : [];
}

export function applyStatusToFrontmatter(fm: Record<string, unknown>, status: string[]): void {
	if (status.includes("suspended")) fm.anki_status = ["suspended"];
	else delete fm.anki_status;
}
