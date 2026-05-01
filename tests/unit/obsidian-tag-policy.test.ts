import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedTags, tagFromLinker } from "../../src/obsidian-tag-policy";

test("tagFromLinker prefers title over basename", () => {
	assert.equal(tagFromLinker({ basename: "french-vocab", title: "French Vocabulary" }), "French_Vocabulary");
});

test("tagFromLinker falls back to basename when title missing", () => {
	assert.equal(tagFromLinker({ basename: "french-vocab", title: null }), "french-vocab");
});

test("buildManagedTags includes sync tag first and deduplicates", () => {
	const tags = buildManagedTags("obsidian", ["French Vocabulary", "Topic/Biology"], ["Topic/Biology", "obsidian"]);
	assert.deepEqual(tags, ["obsidian", "Topic/Biology", "French_Vocabulary"]);
});
