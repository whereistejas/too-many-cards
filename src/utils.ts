import { normalizePath, TAbstractFile, TFile, TFolder, Vault } from "obsidian";

export function normalizeFrontForDuplicateCheck(front: string): string {
	return front.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, max = 80): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function isMarkdownFile(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension === "md";
}

export function isWithinFolder(path: string, folder: string): boolean {
	const normalizedFolder = normalizePath(folder).replace(/\/$/, "");
	const normalizedPath = normalizePath(path);
	return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function collectMarkdownFilesInFolder(vault: Vault, folderPath: string): TFile[] {
	const root = vault.getAbstractFileByPath(normalizePath(folderPath));
	if (!(root instanceof TFolder)) return [];
	const out: TFile[] = [];
	const stack: TAbstractFile[] = [...root.children];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		if (current instanceof TFolder) {
			stack.push(...current.children);
			continue;
		}
		if (isMarkdownFile(current)) out.push(current);
	}
	return out;
}

export function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeFilename(raw: string): string {
	const cleaned = stripHtmlTags(raw)
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, " ")
		.trim();
	const truncated = cleaned.slice(0, 120).trim();
	return truncated.length > 0 ? truncated : "untitled-card";
}

export function simpleHash(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
