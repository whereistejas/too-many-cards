import {
	App,
	FileManager,
	MetadataCache,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	Workspace,
	normalizePath,
} from "obsidian";

// Minimal in-memory Vault/App/MetadataCache for integration tests of the sync flow.
// Only covers the surface that pull/push paths actually exercise. Frontmatter is
// re-parsed from file content on every getFileCache call (cheap; the tests are
// small).

interface FileEntry {
	type: "file";
	content: string;
	binaryContent: ArrayBuffer | null;
	file: TFile;
}

interface FolderEntry {
	type: "folder";
	folder: TFolder;
}

type Entry = FileEntry | FolderEntry;

export class FakeVault extends Vault {
	private entries = new Map<string, Entry>();
	private rootFolder: TFolder;

	constructor() {
		super();
		this.rootFolder = makeFolder("", "", null, this);
		this.entries.set("", { type: "folder", folder: this.rootFolder });
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		const norm = normalizeInputPath(path);
		const entry = this.entries.get(norm);
		if (!entry) return null;
		return entry.type === "file" ? entry.file : entry.folder;
	}

	async create(path: string, data: string): Promise<TFile> {
		const norm = normalizeInputPath(path);
		if (this.entries.has(norm)) {
			throw new Error(`File already exists: ${norm}`);
		}
		const parent = this.ensureParentFolder(norm);
		const file = makeFile(norm, this);
		file.parent = parent;
		parent.children.push(file);
		this.entries.set(norm, {
			type: "file",
			content: data,
			binaryContent: null,
			file,
		});
		file.stat = { ctime: Date.now(), mtime: Date.now(), size: data.length };
		return file;
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		const norm = normalizeInputPath(path);
		if (this.entries.has(norm)) throw new Error(`File already exists: ${norm}`);
		const parent = this.ensureParentFolder(norm);
		const file = makeFile(norm, this);
		file.parent = parent;
		parent.children.push(file);
		this.entries.set(norm, {
			type: "file",
			content: "",
			binaryContent: data,
			file,
		});
		file.stat = { ctime: Date.now(), mtime: Date.now(), size: data.byteLength };
		return file;
	}

	async createFolder(path: string): Promise<TFolder> {
		const norm = normalizeInputPath(path);
		const existing = this.entries.get(norm);
		if (existing) {
			if (existing.type === "folder") return existing.folder;
			throw new Error(`Path is a file, cannot create folder: ${norm}`);
		}
		const parent = this.ensureParentFolder(norm);
		const folder = makeFolder(norm, basename(norm), parent, this);
		parent.children.push(folder);
		this.entries.set(norm, { type: "folder", folder });
		return folder;
	}

	async modify(file: TFile, data: string): Promise<void> {
		const entry = this.entries.get(file.path);
		if (!entry || entry.type !== "file") {
			throw new Error(`No file at path: ${file.path}`);
		}
		entry.content = data;
		file.stat = { ...file.stat, mtime: Date.now(), size: data.length };
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	async read(file: TFile): Promise<string> {
		const entry = this.entries.get(file.path);
		if (!entry || entry.type !== "file") {
			throw new Error(`No file at path: ${file.path}`);
		}
		return entry.content;
	}

	async readBinary(file: TFile): Promise<ArrayBuffer> {
		const entry = this.entries.get(file.path);
		if (!entry || entry.type !== "file" || !entry.binaryContent) {
			throw new Error(`No binary file at path: ${file.path}`);
		}
		return entry.binaryContent;
	}

	async trash(file: TAbstractFile, _system: boolean): Promise<void> {
		const entry = this.entries.get(file.path);
		if (!entry) return;
		if (entry.type === "file" && entry.file.parent) {
			const parent = entry.file.parent;
			parent.children = parent.children.filter((c) => c.path !== file.path);
		}
		if (entry.type === "folder" && entry.folder.parent) {
			const parent = entry.folder.parent;
			parent.children = parent.children.filter((c) => c.path !== file.path);
		}
		this.entries.delete(file.path);
	}

	getFileContent(path: string): string | null {
		const entry = this.entries.get(normalizeInputPath(path));
		if (!entry || entry.type !== "file") return null;
		return entry.content;
	}

	private ensureParentFolder(filePath: string): TFolder {
		const parentPath = parentDir(filePath);
		if (parentPath === "") return this.rootFolder;
		const existing = this.entries.get(parentPath);
		if (existing && existing.type === "folder") return existing.folder;
		// Recursively create parents
		const grandParent = this.ensureParentFolder(parentPath);
		const folder = makeFolder(parentPath, basename(parentPath), grandParent, this);
		grandParent.children.push(folder);
		this.entries.set(parentPath, { type: "folder", folder });
		return folder;
	}
}

export class FakeMetadataCache extends MetadataCache {
	constructor(private readonly vault: FakeVault) {
		super();
	}

	getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
		const content = this.vault.getFileContent(file.path);
		if (content === null) return null;
		const frontmatter = parseFrontmatterBlock(content);
		return { frontmatter };
	}

	getFirstLinkpathDest(_linkpath: string, _sourcePath: string): TFile | null {
		return null;
	}
}

export function makeFakeApp(): { app: App; vault: FakeVault; metadataCache: FakeMetadataCache } {
	const vault = new FakeVault();
	const metadataCache = new FakeMetadataCache(vault);
	const app = new App();
	app.vault = vault;
	app.metadataCache = metadataCache;
	app.workspace = new Workspace();
	app.fileManager = new FileManager();
	return { app, vault, metadataCache };
}

function makeFile(path: string, vault: Vault): TFile {
	const file = new TFile();
	file.path = path;
	file.name = basename(path);
	const dot = file.name.lastIndexOf(".");
	file.basename = dot >= 0 ? file.name.slice(0, dot) : file.name;
	file.extension = dot >= 0 ? file.name.slice(dot + 1) : "";
	file.vault = vault;
	return file;
}

function makeFolder(path: string, name: string, parent: TFolder | null, vault: Vault): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = name;
	folder.parent = parent;
	folder.vault = vault;
	return folder;
}

function normalizeInputPath(path: string): string {
	const normalized = normalizePath(path);
	if (normalized === "/" || normalized === "") return "";
	return normalized;
}

function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash <= 0 ? "" : path.slice(0, slash);
}

function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? path : path.slice(slash + 1);
}

// Tiny YAML frontmatter parser. Handles the small subset our plugin uses:
//   key: value
//   key: "quoted value"
//   key: 12345
//   key:
//     - "list item"
//     - other item
function parseFrontmatterBlock(content: string): Record<string, unknown> | undefined {
	if (!content.startsWith("---")) return undefined;
	const lines = content.split("\n");
	if (lines[0]?.trim() !== "---") return undefined;
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			end = i;
			break;
		}
	}
	if (end === -1) return undefined;

	const out: Record<string, unknown> = {};
	let i = 1;
	while (i < end) {
		const raw = lines[i] ?? "";
		i += 1;
		if (!raw.trim()) continue;
		const m = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1] as string;
		const inlineValue = (m[2] ?? "").trim();
		if (inlineValue) {
			out[key] = parseScalar(inlineValue);
			continue;
		}
		// Block list: collect indented `  - ...` lines
		const list: unknown[] = [];
		while (i < end) {
			const next = lines[i] ?? "";
			const ml = next.match(/^\s+-\s*(.*)$/);
			if (!ml) break;
			i += 1;
			list.push(parseScalar((ml[1] ?? "").trim()));
		}
		out[key] = list;
	}
	return out;
}

function parseScalar(raw: string): unknown {
	if (raw === "") return "";
	const quoted = raw.match(/^"(.*)"$/);
	if (quoted) return (quoted[1] ?? "").replace(/\\"/g, '"');
	const single = raw.match(/^'(.*)'$/);
	if (single) return single[1] ?? "";
	if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
	if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null") return null;
	return raw;
}
