import { App, normalizePath, TFile } from "obsidian";
import MarkdownIt from "markdown-it";
import mathjax from "markdown-it-mathjax";
import TurndownService from "turndown";
import { AnkiConnectClient } from "./anki-connect";
import { arrayBufferToBase64, base64ToArrayBuffer, simpleHash } from "./utils";

export function fromAnkiMath(markdown: string): string {
	return markdown
		.replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$${body}$$`)
		.replace(/\\\(([^\n]+?)\\\)/g, (_, body: string) => `$${body}$`);
}

export class CardConverter {
	private readonly md = new MarkdownIt().use(mathjax());
	private readonly turndown = new TurndownService();

	constructor(
		private readonly app: App,
		private readonly anki: AnkiConnectClient,
		private readonly mediaFolder: string,
	) {}

	private async resolveAndUploadMarkdownImages(markdown: string, sourcePath: string): Promise<string> {
		let rewritten = markdown;
		const imageRefs: string[] = [];
		for (const m of markdown.matchAll(/!\[.*?\]\((.*?)\)|!\[\[(.*?)\]\]/g)) {
			const link = (m[1] ?? m[2] ?? "").trim();
			if (!link) continue;
			imageRefs.push(link);
		}

		const replaceAllLiteral = (value: string, search: string, replacement: string): string =>
			value.split(search).join(replacement);

		for (const ref of imageRefs) {
			const file = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath);
			if (!(file instanceof TFile)) continue;
			const bytes = await this.app.vault.readBinary(file);
			const hash = simpleHash(`${file.path}:${bytes.byteLength}`);
			const filename = `${file.basename}-${hash}.${file.extension}`;
			await this.anki.invoke("storeMediaFile", {
				filename,
				data: arrayBufferToBase64(bytes),
			});
			rewritten = replaceAllLiteral(rewritten, `![[${ref}]]`, `![](${filename})`);
			rewritten = replaceAllLiteral(rewritten, `![](${ref})`, `![](${filename})`);
		}
		return rewritten;
	}

	async markdownToAnkiHtml(markdown: string, sourcePath: string): Promise<string> {
		const withMedia = await this.resolveAndUploadMarkdownImages(markdown, sourcePath);
		return this.md.render(withMedia);
	}

	private async ensureMediaFolderExists(): Promise<void> {
		const parts = normalizePath(this.mediaFolder).split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private async pullAnkiImages(html: string): Promise<void> {
		await this.ensureMediaFolderExists();
		for (const m of html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
			const filename = m[1]?.trim();
			if (!filename) continue;
			const base64 = await this.anki.invoke<string>("retrieveMediaFile", { filename });
			const targetPath = normalizePath(`${this.mediaFolder}/${filename}`);
			if (!this.app.vault.getAbstractFileByPath(targetPath)) {
				await this.app.vault.createBinary(targetPath, base64ToArrayBuffer(base64));
			}
		}
	}

	async ankiHtmlToMarkdown(html: string): Promise<string> {
		await this.pullAnkiImages(html);
		const markdown = this.turndown.turndown(html).replace(/!\[[^\]]*\]\(([^)]+)\)/g, "![[${'$1'}]]");
		return fromAnkiMath(markdown);
	}
}
