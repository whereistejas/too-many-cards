import { App, PluginSettingTab, Setting } from "obsidian";
import type TooManyCardsPlugin from "./main";

export class TooManyCardsSettingTab extends PluginSettingTab {
	plugin: TooManyCardsPlugin;

	constructor(app: App, plugin: TooManyCardsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Cards folder")
			.setDesc("All markdown files in this folder (recursively) are treated as cards.")
			.addText((text) =>
				text
					.setPlaceholder("Cards")
					.setValue(this.plugin.settings.cardsFolder)
					.onChange(async (value) => {
						this.plugin.settings.cardsFolder = value.trim() || "Cards";
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Deck name")
			.setDesc("Single destination Anki deck used for created cards.")
			.addText((text) =>
				text.setValue(this.plugin.settings.deckName).onChange(async (value) => {
					this.plugin.settings.deckName = value.trim() || "Default";
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl)
			.setName("AnkiConnect URL")
			.setDesc("Usually http://localhost:8765")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.ankiConnectUrl)
					.onChange(async (value) => {
						this.plugin.settings.ankiConnectUrl = value.trim() || "http://localhost:8765";
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Media folder")
			.setDesc("Where imported Anki images are stored in your vault.")
			.addText((text) =>
				text.setValue(this.plugin.settings.mediaFolder).onChange(async (value) => {
					this.plugin.settings.mediaFolder = value.trim() || "Cards/_media";
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Log detailed sync flow to console and in-memory debug buffer.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
					this.plugin.settings.debugLogging = value;
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl)
			.setName("Sync tag")
			.setDesc("Reserved Anki tag used to identify plugin-managed notes.")
			.addText((text) =>
				text.setValue(this.plugin.settings.syncTag).onChange(async (value) => {
					this.plugin.settings.syncTag = value.trim() || "obsidian";
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl).setName("Import").setHeading();

		let importDeckName = "";
		let importing = false;
		new Setting(containerEl)
			.setName("Import deck")
			.setDesc("One-shot import of an existing Anki deck. Tags imported notes as plugin-managed.")
			.addText((text) =>
				text.setPlaceholder("Deck name").onChange((value) => {
					importDeckName = value.trim();
				})
			)
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(async () => {
						const deckName = importDeckName;
						if (!deckName) {
							this.plugin.notify("Enter a deck name to import.", 4000, "error");
							return;
						}
						if (importing) return;
						importing = true;
						button.setDisabled(true).setButtonText("Importing…");
						try {
							this.plugin.debug("Import deck triggered from settings", { deckName });
							await this.plugin.syncService.importDeck(deckName);
						} catch (err) {
							this.plugin.debug("Import deck from settings failed", {
								deckName,
								error: err instanceof Error ? err.message : String(err),
							});
							this.plugin.notify(
								`Import failed: ${err instanceof Error ? err.message : String(err)}`,
								7000,
								"error",
							);
						} finally {
							importing = false;
							button.setDisabled(false).setButtonText("Import");
						}
					})
			);
	}
}
