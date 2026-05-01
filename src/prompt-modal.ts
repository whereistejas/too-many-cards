import { App, Modal, Setting } from "obsidian";

export class PromptModal extends Modal {
	private value = "";
	private readonly onSubmit: (value: string) => void;
	private readonly title: string;
	private readonly placeholder: string;

	constructor(app: App, title: string, placeholder: string, onSubmit: (value: string) => void) {
		super(app);
		this.title = title;
		this.placeholder = placeholder;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.placeholder).onChange((value) => (this.value = value));
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => {
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setButtonText("OK")
					.onClick(() => {
						const value = this.value.trim();
						if (value) this.onSubmit(value);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
