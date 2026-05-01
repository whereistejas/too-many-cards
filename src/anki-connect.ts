export class AnkiConnectError extends Error {
	kind: "network" | "cors" | "api";

	constructor(kind: "network" | "cors" | "api", message: string) {
		super(message);
		this.kind = kind;
	}
}

export interface AnkiNoteInfo {
	noteId: number;
	mod: number;
	modelName: string;
	tags: string[];
	fields: Record<string, { value: string; order: number }>;
}

export class AnkiConnectClient {
	constructor(private readonly url: string) {}

	async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
		let response: Response;
		try {
			response = await fetch(this.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, version: 6, params }),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (/cors|origin/i.test(message)) {
				throw new AnkiConnectError("cors", message);
			}
			throw new AnkiConnectError("network", message);
		}

		const data = (await response.json()) as { error: string | null; result: T };
		if (data.error) throw new AnkiConnectError("api", data.error);
		return data.result;
	}

	version(): Promise<number> {
		return this.invoke<number>("version");
	}

	findNotes(query: string): Promise<number[]> {
		return this.invoke<number[]>("findNotes", { query });
	}

	notesInfo(notes: number[]): Promise<AnkiNoteInfo[]> {
		if (notes.length === 0) return Promise.resolve([]);
		return this.invoke<AnkiNoteInfo[]>("notesInfo", { notes });
	}
}
