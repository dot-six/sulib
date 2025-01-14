const { RenderWindow, VideoMode } = require('../sfml');
const { Mouse } = require('./api');

const Vector2D = require('./object/Vector2D');
const Tree = require('./node/Tree');
const WindowStyle = require('./object/WindowStyle');

class Window {
	constructor(width=500, height=500, style=WindowStyle.Default, bitsPerPixel=-1) {
		// Default values
		if (bitsPerPixel == -1) {
			bitsPerPixel = VideoMode.getDesktopMode().bitsPerPixel;
		}

		// General
		this._size = new Vector2D(width, height);
		this.position = new Vector2D();
		this.view = new Vector2D();

		// Privates
		this._title = 'New Window';
		this._lastDelta = Date.now();
		this._borderStyle = style;

		// Events
		this.eventState = {};
		this.focus = null;
		this._intervals = [];
		this.delta = 0;

		// Components
		this.tree = new Tree(this);
		this.videoMode = new VideoMode(this.size.x, this.size.y, bitsPerPixel);
		this.win = new RenderWindow(
			this.videoMode,
			this.title,
			style
		);
	}

	get size() {
		return this._size;
	}
	set size(val) {
		this._size = val;
	}

	get title() { return this._title; }
	set title(val) {
		this._title = val;
		this.win.setTitle(this.title);
	}

	get borderStyle() { return this._borderStyle; }
	set borderStyle(val) {
		this._borderStyle = val;
		this.win.create(
			new VideoMode(this.size.x, this.size.y),
			this._title,
			this._borderStyle
		)
	}

	// TODO: @lib/Window: set size(val) consider adding eventlistener to Vector2D

	_handle_mouse_moved(e) {
		let node = this.getNodeByPosition(new Vector2D(e.mouseMove.x, e.mouseMove.y));
		if (node) {
			if (this.eventState['MouseMoved'] !== node) {
				node.ev?.emit('hover');
				this.eventState['MouseMoved']?.ev?.emit('hoverend');
			}
		}
		
		this.eventState['MouseMoved'] = node;
	}

	getNodeByPosition(x, y) {
		let point = new Vector2D(x, y);
		let focus = null;

		this.tree.walk((node) => {
			let reg = node.getRegion();
			if (reg.contains(point)) {
				focus = node;
			}

			return true;
		});

		return focus;
	}

	click(x, y, button, buttonStr) {
		// TODO: @lib/Window: omit buttonStr, use button only
		let delta = Date.now() - this.eventState['MouseButtonPressed'].time;

		// Walk the tree
		let point = new Vector2D(x, y);
		let focus = null;
		// TODO: @lib/node/Tree: Add walkRegion(reg, callback) to effectively walk within specific region
		this.tree.walk((node) => {
			let reg = node.getRegion();
			if (reg.contains(point)) {
				// Try to get the most specific region ever
				focus = node;
			}

			return true;
		});

		// Fire the event
		// TODO: @lib/Window: Let node have .getEventListener method to customize their own eventListener
		focus?.ev?.emit('mouse-click', new Vector2D(x, y), button, buttonStr);

		if (this.focus !== focus) {
			focus?.ev?.emit('focus');
		}
		
		this.focus = focus;

		delete this.eventState['MouseButtonPressed'];
		return this.focus;
	}

	close() {
		this.win.close();
	}

	requestFocus() {
		this.win.requestFocus();
	}

	setFramerateLimit(fps) {
		this.win.setFramerateLimit(fps);
	}

	setPosition(pos) {
		this.win.setPosition(pos.asVectorI());
	}

	setScene(tree) {
		this.tree = tree;
		this.tree.parentWindow = this;
		this.tree.root.parentWindow = this;
	}

	setInterval(func, intervalMs) {
		return this._intervals.push({func, intervalMs, timer: intervalMs}) - 1;
	}

	clearInterval(id) {
		delete this._intervals[id];
	}

	mainLoop() {
		if (!this.win.isOpen()) return false;

		let e;
		while ((e = this.win.pollEvent())) {
			switch (e.type) {
			case 'Closed':
				this.win.close();
				return false;
			case 'MouseButtonPressed':
				let mbppos = Mouse.getPosition(this.win);
				this.eventState[e.type] = {
					time: Date.now(),
					initialPosition: mbppos,
					position: mbppos,
					focus: this.getNodeByPosition(mbppos.x, mbppos.y)
				};
				break;
			case 'MouseButtonReleased':
				if (this.eventState['MouseButtonPressed']) {
					let {x, y, button, buttonStr} = e.mouseButton;
					this.click(x, y, button, buttonStr);
				}
				break;
			case 'MouseMoved':
				this._handle_mouse_moved(e);
				break;
			case 'KeyPressed':
			case 'KeyReleased':
				if (!this.focus) break;

				if (e.type == "KeyPressed") {
					this.focus.ev.emit('key-down', e.key);
				} else if (e.type == "KeyReleased") {
					this.focus.ev.emit('key-up', e.key);
				}
				break;
			}
		}

		// Fire events
		// Mouse drag event
		if (this.eventState['MouseButtonPressed']) {
			// I still did not know the origin of this divide by 2 operation
			// but this makes the node movement as correct as our cursor
			// TODO: @lib/Window: This still enables dragging from outside of the node region
			let mousePos = Mouse.getPosition(this.win);
			let md_delta = mousePos.sub(
				// TODO: @lib/Window: position.div(2) is inaccurate, why do we need this?
				this.eventState['MouseButtonPressed'].position
			);

			this.eventState['MouseButtonPressed'].position = mousePos;

			if (md_delta.neq(0, 0)) {
				// If Mouse drag delta is not zero, fires the event.
				if (this.eventState['MouseButtonPressed'].focus != null) {
					let focus = this.eventState['MouseButtonPressed'].focus;
					if (focus && focus.ev && typeof focus.ev.emit == 'function') {
						focus.ev.emit('mouse-drag', md_delta);
						if (focus.ev.rawListeners('mouse-drag').length) {
							// If event listened, we reposition the node
							focus.position = focus.position.add(md_delta);
						}
					}
				}
			}
		}

		// Run each intervals
		// WARN: Will this make race condition by having two Date.now calls?
		this.delta = Date.now() - this._lastDelta;
		this._lastDelta = Date.now();

		for (const interval of this._intervals) {
			if (interval === undefined) continue;
			if (!(interval.func && interval.intervalMs)) continue;

			interval.timer -= this.delta;

			if (interval.timer <= 0) {
				// Calculate missing calls
				let missingCalls = Math.floor(this.delta / interval.intervalMs) + 1;

				// Call missing calls
				for (let ix = 0; ix < missingCalls; ix++) {
					interval.func();
				}

				// Reset timer
				interval.timer = interval.intervalMs;
			}
		}

		// Draw tree
		this.tree.draw(this);

		return true;
	}

	mainLoopWhile(cond=true) {
		let func = undefined;
		if (typeof cond === "function") {
			func = cond;
		} else {
			func = () => cond;
		}
		while (func() && this.mainLoop()) {}
	}

	addChild(node) {
		this.tree.root.addChild(node);
	}
}

module.exports = Window;
