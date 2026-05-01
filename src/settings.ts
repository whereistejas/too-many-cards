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
			.setName("Save debounce (ms)")
			.setDesc("Delay before syncing after card-file saves.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.saveDebounceMs)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed) || parsed < 0) return;
					this.plugin.settings.saveDebounceMs = parsed;
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
	}
}
