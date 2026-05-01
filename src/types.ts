export interface PluginSettings {
	cardsFolder: string;
	deckName: string;
	ankiConnectUrl: string;
	mediaFolder: string;
	saveDebounceMs: number;
	debugLogging: boolean;
	syncTag: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	cardsFolder: "Cards",
	deckName: "Default",
	ankiConnectUrl: "http://localhost:8765",
	mediaFolder: "Cards/_media",
	saveDebounceMs: 1500,
	debugLogging: false,
	syncTag: "obsidian",
};

export interface PluginState {
	inFlightSync: boolean;
	lastSuccessfulSyncTs: number | null;
}

export interface PersistedData {
	settings?: Partial<PluginSettings>;
	state?: Partial<PluginState>;
}

export interface CardFrontmatter {
	last_modified?: number | string;
	anki_mod?: number | string;
	anki_status?: string[];
	tags?: string[];
	aliases?: string[];
}

export interface ParsedCard {
	front: string;
	back: string;
	missingSections: string[];
}

export interface CardFileRecord {
	path: string;
	basename: string;
	ankiId: number | null;
	ankiMod: number | null;
	status: string[];
	storedTags: string[];
	front: string;
	back: string;
}

export interface DuplicateGroup {
	normalizedFront: string;
	items: CardFileRecord[];
}
