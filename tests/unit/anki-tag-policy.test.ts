import assert from "node:assert/strict";
import test from "node:test";
import { normalizeObsidianTag, toAnkiTag, toObsidianTag } from "../../src/anki-tag-policy";

test("tag conversion: obsidian slash converts to anki double-colon", () => {
	assert.equal(toAnkiTag("Biology/Genetics"), "Biology::Genetics");
});

test("tag conversion: anki double-colon converts to obsidian slash", () => {
	assert.equal(toObsidianTag("Biology::Genetics"), "Biology/Genetics");
});

test("normalizeObsidianTag: strips spaces and replaces whitespace/anki nesting", () => {
	assert.equal(normalizeObsidianTag("  French Vocabulary  "), "French_Vocabulary");
	assert.equal(normalizeObsidianTag("Topic::Biology"), "Topic/Biology");
});
