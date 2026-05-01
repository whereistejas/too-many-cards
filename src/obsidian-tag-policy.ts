import { normalizeObsidianTag } from "./anki-tag-policy";

export interface LinkerDescriptor {
	basename: string;
	title?: string | null;
}

export function tagFromLinker(linker: LinkerDescriptor): string {
	const preferred = linker.title && linker.title.trim().length > 0 ? linker.title : linker.basename;
	return normalizeObsidianTag(preferred);
}

export function buildManagedTags(syncTag: string, incomingLinkTags: string[], existingTags: string[] = []): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (tag: string) => {
		const normalized = normalizeObsidianTag(tag);
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		out.push(normalized);
	};
	push(syncTag);
	for (const tag of existingTags) push(tag);
	for (const tag of incomingLinkTags) push(tag);
	return out;
}
