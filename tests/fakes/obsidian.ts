// Runtime stub for the `obsidian` package. The real package on npm is types-only;
// this stub provides minimal class/function exports so we can load `src/` modules in
// node tests. Behaviour-bearing pieces (Vault, MetadataCache) are implemented in
// `tests/integration/fake-vault.ts`.

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
	vault!: Vault;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Vault {
	getAbstractFileByPath(_path: string): TAbstractFile | null {
		return null;
	}
	async create(_path: string, _data: string): Promise<TFile> {
		throw new Error("Vault.create not implemented in stub");
	}
	async createBinary(_path: string, _data: ArrayBuffer): Promise<TFile> {
		throw new Error("Vault.createBinary not implemented in stub");
	}
	async createFolder(_path: string): Promise<TFolder> {
		throw new Error("Vault.createFolder not implemented in stub");
	}
	async modify(_file: TFile, _data: string): Promise<void> {
		throw new Error("Vault.modify not implemented in stub");
	}
	async cachedRead(_file: TFile): Promise<string> {
		throw new Error("Vault.cachedRead not implemented in stub");
	}
	async read(_file: TFile): Promise<string> {
		throw new Error("Vault.read not implemented in stub");
	}
	async readBinary(_file: TFile): Promise<ArrayBuffer> {
		throw new Error("Vault.readBinary not implemented in stub");
	}
	async trash(_file: TAbstractFile, _system: boolean): Promise<void> {
		throw new Error("Vault.trash not implemented in stub");
	}
	on(_name: string, _cb: (...args: unknown[]) => unknown): unknown {
		return null;
	}
	off(_name: string, _cb: (...args: unknown[]) => unknown): void {}
}

export class MetadataCache {
	getFileCache(_file: TFile): { frontmatter?: Record<string, unknown> } | null {
		return null;
	}
	getFirstLinkpathDest(_linkpath: string, _sourcePath: string): TFile | null {
		return null;
	}
}

export class Workspace {
	getActiveFile(): TFile | null {
		return null;
	}
	getLeaf(_newLeaf: boolean): { openFile(file: TFile): Promise<void> } {
		return { openFile: async () => {} };
	}
	on(_name: string, _cb: (...args: unknown[]) => unknown): unknown {
		return null;
	}
}

export class FileManager {
	async processFrontMatter(
		_file: TFile,
		_fn: (fm: Record<string, unknown>) => void,
	): Promise<void> {
		throw new Error("FileManager.processFrontMatter not implemented in stub");
	}
}

export class App {
	vault!: Vault;
	metadataCache!: MetadataCache;
	workspace!: Workspace;
	fileManager!: FileManager;
}

export class Notice {
	message: string;
	timeout: number | undefined;
	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout;
	}
	hide(): void {}
	setMessage(msg: string): this {
		this.message = msg;
		return this;
	}
}

export class MarkdownView {
	file: TFile | null = null;
}

export class Plugin {
	app!: App;
	manifest: Record<string, unknown> = {};
	addCommand(_cmd: unknown): unknown {
		return null;
	}
	addSettingTab(_tab: unknown): void {}
	registerEvent(_evt: unknown): void {}
	registerMarkdownPostProcessor(_fn: unknown): void {}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: { empty(): void; createEl(...args: unknown[]): unknown } = {
		empty: () => {},
		createEl: () => ({}),
	};
	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(_cb: (text: unknown) => void): this {
		return this;
	}
	addToggle(_cb: (toggle: unknown) => void): this {
		return this;
	}
	addButton(_cb: (button: unknown) => void): this {
		return this;
	}
}

export class MarkdownRenderer {
	static async renderMarkdown(
		_markdown: string,
		_el: unknown,
		_sourcePath: string,
		_component: unknown,
	): Promise<void> {}
	static async render(
		_app: App,
		_markdown: string,
		_el: unknown,
		_sourcePath: string,
		_component: unknown,
	): Promise<void> {}
}

export function setIcon(_el: unknown, _icon: string): void {}

export type MarkdownPostProcessorContext = unknown;

export function normalizePath(path: string): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
