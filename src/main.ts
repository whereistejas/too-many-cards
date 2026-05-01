import { Notice, Plugin } from "obsidian";
import { TooManyCardsSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type PersistedData, type PluginSettings, type PluginState } from "./types";
import { SyncService } from "./sync-service";
import { PromptModal } from "./prompt-modal";
import { registerReadingModeRenderers } from "./rendering";

const DEFAULT_STATE: PluginState = {
	inFlightSync: false,
	lastSuccessfulSyncTs: null,
};

export default class TooManyCardsPlugin extends Plugin {
	settings: PluginSettings = { ...DEFAULT_SETTINGS };
	state: PluginState = { ...DEFAULT_STATE };
	syncService!: SyncService;
	firstConnectionFailureShown = false;
	private debugBuffer: string[] = [];

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.state.inFlightSync = false;
		await this.savePluginData();

		this.syncService = new SyncService(this);
		registerReadingModeRenderers(this);

		this.addCommand({
			id: "sync-to-anki",
			name: "Sync to Anki",
			callback: () => void this.syncService.enqueueSync("manual"),
		});

		this.addCommand({
			id: "pull-plugin-managed-notes",
			name: "Pull plugin-managed notes",
			callback: () => void this.syncService.pullPluginManagedNotes(),
		});

		this.addCommand({
			id: "create-new-card",
			name: "Create new card",
			callback: () => void this.syncService.createNewCard(),
		});

		this.addCommand({
			id: "create-cards-from-callouts",
			name: "Create cards from [!card] callouts",
			callback: () => void this.syncService.createCardsFromCalloutsInActiveNote(),
		});

		this.addCommand({
			id: "import-deck",
			name: "Import deck…",
			callback: () => {
				new PromptModal(this.app, "Import deck", "Deck name", (deckName) => {
					this.debug("Import deck command invoked", { deckName });
					void this.syncService.importDeck(deckName).catch((err) => {
						this.debug("Import deck command failed", {
							deckName,
							error: err instanceof Error ? err.message : String(err),
						});
						this.notify(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 7000, "error");
					});
				}).open();
			},
		});

		this.addCommand({
			id: "copy-debug-log",
			name: "Copy debug log",
			callback: async () => {
				const payload = this.getDebugLog();
				if (!payload) {
					this.notify("Debug log is empty.", 3000);
					return;
				}
				try {
					await navigator.clipboard.writeText(payload);
					this.notify("Debug log copied to clipboard.", 3000);
				} catch {
					this.notify("Could not copy to clipboard. Check console output.", 5000, "error");
					console.log(payload);
				}
			},
		});

		this.addCommand({
			id: "clear-debug-log",
			name: "Clear debug log",
			callback: () => {
				this.clearDebugLog();
				this.notify("Debug log cleared.", 2000);
			},
		});

		this.addSettingTab(new TooManyCardsSettingTab(this.app, this));
	}

	async loadPluginData(): Promise<void> {
		const data = ((await this.loadData()) as PersistedData | null) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
		this.state = { ...DEFAULT_STATE, ...(data.state ?? {}) };
	}

	async savePluginData(): Promise<void> {
		await this.saveData({ settings: this.settings, state: this.state });
	}

	private appendDebugLine(message: string, data?: unknown): string {
		const ts = new Date().toISOString();
		const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
		const line = `[TooManyCards ${ts}] ${message}${suffix}`;
		this.debugBuffer.push(line);
		if (this.debugBuffer.length > 500) this.debugBuffer.shift();
		return line;
	}

	debug(message: string, data?: unknown): void {
		const line = this.appendDebugLine(message, data);
		if (this.settings.debugLogging) console.log(line);
	}

	notify(message: string, timeoutMs = 5000, level: "info" | "error" = "info"): Notice {
		const line = this.appendDebugLine(`Notice(${level}): ${message}`);
		if (this.settings.debugLogging) {
			if (level === "error") console.error(line);
			else console.log(line);
		}
		return new Notice(message, timeoutMs);
	}

	getDebugLog(): string {
		return this.debugBuffer.join("\n");
	}

	clearDebugLog(): void {
		this.debugBuffer = [];
	}
}
