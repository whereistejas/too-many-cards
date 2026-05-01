import { MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import { AnkiConnectClient, AnkiConnectError, type AnkiNoteInfo } from "./anki-connect";
import { parseCardSections } from "./card-parser";
import { CardConverter } from "./conversion";
import { addIncomingLinkTagsToAnki, normalizeObsidianTag, toAnkiTag } from "./anki-tag-policy";
import { addManagedTag, getNotesForDeck, getPluginManagedNotes, splitBasicNotes } from "./anki-command-api";
import { applyStatusToFrontmatter, getAnkiStatusForNote } from "./anki-status-policy";
import { buildManagedTags, tagFromLinker } from "./obsidian-tag-policy";
import type TooManyCardsPlugin from "./main";
import type { CardFileRecord, DuplicateGroup } from "./types";
import {
	collectMarkdownFilesInFolder,
	normalizeFrontForDuplicateCheck,
	truncateText,
} from "./utils";

interface SyncRunResult {
	invalidFiles: string[];
	duplicateGroups: DuplicateGroup[];
	failedCards: string[];
}

interface EnqueueOptions {
	force?: boolean;
	scope?: "all" | "obsidian-tag" | "deck";
	deckName?: string;
	chainPullAfter?: boolean;
}

export class SyncService {
	private running = false;
	private queued = false;
	private ignoreModifyUntil = new Map<string, number>();

	constructor(private readonly plugin: TooManyCardsPlugin) {}

	async enqueueSync(reason: string, options: EnqueueOptions = {}): Promise<void> {
		this.plugin.debug("Enqueue sync requested", { reason, options, running: this.running, queued: this.queued });
		if (this.running) {
			this.queued = true;
			this.plugin.debug("Sync already running; queued follow-up", { reason });
			return;
		}
		this.running = true;
		this.plugin.state.inFlightSync = true;
		await this.plugin.savePluginData();

		try {
			const completed = await this.runSync(reason, options);
			if (completed) {
				this.plugin.state.lastSuccessfulSyncTs = Math.floor(Date.now() / 1000);
				this.plugin.debug("Sync completed", { reason, lastSuccessfulSyncTs: this.plugin.state.lastSuccessfulSyncTs });
				if (options.chainPullAfter) {
					this.plugin.debug("Chaining pull after sync", { reason });
					await this.runSync(`${reason}:chained-pull`, { scope: "obsidian-tag" });
				}
			} else {
				this.plugin.debug("Sync ended early", { reason });
			}
		} catch (err) {
			this.plugin.debug("Sync run failed", { reason, error: err instanceof Error ? err.message : String(err) });
			this.handleSyncError(err);
		} finally {
			this.running = false;
			this.plugin.debug("Sync finalize", { reason, queued: this.queued });
			this.plugin.state.inFlightSync = false;
			await this.plugin.savePluginData();
			if (this.queued) {
				this.queued = false;
				void this.enqueueSync("queued-follow-up", options);
			}
		}
	}

	private handleSyncError(err: unknown): void {
		this.plugin.debug("handleSyncError", { error: err instanceof Error ? err.message : String(err) });
		if (err instanceof AnkiConnectError) {
			if (err.kind === "cors") {
				this.plugin.notify('AnkiConnect rejected origin. Add "app://obsidian.md" to webCorsOriginList in AnkiConnect\'s config.', 7000, "error");
				return;
			}
			if (err.kind === "network" && !this.plugin.firstConnectionFailureShown) {
				this.plugin.firstConnectionFailureShown = true;
				this.plugin.notify("Anki sync unavailable. Start Anki and install/enable the AnkiConnect add-on.", 7000, "error");
				return;
			}
		}
		const message = err instanceof Error ? err.message : String(err);
		this.plugin.notify(`Anki sync failed: ${message}`, 5000, "error");
	}

	private getAnkiClient(): AnkiConnectClient {
		return new AnkiConnectClient(this.plugin.settings.ankiConnectUrl);
	}

	private parseStoredAnkiMod(value: unknown): number | null {
		if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
		if (value instanceof Date) return Math.floor(value.getTime() / 1000);
		if (typeof value === "string") {
			const numeric = Number.parseInt(value, 10);
			if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) return numeric;
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
		}
		return null;
	}

	private formatAnkiModForFrontmatter(mod: number): string {
		return new Date(mod * 1000).toISOString();
	}

	private normalizeAlias(front: string): string {
		return front.replace(/\s+/g, " ").trim();
	}

	private normalizeBack(back: string): string {
		return back.replace(/\s+/g, " ").trim();
	}

	private escapeYamlDoubleQuoted(value: string): string {
		return value.replace(/"/g, "\\\"");
	}

	private getManagedTags(incomingLinkTags: string[], existingTags: string[] = []): string[] {
		return buildManagedTags(this.plugin.settings.syncTag, incomingLinkTags, existingTags);
	}

	private async writeDerivedTagsToFile(file: TFile, incomingLinkTags: string[], existingTags: string[] = []): Promise<void> {
		const managedTags = this.getManagedTags(incomingLinkTags, existingTags);
		await this.upsertFrontmatter(file, (fm) => {
			if (managedTags.length > 0) {
				fm.tags = managedTags;
			} else {
				delete fm.tags;
			}
			delete fm.anki_tags;
		});
	}

	private async writeAliasesToFile(file: TFile, front: string): Promise<void> {
		const alias = this.normalizeAlias(front);
		await this.upsertFrontmatter(file, (fm) => {
			if (alias.length > 0) fm.aliases = [alias];
			else delete fm.aliases;
			delete fm.alias;
		});
	}

	private async writeBackToFile(file: TFile, back: string): Promise<void> {
		const normalizedBack = this.normalizeBack(back);
		await this.upsertFrontmatter(file, (fm) => {
			if (normalizedBack.length > 0) fm.back = normalizedBack;
			else delete fm.back;
		});
	}

	private async deriveTags(file: TFile): Promise<string[]> {
		const backlinks = (this.plugin.app.metadataCache as unknown as {
			getBacklinksForFile?: (f: TFile) => { data?: Map<string, unknown> };
		}).getBacklinksForFile?.(file);
		const data = backlinks?.data;
		if (!data) return [];
		const tags = new Set<string>();
		for (const path of data.keys()) {
			if (path === file.path) continue;
			if (!path.toLowerCase().endsWith(".md")) continue;
			const linker = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(linker instanceof TFile)) continue;
			const linkerFm = this.plugin.app.metadataCache.getFileCache(linker)?.frontmatter as Record<string, unknown> | undefined;
			const title = typeof linkerFm?.title === "string" ? linkerFm.title : null;
			const tag = tagFromLinker({ basename: linker.basename, title });
			if (tag) tags.add(tag);
		}
		return [...tags].sort((a, b) => a.localeCompare(b));
	}

	private parseNoteIdFromFile(file: TFile): number | null {
		if (!/^\d+$/.test(file.basename)) return null;
		const parsed = Number.parseInt(file.basename, 10);
		return Number.isFinite(parsed) ? parsed : null;
	}

	private async parseCardFiles(): Promise<{
		records: CardFileRecord[];
		invalidFiles: string[];
	}> {
		const files = collectMarkdownFilesInFolder(this.plugin.app.vault, this.plugin.settings.cardsFolder);
		const records: CardFileRecord[] = [];
		const invalidFiles: string[] = [];
		for (const file of files) {
			const markdown = await this.plugin.app.vault.cachedRead(file);
			const parsed = parseCardSections(markdown);
			if (parsed.missingSections.length > 0) {
				invalidFiles.push(file.path);
				continue;
			}
			const fm = (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
			const legacyAnkiId = typeof fm.anki_id === "number" ? fm.anki_id : null;
			records.push({
				path: file.path,
				basename: file.basename,
				ankiId: this.parseNoteIdFromFile(file) ?? legacyAnkiId,
				ankiMod: this.parseStoredAnkiMod(fm.last_modified ?? fm.anki_mod),
				status: Array.isArray(fm.anki_status) ? (fm.anki_status.filter((x): x is string => typeof x === "string")) : [],
				storedTags: Array.isArray(fm.tags) ? fm.tags.filter((x): x is string => typeof x === "string").map((t) => normalizeObsidianTag(t)).filter(Boolean) : [],
				front: parsed.front,
				back: parsed.back,
			});
		}
		return { records, invalidFiles };
	}

	private detectDuplicates(records: CardFileRecord[]): DuplicateGroup[] {
		const grouped = new Map<string, CardFileRecord[]>();
		for (const record of records) {
			const key = normalizeFrontForDuplicateCheck(record.front);
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key)?.push(record);
		}
		const out: DuplicateGroup[] = [];
		for (const [normalizedFront, items] of grouped.entries()) {
			if (items.length > 1) out.push({ normalizedFront, items });
		}
		return out;
	}

	private findSkipsFromDuplicates(duplicateGroups: DuplicateGroup[]): Set<string> {
		const skipped = new Set<string>();
		for (const group of duplicateGroups) {
			const withId = group.items.filter((item) => item.ankiId !== null);
			if (withId.length === 1) {
				const keeper = withId[0];
				if (!keeper) continue;
				for (const item of group.items) {
					if (item.path !== keeper.path) skipped.add(item.path);
				}
				continue;
			}
			for (const item of group.items) skipped.add(item.path);
		}
		return skipped;
	}

	private async upsertFrontmatter(file: TFile, update: (fm: Record<string, unknown>) => void): Promise<void> {
		this.ignoreModifyUntil.set(file.path, Date.now() + 2500);
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => update(fm as Record<string, unknown>));
	}

	private async ensureFileNameByNoteId(file: TFile, noteId: number): Promise<TFile> {
		const desiredBase = String(noteId);
		if (file.basename === desiredBase) return file;
		const parent = file.parent?.path;
		const desiredPath = parent ? normalizePath(`${parent}/${desiredBase}.md`) : `${desiredBase}.md`;
		const existing = this.plugin.app.vault.getAbstractFileByPath(desiredPath);
		if (existing && existing.path !== file.path) {
			throw new Error(`Cannot rename ${file.path} to ${desiredPath}: target exists.`);
		}
		await this.plugin.app.fileManager.renameFile(file, desiredPath);
		const renamed = this.plugin.app.vault.getAbstractFileByPath(desiredPath);
		return renamed instanceof TFile ? renamed : file;
	}

	private async writeStatusToFile(file: TFile, status: string[]): Promise<void> {
		await this.upsertFrontmatter(file, (fm) => {
			applyStatusToFrontmatter(fm, status);
		});
	}

	private formatDuplicateToast(groups: DuplicateGroup[]): string {
		const lines = groups.map((group) => {
			const front = truncateText(group.items[0]?.front ?? group.normalizedFront, 80);
			const files = group.items.map((i) => i.path).join(", ");
			return `- "${front}" (${files})`;
		});
		return `${groups.length} duplicate Fronts skipped:\n${lines.join("\n")}`;
	}

	private async maybeAbortForDeleteSanity(
		localDeleteCount: number,
		remoteDeleteCount: number,
		localCount: number,
		remoteCount: number,
		force: boolean,
	): Promise<boolean> {
		if (force) return false;
		const localRatio = localCount > 0 ? localDeleteCount / localCount : 0;
		const remoteRatio = remoteCount > 0 ? remoteDeleteCount / remoteCount : 0;
		if (localRatio > 0.25 || remoteRatio > 0.25) {
			this.plugin.notify(`Sync aborted: would delete ${Math.max(localDeleteCount, remoteDeleteCount)} cards. Investigate or run with --force.`, 7000, "error");
			return true;
		}
		return false;
	}

	private async runSync(reason: string, options: EnqueueOptions): Promise<boolean> {
		this.plugin.debug("Starting runSync", { reason, options });
		const anki = this.getAnkiClient();
		await anki.version();
		this.plugin.debug("AnkiConnect reachable");
		const converter = new CardConverter(this.plugin.app, anki, this.plugin.settings.mediaFolder);

		const { records, invalidFiles } = await this.parseCardFiles();
		const duplicateGroups = this.detectDuplicates(records);
		const skippedDueToDuplicate = this.findSkipsFromDuplicates(duplicateGroups);
		this.plugin.debug("Parsed local cards", {
			recordCount: records.length,
			invalidCount: invalidFiles.length,
			duplicateGroupCount: duplicateGroups.length,
			skippedDueToDuplicateCount: skippedDueToDuplicate.size,
		});

		const localById = new Map<number, CardFileRecord>();
		for (const record of records) {
			if (record.ankiId !== null) localById.set(record.ankiId, record);
		}

		const remoteManagedInfos = await getPluginManagedNotes(anki, this.plugin.settings.syncTag);
		const remoteManagedIds = remoteManagedInfos.map((info) => info.noteId);
		this.plugin.debug("Fetched remote managed note IDs", { count: remoteManagedIds.length });
		if (options.scope === "obsidian-tag") {
			this.plugin.debug("Executing pull-plugin-managed import branch", {
				remoteManagedCount: remoteManagedInfos.length,
			});
			const { basic, skippedNonBasic } = splitBasicNotes(remoteManagedInfos);
			const importResult = await this.importNoteInfosIntoVault(anki, converter, basic, {
				tagAsObsidian: false,
				sourceLabel: "pull-plugin-managed",
			});
			this.plugin.notify(`Pulled ${importResult.imported} plugin-managed notes from Anki.`, 5000);
			if (skippedNonBasic > 0) {
				this.plugin.notify(`${skippedNonBasic} non-Basic notes skipped during pull.`, 8000, "error");
			}
			if (importResult.failures > 0) {
				this.plugin.notify(`Pull finished with ${importResult.failures} failures. Check debug log.`, 8000, "error");
			}
			return true;
		}
		const remoteIdSet = new Set(remoteManagedIds);
		const orphanRemoteIds = remoteManagedIds.filter((id) => !localById.has(id));

		const toTrashLocally: TFile[] = [];
		for (const record of records) {
			if (record.ankiId !== null && !remoteIdSet.has(record.ankiId)) {
				const f = this.plugin.app.vault.getAbstractFileByPath(record.path);
				if (f instanceof TFile) toTrashLocally.push(f);
			}
		}

		const abort = await this.maybeAbortForDeleteSanity(
			toTrashLocally.length,
			orphanRemoteIds.length,
			records.length,
			remoteManagedIds.length,
			Boolean(options.force),
		);

		if (abort) {
			this.plugin.debug("Sync aborted due to delete sanity check", {
				toTrashLocally: toTrashLocally.length,
				orphanRemoteIds: orphanRemoteIds.length,
			});
			return false;
		}

		for (const file of toTrashLocally) await this.plugin.app.vault.trash(file, false);
		if (orphanRemoteIds.length > 0) await anki.invoke("deleteNotes", { notes: orphanRemoteIds });
		this.plugin.debug("Applied deletion phase", {
			localTrashed: toTrashLocally.length,
			remoteDeleted: orphanRemoteIds.length,
		});

		const failedCards: string[] = [];
		const sticky = new Notice(`Syncing 0/${records.length}…`, 0);
		let done = 0;

		const newCardPayloads: Array<{ deckName: string; modelName: string; fields: { Front: string; Back: string }; tags: string[]; options: { allowDuplicate: boolean } }> = [];
		const newCardRefs: CardFileRecord[] = [];

		for (const record of records) {
			done += 1;
			sticky.setMessage(`Syncing ${done}/${records.length}… (${reason})`);
			if (skippedDueToDuplicate.has(record.path)) continue;

			const file = this.plugin.app.vault.getAbstractFileByPath(record.path);
			if (!(file instanceof TFile)) continue;
			try {
				let workingFile = file;
				let aliasFront = record.front;
				let frontmatterBack = record.back;
				const tags = await this.deriveTags(workingFile);
				await this.writeDerivedTagsToFile(workingFile, tags, record.storedTags);
				if (record.ankiId === null) {
					const frontHtml = await converter.markdownToAnkiHtml(record.front, workingFile.path);
					const backHtml = await converter.markdownToAnkiHtml(record.back, workingFile.path);
					newCardPayloads.push({
						deckName: this.plugin.settings.deckName,
						modelName: "Basic",
						fields: { Front: frontHtml, Back: backHtml },
						tags: this.getManagedTags(tags, record.storedTags).map((tag) => toAnkiTag(tag)),
						options: { allowDuplicate: false },
					});
					newCardRefs.push(record);
					continue;
				}

				const info = (await anki.notesInfo([record.ankiId]))[0];
				if (!info) continue;
				const remoteFrontMd = await converter.ankiHtmlToMarkdown(info.fields.Front?.value ?? "");
				const remoteBackMd = await converter.ankiHtmlToMarkdown(info.fields.Back?.value ?? "");
				if ((record.ankiMod ?? 0) < info.mod) {
					const rebuilt = `## Front\n${remoteFrontMd}\n\n## Back\n${remoteBackMd}\n`;
					aliasFront = remoteFrontMd;
					frontmatterBack = remoteBackMd;
					this.ignoreModifyUntil.set(workingFile.path, Date.now() + 2500);
					await this.plugin.app.vault.modify(workingFile, rebuilt);
					await this.upsertFrontmatter(workingFile, (fm) => {
						fm.last_modified = this.formatAnkiModForFrontmatter(info.mod);
						delete fm.anki_mod;
						delete fm.anki_id;
					});
				} else {
					const frontHtml = await converter.markdownToAnkiHtml(record.front, workingFile.path);
					const backHtml = await converter.markdownToAnkiHtml(record.back, workingFile.path);
					const changed = frontHtml.trim() !== (info.fields.Front?.value ?? "").trim() || backHtml.trim() !== (info.fields.Back?.value ?? "").trim();
					if (changed) {
						await anki.invoke("updateNoteFields", {
							note: { id: record.ankiId, fields: { Front: frontHtml, Back: backHtml } },
						});
					}
					const tagsToSync = this.getManagedTags(tags, record.storedTags);
					await addIncomingLinkTagsToAnki(anki, record.ankiId, tagsToSync);
					const refreshed = (await anki.notesInfo([record.ankiId]))[0];
					if (refreshed) {
						await this.upsertFrontmatter(workingFile, (fm) => {
							fm.last_modified = this.formatAnkiModForFrontmatter(refreshed.mod);
							delete fm.anki_mod;
						});
					}
				}
				workingFile = await this.ensureFileNameByNoteId(workingFile, record.ankiId);
				const status = await getAnkiStatusForNote(anki, record.ankiId);
				await this.writeStatusToFile(workingFile, status);
				await this.writeAliasesToFile(workingFile, aliasFront);
				await this.writeBackToFile(workingFile, frontmatterBack);
			} catch (err) {
				failedCards.push(`${record.path}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		for (let i = 0; i < newCardPayloads.length; i += 75) {
			const batch = newCardPayloads.slice(i, i + 75);
			const batchRefs = newCardRefs.slice(i, i + 75);
			const ids = await anki.invoke<Array<number | null>>("addNotes", { notes: batch });
			const successIds = ids.filter((id): id is number => typeof id === "number");
			const infos = await anki.notesInfo(successIds);
			const infoMap = new Map<number, AnkiNoteInfo>(infos.map((x) => [x.noteId, x]));
			for (let idx = 0; idx < ids.length; idx++) {
				const id = ids[idx];
				const record = batchRefs[idx];
				if (!record || id === undefined) continue;
				if (id === null) {
					failedCards.push(`${record.path}: duplicate or rejected by Anki`);
					continue;
				}
				const file = this.plugin.app.vault.getAbstractFileByPath(record.path);
				if (!(file instanceof TFile)) continue;
				const renamedFile = await this.ensureFileNameByNoteId(file, id);
				const status = await getAnkiStatusForNote(anki, id);
				await this.upsertFrontmatter(renamedFile, (fm) => {
					const mod = infoMap.get(id)?.mod;
					fm.last_modified = typeof mod === "number" ? this.formatAnkiModForFrontmatter(mod) : null;
					delete fm.anki_mod;
					delete fm.anki_id;
					if (status.includes("suspended")) fm.anki_status = ["suspended"];
					else delete fm.anki_status;
				});
				await this.writeAliasesToFile(renamedFile, record.front);
				await this.writeBackToFile(renamedFile, record.back);
			}
		}

		sticky.hide();
		this.plugin.debug("Sync processing finished", {
			failedCards: failedCards.length,
			createdCards: newCardPayloads.length,
		});

		if (invalidFiles.length > 0) {
			this.plugin.notify(`${invalidFiles.length} card files missing Front/Back: ${invalidFiles.join(", ")}`, 10000, "error");
		}
		if (duplicateGroups.length > 0) {
			this.plugin.notify(this.formatDuplicateToast(duplicateGroups), 10000, "error");
		}
		if (failedCards.length > 0) {
			this.plugin.notify(`Sync finished with ${failedCards.length} card failures.`, 10000, "error");
			this.plugin.debug("Per-card sync failures", { failedCards });
		}
		return true;
	}

	async pullPluginManagedNotes(): Promise<void> {
		await this.enqueueSync("pull-plugin-managed", { scope: "obsidian-tag" });
	}

	private getExistingAnkiIdsInVault(): Set<number> {
		const existing = new Set<number>();
		for (const file of collectMarkdownFilesInFolder(this.plugin.app.vault, this.plugin.settings.cardsFolder)) {
			const byName = this.parseNoteIdFromFile(file);
			if (byName !== null) {
				existing.add(byName);
				continue;
			}
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			if (typeof fm?.anki_id === "number") existing.add(fm.anki_id);
		}
		return existing;
	}

	private async importNoteInfosIntoVault(
		anki: AnkiConnectClient,
		converter: CardConverter,
		infos: AnkiNoteInfo[],
		options: { tagAsObsidian: boolean; sourceLabel: string },
	): Promise<{ imported: number; skippedExisting: number; failures: number }> {
		await this.ensureCardsFolder();
		const existing = this.getExistingAnkiIdsInVault();
		let imported = 0;
		let skippedExisting = 0;
		let failures = 0;
		const importedIds: number[] = [];
		this.plugin.debug("Importing note infos into vault", {
			source: options.sourceLabel,
			candidateCount: infos.length,
			existingCount: existing.size,
			tagAsObsidian: options.tagAsObsidian,
		});

		for (const info of infos) {
			try {
				if (existing.has(info.noteId)) {
					skippedExisting += 1;
					continue;
				}
				if (info.modelName !== "Basic") continue;
				const frontMd = await converter.ankiHtmlToMarkdown(info.fields.Front?.value ?? "");
				const backMd = await converter.ankiHtmlToMarkdown(info.fields.Back?.value ?? "");
				const target = normalizePath(`${this.plugin.settings.cardsFolder}/${info.noteId}.md`);
				const existingTarget = this.plugin.app.vault.getAbstractFileByPath(target);
				if (existingTarget && !(existingTarget instanceof TFile)) {
					throw new Error(`Target path exists and is not a file: ${target}`);
				}
				if (existingTarget instanceof TFile) {
					skippedExisting += 1;
					continue;
				}
				const status = await getAnkiStatusForNote(anki, info.noteId);
				const managedTags = this.getManagedTags(info.tags);
				const frontmatter = [
					"---",
					`last_modified: "${this.formatAnkiModForFrontmatter(info.mod)}"`,
					"aliases:",
					`  - "${this.escapeYamlDoubleQuoted(this.normalizeAlias(frontMd))}"`,
					`back: "${this.escapeYamlDoubleQuoted(this.normalizeBack(backMd))}"`,
					...(managedTags.length > 0 ? ["tags:", ...managedTags.map((tag) => `  - \"${this.escapeYamlDoubleQuoted(tag)}\"`)] : []),
					...(status.includes("suspended") ? ["anki_status:", "  - suspended"] : []),
					"---",
					"",
				].join("\n");
				const body = `${frontmatter}## Front\n${frontMd}\n\n## Back\n${backMd}\n`;
				await this.plugin.app.vault.create(target, body);
				if (options.tagAsObsidian) importedIds.push(info.noteId);
				existing.add(info.noteId);
				imported += 1;
			} catch (err) {
				failures += 1;
				this.plugin.debug("Failed importing note", {
					source: options.sourceLabel,
					noteId: info.noteId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		if (options.tagAsObsidian) {
			await addManagedTag(anki, importedIds, this.plugin.settings.syncTag);
		}

		this.plugin.debug("Import note infos complete", {
			source: options.sourceLabel,
			imported,
			skippedExisting,
			failures,
		});
		return { imported, skippedExisting, failures };
	}

	private async createCardInAnkiAndVault(front: string, back: string, sourcePath: string): Promise<number> {
		const anki = this.getAnkiClient();
		await anki.version();
		const converter = new CardConverter(this.plugin.app, anki, this.plugin.settings.mediaFolder);
		const frontHtml = await converter.markdownToAnkiHtml(front, sourcePath);
		const backHtml = await converter.markdownToAnkiHtml(back, sourcePath);
		const noteId = await anki.invoke<number>("addNote", {
			note: {
				deckName: this.plugin.settings.deckName,
				modelName: "Basic",
				fields: { Front: frontHtml, Back: backHtml },
				tags: [toAnkiTag(this.plugin.settings.syncTag)],
				options: { allowDuplicate: false },
			},
		});
		const info = (await anki.notesInfo([noteId]))[0];
		const mod = info?.mod ?? Math.floor(Date.now() / 1000);
		const status = await getAnkiStatusForNote(anki, noteId);
		await this.ensureCardsFolder();
		const target = normalizePath(`${this.plugin.settings.cardsFolder}/${noteId}.md`);
		if (!this.plugin.app.vault.getAbstractFileByPath(target)) {
			const managedTags = this.getManagedTags([]);
			const frontmatter = [
				"---",
				`last_modified: "${this.formatAnkiModForFrontmatter(mod)}"`,
				"aliases:",
				`  - "${this.escapeYamlDoubleQuoted(this.normalizeAlias(front))}"`,
				`back: "${this.escapeYamlDoubleQuoted(this.normalizeBack(back))}"`,
				...(managedTags.length > 0 ? ["tags:", ...managedTags.map((tag) => `  - \"${this.escapeYamlDoubleQuoted(tag)}\"`)] : []),
				...(status.includes("suspended") ? ["anki_status:", "  - suspended"] : []),
				"---",
				"",
			].join("\n");
			await this.plugin.app.vault.create(target, `${frontmatter}## Front\n${front}\n\n## Back\n${back}\n`);
		}
		return noteId;
	}

	async createCardsFromCalloutsInActiveNote(): Promise<void> {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) {
			this.plugin.notify("No active note to process.", 4000, "error");
			return;
		}
		const source = await this.plugin.app.vault.cachedRead(file);
		const calloutRe = /^> \[!card\]([+-])?\s+([^\n]+)\n((?:>.*(?:\n|$))*)/gm;
		const matches: Array<{ start: number; end: number; fold: string; front: string; back: string }> = [];
		for (const m of source.matchAll(calloutRe)) {
			const full = m[0];
			const index = m.index;
			if (!full || index === undefined) continue;
			const front = (m[2] ?? "").trim();
			if (!front || front.includes("[[")) continue;
			const fold = m[1] ?? "";
			const quotedBody = m[3] ?? "";
			const back = quotedBody
				.split(/\r?\n/)
				.map((line) => line.replace(/^>\s?/, ""))
				.join("\n")
				.trim();
			if (!back) continue;
			matches.push({ start: index, end: index + full.length, fold, front, back });
		}
		if (matches.length === 0) {
			this.plugin.notify("No convertible [!card] callouts found.", 4000);
			return;
		}

		let output = "";
		let cursor = 0;
		let created = 0;
		for (const match of matches) {
			output += source.slice(cursor, match.start);
			try {
				const noteId = await this.createCardInAnkiAndVault(match.front, match.back, file.path);
				output += `> [!card${match.fold}] [[${noteId}]]\n`;
				created += 1;
			} catch (err) {
				this.plugin.debug("Failed creating card from callout", {
					file: file.path,
					front: match.front,
					error: err instanceof Error ? err.message : String(err),
				});
				output += source.slice(match.start, match.end);
			}
			cursor = match.end;
		}
		output += source.slice(cursor);
		if (output !== source) {
			this.ignoreModifyUntil.set(file.path, Date.now() + 2000);
			await this.plugin.app.vault.modify(file, output);
		}
		if (created > 0) {
			this.plugin.notify(`Created ${created} card${created === 1 ? "" : "s"} from callouts.`, 5000);
		} else {
			this.plugin.notify("No cards were created from callouts.", 4000, "error");
		}
	}

	async importDeck(deckName: string): Promise<void> {
		this.plugin.debug("Starting deck import", { deckName });
		const anki = this.getAnkiClient();
		await anki.version();
		const converter = new CardConverter(this.plugin.app, anki, this.plugin.settings.mediaFolder);
		const infos = await getNotesForDeck(anki, deckName);
		this.plugin.debug("Fetched deck note infos", { deckName, infoCount: infos.length });
		const { basic, skippedNonBasic } = splitBasicNotes(infos);
		const result = await this.importNoteInfosIntoVault(anki, converter, basic, {
			tagAsObsidian: true,
			sourceLabel: `import-deck:${deckName}`,
		});

		if (skippedNonBasic > 0) this.plugin.notify(`${skippedNonBasic} non-Basic notes skipped — only Basic is supported.`, 8000, "error");
		if (result.failures > 0) this.plugin.notify(`Import finished with ${result.failures} failures. Check debug log.`, 8000, "error");
		this.plugin.notify(`Imported ${result.imported} notes from deck \"${deckName}\".`, 5000);
		this.plugin.debug("Deck import complete", { deckName, skippedNonBasic, ...result });
	}

	private async ensureCardsFolder(): Promise<void> {
		const folder = normalizePath(this.plugin.settings.cardsFolder);
		if (this.plugin.app.vault.getAbstractFileByPath(folder)) return;
		const parts = folder.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
				await this.plugin.app.vault.createFolder(current);
			}
		}
	}
}
