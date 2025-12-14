import { ItemView, WorkspaceLeaf, MarkdownView } from 'obsidian';
import TodoTkPlugin from './main';

export const VIEW_TYPE_TODO_TK = 'todo-tk-view';

export interface TodoTkItem {
	type: 'TODO' | 'TK';
	text: string;
	line: number;
	position: number; // character position in the file
}

export class TodoTkView extends ItemView {
	plugin: TodoTkPlugin;
	items: TodoTkItem[] = [];
	currentFile: string | null = null;
	updateTimeout: NodeJS.Timeout | null = null;
	currentMarkdownView: MarkdownView | null = null;
	pollInterval: NodeJS.Timeout | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TodoTkPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_TODO_TK;
	}

	getDisplayText() {
		return 'TODO/TK';
	}

	getIcon() {
		return 'list-checks';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl('div', { cls: 'todo-tk-container' });
		
		// Wait a bit for the view to be fully initialized, then try multiple times if needed
		setTimeout(() => {
			this.update();
			// If still no file found, try again after a longer delay
			setTimeout(() => {
				if (!this.currentFile) {
					this.update();
				}
			}, 500);
		}, 100);
	}

	async onClose() {
		// Clean up
		if (this.updateTimeout) {
			clearTimeout(this.updateTimeout);
			this.updateTimeout = null;
		}
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		this.currentMarkdownView = null;
	}

	update() {
		const container = this.containerEl.children[1];
		const contentEl = container.querySelector('.todo-tk-container');
		if (!contentEl) return;

		contentEl.empty();

		// Use stored markdown view if available and still valid
		let markdownView: MarkdownView | null = this.currentMarkdownView;
		
		// Verify the stored view is still valid
		if (markdownView && (!markdownView.editor || !markdownView.file)) {
			markdownView = null;
			this.currentMarkdownView = null;
		}

		// If no stored view, try to find one
		if (!markdownView) {
			// Get all markdown leaves
			const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
			
			if (markdownLeaves.length > 0) {
				// First, try to get the active markdown view (might be null if sidebar is active)
				markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				
				// If no active markdown view, find the first valid one
				if (!markdownView) {
					for (const leaf of markdownLeaves) {
						const view = leaf.view as MarkdownView;
						if (view && view.editor && view.file) {
							markdownView = view;
							break;
						}
					}
				}
				
				// Verify the found view is valid
				if (markdownView && (!markdownView.editor || !markdownView.file)) {
					markdownView = null;
				}
			}
		}

		if (!markdownView || !markdownView.editor || !markdownView.file) {
			contentEl.createEl('p', { text: 'No active markdown file' });
			this.currentFile = null;
			this.currentMarkdownView = null;
			return;
		}

		// Store the current file path and view reference
		this.currentFile = markdownView.file?.path || null;
		this.currentMarkdownView = markdownView;
		const content = markdownView.editor.getValue();
		this.items = this.parseContent(content);

		// Set up editor change listener for this file (only if not already set up for this file)
		if (!this.pollInterval || markdownView.file?.path !== this.currentFile) {
			// Clear old interval if exists
			if (this.pollInterval) {
				clearInterval(this.pollInterval);
				this.pollInterval = null;
			}
			this.setupEditorChangeListener(markdownView);
		}

		// Create outline-style container
		if (this.items.length === 0) {
			contentEl.createEl('p', { text: 'No TODO or TK items found' });
			return;
		}
		const outlineEl = contentEl.createEl('nav', { cls: 'outline' });
		const outlineContent = outlineEl.createEl('div', { cls: 'outline-content' });

		this.items.forEach((item) => {
			const itemEl = outlineContent.createEl('div', { 
				cls: `tree-item-self is-clickable todo-tk-item todo-tk-${item.type.toLowerCase()}` 
			});
			
			const itemInner = itemEl.createEl('div', { cls: 'tree-item-inner' });
			
			const typeBadge = itemInner.createEl('span', { 
				cls: 'todo-tk-badge',
				text: item.type === 'TK' ? 'TK ' : 'TODO ' 
			});
			
			const textSpan = itemInner.createEl('span', { 
				cls: 'tree-item-inner-text',
				text: item.text 
			});

			itemEl.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.jumpToLine(item);
			};
		});
	}

	private setupEditorChangeListener(markdownView: MarkdownView) {
		// Store reference to current markdown view
		this.currentMarkdownView = markdownView;
		const trackedFile = markdownView.file?.path;

		// Clear any existing interval
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
		}

		// Use a simple polling approach to detect content changes
		// Check every 500ms if the content has changed
		this.pollInterval = setInterval(() => {
			// Check if view is still valid
			if (!this.currentMarkdownView || !this.currentMarkdownView.editor || !this.currentMarkdownView.file) {
				if (this.pollInterval) {
					clearInterval(this.pollInterval);
					this.pollInterval = null;
				}
				this.currentMarkdownView = null;
				return;
			}

			// Only check if this is still the file we're tracking
			if (this.currentMarkdownView.file.path === trackedFile && trackedFile === this.currentFile) {
				const currentContent = this.currentMarkdownView.editor.getValue();
				const currentItems = this.parseContent(currentContent);
				
				// Simple comparison - check if items changed
				const itemsChanged = 
					currentItems.length !== this.items.length ||
					JSON.stringify(currentItems.map(i => ({ text: i.text, line: i.line }))) !== 
					JSON.stringify(this.items.map(i => ({ text: i.text, line: i.line })));

				if (itemsChanged) {
					// Debounce the update
					if (this.updateTimeout) {
						clearTimeout(this.updateTimeout);
					}
					this.updateTimeout = setTimeout(() => {
						this.update();
					}, 200);
				}
			} else {
				// File changed, stop polling
				if (this.pollInterval) {
					clearInterval(this.pollInterval);
					this.pollInterval = null;
				}
				this.currentMarkdownView = null;
			}
		}, 500);
	}

	private parseContent(content: string): TodoTkItem[] {
		const items: TodoTkItem[] = [];
		const seenPositions = new Set<string>(); // Track seen positions to prevent duplicates
		const lines = content.split('\n');

		lines.forEach((line, lineIndex) => {
			// Find TODO items - use non-overlapping matches
			const todoRegex = /\bTODO\b/gi;
			const todoMatches: RegExpExecArray[] = [];
			let match;
			// Reset regex lastIndex to avoid issues with global regex
			todoRegex.lastIndex = 0;
			while ((match = todoRegex.exec(line)) !== null) {
				todoMatches.push(match);
			}

			todoMatches.forEach((match) => {
				const startPos = match.index;
				if (startPos === undefined || startPos === null) {
					return;
				}
				const positionKey = `${lineIndex}-${startPos}-TODO`;
				
				// Skip if we've already seen this position
				if (seenPositions.has(positionKey)) {
					return;
				}
				seenPositions.add(positionKey);

				const afterTodo = line.substring(startPos + 4); // "TODO" is 4 chars
				const words = afterTodo.trim().split(/\s+/).slice(0, 10);
				const text = words.join(' ');
				
				// Calculate absolute position
				let position = 0;
				for (let i = 0; i < lineIndex; i++) {
					position += lines[i].length + 1; // +1 for newline
				}
				position += startPos;

				items.push({
					type: 'TODO',
					text: text,
					line: lineIndex,
					position: position,
				});
			});

			// Find TK items - use non-overlapping matches
			const tkRegex = /\bTK\b/gi;
			const tkMatches: RegExpExecArray[] = [];
			// Reset regex lastIndex to avoid issues with global regex
			tkRegex.lastIndex = 0;
			while ((match = tkRegex.exec(line)) !== null) {
				tkMatches.push(match);
			}

			tkMatches.forEach((match) => {
				const startPos = match.index;
				const positionKey = `${lineIndex}-${startPos}-TK`;
				
				// Skip if we've already seen this position
				if (seenPositions.has(positionKey)) {
					return;
				}
				seenPositions.add(positionKey);

				const beforeTk = line.substring(0, startPos).trim();
				const words = beforeTk.split(/\s+/);
				const threeWords = words.slice(-3).join(' ');
				const text = threeWords;
				
				// Calculate absolute position
				let position = 0;
				for (let i = 0; i < lineIndex; i++) {
					position += lines[i].length + 1; // +1 for newline
				}
				position += startPos;

				items.push({
					type: 'TK',
					text: text,
					line: lineIndex,
					position: position,
				});
			});
		});

		return items;
	}

	private jumpToLine(item: TodoTkItem) {
		// Use the stored file path to find the correct view
		if (!this.currentFile) {
			return;
		}

		// Find the view for the file we're tracking
		const file = this.app.vault.getAbstractFileByPath(this.currentFile);
		if (!file) {
			return;
		}

		// Get all markdown views and find the one for our file
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		const targetView = leaves.find(leaf => {
			const view = leaf.view as MarkdownView;
			return view.file?.path === this.currentFile;
		})?.view as MarkdownView;

		if (!targetView || !targetView.editor) {
			return;
		}

		// Switch to the leaf if needed, then jump to the line
		const leaf = this.app.workspace.getLeavesOfType('markdown').find(
			l => (l.view as MarkdownView).file?.path === this.currentFile
		);
		
		if (leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		}

		const editor = targetView.editor;
		editor.setCursor(item.line, 0);
		editor.scrollIntoView({ from: { line: item.line, ch: 0 }, to: { line: item.line, ch: 0 } }, true);
		editor.focus();
	}
}

