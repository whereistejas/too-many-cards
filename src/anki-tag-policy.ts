import { AnkiConnectClient } from "./anki-connect";

export function toAnkiTag(obsidianTag: string): string {
	return obsidianTag.trim().replace(/\//g, "::");
}

export function toObsidianTag(ankiTag: string): string {
	return ankiTag.trim().replace(/::/g, "/");
}

export function normalizeObsidianTag(raw: string): string {
	return raw.trim().replace(/\s+/g, "_").replace(/::/g, "/");
}

export async function addIncomingLinkTagsToAnki(
	anki: Pick<AnkiConnectClient, "invoke">,
	noteId: number,
	incomingLinkTags: string[],
): Promise<void> {
	const normalized = incomingLinkTags
		.map((tag) => normalizeObsidianTag(tag))
		.filter((tag) => tag.length > 0)
		.map((tag) => toAnkiTag(tag));
	if (normalized.length === 0) return;
	await anki.invoke("addTags", { notes: [noteId], tags: normalized.join(" ") });
}
