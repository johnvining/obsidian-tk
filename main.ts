import { Plugin, MarkdownView } from 'obsidian';
import { TodoTkView, VIEW_TYPE_TODO_TK } from './view';
import './styles.css';

export default class TodoTkPlugin extends Plugin {
	async onload() {
		// Register the view
		this.registerView(
			VIEW_TYPE_TODO_TK,
			(leaf) => new TodoTkView(leaf, this)
		);

		// Add the view to the right sidebar
		this.app.workspace.onLayoutReady(() => {
			if (this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_TK).length === 0) {
				this.app.workspace.getRightLeaf(false).setViewState({
					type: VIEW_TYPE_TODO_TK,
					active: true,
				});
			}
		});

		// Update view when active file changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				// Small delay to ensure the view is ready
				setTimeout(() => {
					this.updateView();
				}, 50);
			})
		);

		// Update view when file is modified
		this.registerEvent(
			this.app.vault.on('modify', () => {
				this.updateView();
			})
		);

		// Update view when a file is opened
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				setTimeout(() => {
					this.updateView();
				}, 50);
			})
		);

		// Also update when layout is ready (in case sidebar opens before any file)
		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => {
				this.updateView();
			}, 200);
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TODO_TK);
	}

	private updateView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_TK);
		leaves.forEach((leaf) => {
			const view = leaf.view as TodoTkView;
			if (view) {
				view.update();
			}
		});
	}
}

