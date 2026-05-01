import type { ParsedCard } from "./types";

const H2_RE = /^##\s+(.+)\s*$/i;

export function parseCardSections(markdown: string): ParsedCard {
	const lines = markdown.split(/\r?\n/);
	let frontHeadingLine = -1;
	let backHeadingLine = -1;
	const h2Lines: { index: number; heading: string }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const m = line.match(H2_RE);
		if (!m) continue;
		const rawHeading = m[1];
		if (rawHeading === undefined) continue;
		const heading = rawHeading.trim().toLowerCase();
		h2Lines.push({ index: i, heading });
		if (heading === "front" && frontHeadingLine === -1) frontHeadingLine = i;
		if (heading === "back" && backHeadingLine === -1) backHeadingLine = i;
	}

	const missingSections: string[] = [];
	if (frontHeadingLine === -1) missingSections.push("Front");
	if (backHeadingLine === -1) missingSections.push("Back");

	if (missingSections.length > 0) {
		return { front: "", back: "", missingSections };
	}

	const nextH2After = (line: number): number => {
		const next = h2Lines.find((h2) => h2.index > line);
		return next?.index ?? lines.length;
	};

	const frontEnd = nextH2After(frontHeadingLine);
	const backEnd = nextH2After(backHeadingLine);

	const front = lines.slice(frontHeadingLine + 1, frontEnd).join("\n").trim();
	const back = lines.slice(backHeadingLine + 1, backEnd).join("\n").trim();

	return { front, back, missingSections: [] };
}
