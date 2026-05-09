import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import mathjax from "markdown-it-mathjax";
import { fromAnkiMath } from "../../src/conversion";

const md = new MarkdownIt().use(mathjax());

test("md+mathjax: inline $...$ renders as \\(...\\) in HTML", () => {
	assert.match(md.render("a $x+1$ b"), /\\\(x\+1\\\)/);
});

test("md+mathjax: block $$...$$ renders as \\[...\\] in HTML", () => {
	assert.match(md.render("a $$x+1$$ b"), /\\\[x\+1\\\]/);
});

test("md+mathjax: math survives backslash-escape (was the bug)", () => {
	const html = md.render("Energy: $E = mc^2$ end");
	assert.match(html, /\\\(E = mc\^2\\\)/);
	assert.doesNotMatch(html, /Energy: \(E = mc\^2\) end/);
});

test("md+mathjax: handles inline and block in the same input", () => {
	const html = md.render("inline $a$ and block $$b$$ together");
	assert.match(html, /\\\(a\\\)/);
	assert.match(html, /\\\[b\\\]/);
});

test("md+mathjax: leaves text without math untouched", () => {
	assert.match(md.render("no math here"), /<p>no math here<\/p>/);
});

test("fromAnkiMath: \\(...\\) becomes $...$", () => {
	assert.equal(fromAnkiMath("a \\(x+1\\) b"), "a $x+1$ b");
});

test("fromAnkiMath: \\[...\\] becomes $$...$$", () => {
	assert.equal(fromAnkiMath("a \\[x+1\\] b"), "a $$x+1$$ b");
});

test("fromAnkiMath: block math survives across newlines", () => {
	assert.equal(
		fromAnkiMath("before\n\\[\nx = y\n\\]\nafter"),
		"before\n$$\nx = y\n$$\nafter",
	);
});

test("fromAnkiMath: handles inline and block in the same input", () => {
	assert.equal(
		fromAnkiMath("inline \\(a\\) and block \\[b\\] together"),
		"inline $a$ and block $$b$$ together",
	);
});
