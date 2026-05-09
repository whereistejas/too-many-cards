declare module "markdown-it-mathjax" {
	import type MarkdownIt from "markdown-it";
	export default function markdownItMathjax(options?: {
		beforeMath?: string;
		afterMath?: string;
		beforeInlineMath?: string;
		afterInlineMath?: string;
		beforeDisplayMath?: string;
		afterDisplayMath?: string;
	}): (md: MarkdownIt) => void;
}
