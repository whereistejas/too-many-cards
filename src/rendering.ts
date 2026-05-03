import { MarkdownRenderer, Notice, TFile, setIcon, type MarkdownPostProcessorContext } from "obsidian";
import type TooManyCardsPlugin from "./main";
import { parseCardSections } from "./card-parser";
import { isWithinFolder, truncateText } from "./utils";

export function registerReadingModeRenderers(plugin: TooManyCardsPlugin): void {
	plugin.registerMarkdownPostProcessor(async (el, ctx) => {
		await renderCardCallouts(plugin, el, ctx);
		await renderInlineCardLinks(plugin, el, ctx);
	});
}

async function resolveCardTarget(plugin: TooManyCardsPlugin, linkEl: HTMLAnchorElement, sourcePath: string): Promise<TFile | null> {
	const linkpath = linkEl.getAttribute("data-href") ?? linkEl.getAttribute("href") ?? "";
	if (!linkpath) return null;
	const resolved = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
	if (!(resolved instanceof TFile)) return null;
	if (!isWithinFolder(resolved.path, plugin.settings.cardsFolder)) return null;
	return resolved;
}

async function renderInlineCardLinks(plugin: TooManyCardsPlugin, root: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
	const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"));
	for (const link of links) {
		if (link.closest("div.callout[data-callout='card']")) continue;
		const target = await resolveCardTarget(plugin, link, ctx.sourcePath);
		if (!target) continue;
		const markdown = await plugin.app.vault.cachedRead(target);
		const parsed = parseCardSections(markdown);
		if (parsed.missingSections.length > 0) continue;
		const alias = link.textContent?.trim();
		const front = alias && alias.length > 0 ? alias : parsed.front;
		const span = createSpan({ text: `${truncateText(front)} → ${truncateText(parsed.back)}` });
		span.addClass("tmc-inline-card");
		link.replaceWith(span);
	}
}

function createActionButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
	const button = createEl("button", {
		cls: "tmc-card-action-btn clickable-icon",
		attr: { type: "button", "aria-label": label, title: label },
	});
	setIcon(button, icon);
	button.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		onClick();
	});
	return button;
}

function renderCalloutActions(plugin: TooManyCardsPlugin, callout: Element, target: TFile, front: string, back: string): void {
	const actions = createDiv({ cls: "tmc-card-actions" });
	const openBtn = createActionButton("file-symlink", "Open card note", () => {
		void plugin.app.workspace.getLeaf(true).openFile(target);
	});
	const copyBtn = createActionButton("copy", "Copy card", async () => {
		const payload = `${front}\n---\n${back}`;
		try {
			await navigator.clipboard.writeText(payload);
			new Notice("Card copied.", 2000);
		} catch {
			new Notice("Could not copy card.", 3000);
		}
	});
	actions.appendChild(openBtn);
	actions.appendChild(copyBtn);
	callout.appendChild(actions);
}

async function renderCardCallouts(plugin: TooManyCardsPlugin, root: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
	const callouts = Array.from(root.querySelectorAll<HTMLElement>("div.callout[data-callout='card']"));
	for (const callout of callouts) {
		const title = callout.querySelector(".callout-title");
		if (!(title instanceof HTMLElement)) continue;
		let content = callout.querySelector(".callout-content") as HTMLElement | null;
		if (!(content instanceof HTMLElement)) {
			content = callout.createDiv({ cls: "callout-content" });
		}
		const links = Array.from(title.querySelectorAll<HTMLAnchorElement>("a.internal-link"));
		if (links.length !== 1) continue;
		const [onlyLink] = links;
		if (!onlyLink) continue;
		const target = await resolveCardTarget(plugin, onlyLink, ctx.sourcePath);
		if (!target) continue;
		const markdown = await plugin.app.vault.cachedRead(target);
		const parsed = parseCardSections(markdown);
		if (parsed.missingSections.length > 0) continue;
		callout.addClass("tmc-card-callout");
		const metadata = (callout.getAttribute("data-callout-metadata") ?? "").trim();
		if (metadata.includes("-") || metadata.includes("+")) {
			callout.addClass("is-collapsible");
			if (metadata.includes("-")) callout.addClass("is-collapsed");
			if (metadata.includes("+")) callout.removeClass("is-collapsed");
		}
		const titleInner = title.querySelector(".callout-title-inner") as HTMLElement | null;
		const questionMount = titleInner ?? title;
		questionMount.empty();
		content.empty();
		callout.querySelector(".tmc-card-actions")?.remove();

		const questionEl = questionMount.createDiv({ cls: "tmc-card-question" });
		const answerEl = content.createDiv({ cls: "tmc-card-answer" });

		await MarkdownRenderer.render(plugin.app, parsed.front, questionEl, ctx.sourcePath, plugin);
		await MarkdownRenderer.render(plugin.app, parsed.back, answerEl, ctx.sourcePath, plugin);
		renderCalloutActions(plugin, callout, target, parsed.front, parsed.back);
	}
}
