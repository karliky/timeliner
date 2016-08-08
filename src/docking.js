'use strict';
var Settings  = require('./settings');
var utils     = require('./utils');
var DockingWindow = function(resize, pane, ghostpane, params, paneTitle, resizeFull) {

	// Minimum resizable area
	var minWidth = 100;
	var minHeight = 80;

	// Thresholds
	var FULLSCREEN_MARGINS = 2;
	var SNAP_MARGINS = 8;
	var MARGINS = 2;

	// End of what's configurable.

	var clicked = null;
	var onRightEdge;
	var onBottomEdge;
	var onLeftEdge;
	var onTopEdge;

	var preSnapped;

	var b;
	var x;
	var y;

	var redraw = false;

	// var pane = document.getElementById('pane');
	// var ghostpane = document.getElementById('ghostpane');

	var mouseOnTitle = false;
	var snapType;

	paneTitle.addEventListener('mouseover', function() {
		mouseOnTitle = true;
	});

	paneTitle.addEventListener('mouseout', function() {
		mouseOnTitle = false;
	});

	resizeFull.onClick(function() {
		// TOOD toggle back to restored size
		if (!preSnapped) {
			preSnapped = {
				width: b.width,
				height: b.height
			};
		}

		snapType = 'full-screen';
		resizeEdges();
	});

	// paneStatus.addEventListener('mouseover', function() {
	// 	mouseOnTitle = true;
	// });

	// paneStatus.addEventListener('mouseout', function() {
	// 	mouseOnTitle = false;
	// });

	window.addEventListener('resize', function() {
		if (snapType) {
			resizeEdges();
		} else {
			params.needsResize = true;
		}
	});

	function hintHide() {
		utils.setBounds(ghostpane, b.left, b.top, b.width, b.height);
		ghostpane.style.opacity = 0;
	}

	utils.setBounds(pane, Settings.left, Settings.top, Settings.width, Settings.height);
	utils.setBounds(ghostpane, Settings.left, Settings.top, Settings.width, Settings.height);
	resize(Settings.width, Settings.height);
	// Mouse events
	pane.addEventListener('mousedown', onMouseDown);
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onUp);

	// Touch events
	pane.addEventListener('touchstart', onTouchDown);
	document.addEventListener('touchmove', onTouchMove);
	document.addEventListener('touchend', onTouchEnd);


	function onTouchDown(e) {
		onDown(e.touches[0]);
		e.preventDefault();
	}

	function onTouchMove(e) {
		onMove(e.touches[0]);
	}

	function onTouchEnd(e) {
		if (e.touches.length === 0) {
			onUp(e.changedTouches[0]);
		}
	}

	function onMouseDown(e) {
		onDown(e);
	}

	function onDown(e) {
		calc(e);

		var isResizing = onRightEdge || onBottomEdge || onTopEdge || onLeftEdge;
		var isMoving = !isResizing && canMove();

		clicked = {
			x: x,
			y: y,
			cx: e.clientX,
			cy: e.clientY,
			w: b.width,
			h: b.height,
			isResizing: isResizing,
			isMoving: isMoving,
			onTopEdge: onTopEdge,
			onLeftEdge: onLeftEdge,
			onRightEdge: onRightEdge,
			onBottomEdge: onBottomEdge
		};

		if (isResizing || isMoving) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	function canMove() {
		return mouseOnTitle;
	}

	function calc(e) {
		b = pane.getBoundingClientRect();
		x = e.clientX - b.left;
		y = e.clientY - b.top;

		onTopEdge = y < MARGINS;
		onLeftEdge = x < MARGINS;
		onRightEdge = x >= b.width - MARGINS;
		onBottomEdge = y >= b.height - MARGINS;
	}

	var e; // current mousemove event

	function onMove(ee) {
		e = ee;
		calc(e);

		redraw = true;
	}

	function animate() {

		requestAnimationFrame(animate);

		if (!redraw) return;

		redraw = false;

		if (clicked && clicked.isResizing) {

			if (clicked.onRightEdge) pane.style.width = Math.max(x, minWidth) + 'px';
			if (clicked.onBottomEdge) pane.style.height = Math.max(y, minHeight) + 'px';

			if (clicked.onLeftEdge) {
				var currentWidth = Math.max(clicked.cx - (e.clientX  + clicked.w), minWidth);
				if (currentWidth > minWidth) {
					pane.style.width = currentWidth + 'px';
					pane.style.left = e.clientX + 'px';
				}
			}

			if (clicked.onTopEdge) {
				var currentHeight = Math.max(clicked.cy - (e.clientY  + clicked.h), minHeight);
				if (currentHeight > minHeight) {
					pane.style.height = currentHeight + 'px';
					pane.style.top = e.clientY + 'px';
				}
			}

			hintHide();

			resize(b.width, b.height);

			return;
		}

		if (clicked && clicked.isMoving) {

			switch (checks()) {
			case 'full-screen':
				utils.setBounds(ghostpane, 0, 0, window.innerWidth, window.innerHeight);
				ghostpane.style.opacity = 0.2;
				params.needsResize = true;
				break;
			case 'snap-top-edge':
				utils.setBounds(ghostpane, 0, 0, window.innerWidth, window.innerHeight / 2);
				ghostpane.style.opacity = 0.2;
				params.needsResize = true;
				break;
			case 'snap-left-edge':
				utils.setBounds(ghostpane, 0, 0, window.innerWidth / 2, window.innerHeight);
				ghostpane.style.opacity = 0.2;
				params.needsResize = true;
				break;
			case 'snap-right-edge':
				utils.setBounds(ghostpane, window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
				ghostpane.style.opacity = 0.2;
				params.needsResize = true;
				break;
			case 'snap-bottom-edge':
				utils.setBounds(ghostpane, 0, window.innerHeight / 2, window.innerWidth, window.innerHeight / 2);
				ghostpane.style.opacity = 0.2;
				params.needsResize = true;
				break;
			default:
				hintHide();
			}

			if (preSnapped) {
				utils.setBounds(pane,
					e.clientX - (preSnapped.width / 2),
					e.clientY - Math.min(clicked.y, preSnapped.height),
					preSnapped.width,
					preSnapped.height
				);
				return;
			}

			// moving
			pane.style.top = (e.clientY - clicked.y) + 'px';
			pane.style.left = (e.clientX - clicked.x) + 'px';

			return;
		}

		// This code executes when mouse moves without clicking

		// style cursor
		if ((onRightEdge && onBottomEdge) || (onLeftEdge && onTopEdge)) {
			pane.style.cursor = 'nwse-resize';
		} else if ((onRightEdge && onTopEdge) || (onBottomEdge && onLeftEdge)) {
			pane.style.cursor = 'nesw-resize';
		} else if (onRightEdge || onLeftEdge) {
			pane.style.cursor = 'ew-resize';
		} else if (onBottomEdge || onTopEdge) {
			pane.style.cursor = 'ns-resize';
		} else if (canMove()) {
			pane.style.cursor = 'move';
		} else {
			pane.style.cursor = 'default';
		}
	}

	function checks() {

		if (e.clientY < FULLSCREEN_MARGINS) return 'full-screen';

		if (e.clientY < SNAP_MARGINS) return 'snap-top-edge';

		if (e.clientX < SNAP_MARGINS) return 'snap-left-edge';

		if (window.innerWidth - e.clientX < SNAP_MARGINS) return 'snap-right-edge';

		if (window.innerHeight - e.clientY < SNAP_MARGINS) return 'snap-bottom-edge';

	}

	animate();

	function resizeEdges() {
		switch (snapType) {
		case 'full-screen':
			// hintFull();
			utils.setBounds(pane, 0, 0, window.innerWidth, window.innerHeight);
			params.needsResize = true;
			break;
		case 'snap-top-edge':
			// hintTop();
			utils.setBounds(pane, 0, 0, window.innerWidth, window.innerHeight / 2);
			params.needsResize = true;
			break;
		case 'snap-left-edge':
			// hintLeft();
			utils.setBounds(pane, 0, 0, window.innerWidth / 2, window.innerHeight);
			params.needsResize = true;
			break;
		case 'snap-right-edge':
			utils.setBounds(pane, window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
			params.needsResize = true;
			break;
		case 'snap-bottom-edge':
			utils.setBounds(pane, 0, window.innerHeight / 2, window.innerWidth, window.innerHeight / 2);
			params.needsResize = true;
			break;
		default:
			// nothing to do here
		}
	}

	function onUp(e) {
		calc(e);

		if (clicked && clicked.isMoving) {
			// Snap
			snapType = checks();
			if (snapType) {
				preSnapped = {
					width: b.width,
					height: b.height
				};
				resizeEdges();
			} else {
				preSnapped = null;
			}

			hintHide();

		}

		clicked = null;

	}
};

module.exports = DockingWindow;
