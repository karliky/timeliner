/*
 * @author Joshua Koo http://joshuakoo.com
 */

var undo = require('./util_undo');
var Dispatcher = require('./util_dispatcher');
var DockingWindow = require('./docking');
var Theme = require('./theme');
var UndoManager = undo.UndoManager;
var UndoState = undo.UndoState;
var Settings = require('./settings');
var utils = require('./utils');
var LayerCabinet = require('./view_layer_cabinet');
var TimelinePanel = require('./view_panel');
var packageJson = require('../package.json');
var IconButton = require('./ui_icon_button');
var style = utils.style;
var saveToFile = utils.saveToFile;
var openAs = utils.openAs;
var STORAGE_PREFIX = utils.STORAGE_PREFIX;
var ScrollBar = require('./ui_scrollbar');
var DataStore = require('./util_datastore');

var Z_INDEX = 999;

/**
 * Creates a new layer model
 * @param {String} name The layer name
 * TODO:
 * this.max
 * this.min
 * this.step
 */
function LayerProp(name) {
	this.name = name;
	this.values = [];

	this._value = 0;

	this._color = '#' + (Math.random() * 0xffffff | 0).toString(16);
}

function Timeliner(target, customSettings) {

	Object.assign(Settings, customSettings);

	// Dispatcher for coordination
	var dispatcher = new Dispatcher();

	// Data
	var data = new DataStore();
	var layerStore = data.get('layers');
	var layers = layerStore.value;

	window._data = data; // expose it for debugging

	// Undo manager
	var undoManager = new UndoManager(dispatcher);

	// Views
	var timeline = new TimelinePanel(data, dispatcher);
	var layerPanel = new LayerCabinet(data, dispatcher);

	setTimeout(function() {
		// hack!
		undoManager.save(new UndoState(data, 'Loaded'), true);
	});

	dispatcher.on('keyframe', function(layer, value) {

		var t = data.get('ui:currentTime').value;
		var v = utils.findTimeinLayer(layer, t);

		// console.log(v, '...keyframe index', index, utils.format_friendly_seconds(t), typeof(v));
		// console.log('layer', layer, value);

		if (typeof (v) === 'number') {
			layer.values.splice(v, 0, {
				time: t,
				value: value,
				_color: '#' + (Math.random() * 0xffffff | 0).toString(16)
			});

			undoManager.save(new UndoState(data, 'Add Keyframe'));
		} else {
			layer.values.splice(v.index, 1);

			undoManager.save(new UndoState(data, 'Remove Keyframe'));
		}

		repaintAll();

	});

	dispatcher.on('keyframe.move', function() {
		undoManager.save(new UndoState(data, 'Move Keyframe'));
	});

	// dispatcher.fire('value.change', layer, me.value);
	dispatcher.on('value.change', function(layer, value, dontSave) {
		if (layer._mute) return;

		var t = data.get('ui:currentTime').value;
		var v = utils.findTimeinLayer(layer, t);

		// console.log(v, 'value.change', layer, value, utils.format_friendly_seconds(t), typeof(v));
		if (typeof (v) === 'number') {
			layer.values.splice(v, 0, {
				time: t,
				value: value,
				_color: '#' + (Math.random() * 0xffffff | 0).toString(16)
			});
			if (!dontSave) undoManager.save(new UndoState(data, 'Add value'));
		} else {
			v.object.value = value;
			if (!dontSave) undoManager.save(new UndoState(data, 'Update value'));
		}

		repaintAll();
	});

	dispatcher.on('action:solo', function(layer, solo) {
		// When a track is solo-ed, playback only changes values
		// of that layer.
		layer._solo = solo;
	});

	dispatcher.on('action:mute', function(layer, mute) {
		layer._mute = mute;

		// When a track is mute, playback does not play
		// frames of those muted layers.

		// also feels like hidden feature in photoshop

		// when values are updated, eg. from slider,
		// no tweens will be created.
		// we can decide also to "lock in" layers
		// no changes to tween will be made etc.
	});

	dispatcher.on('ease', function(layer, easeType) {
		var t = data.get('ui:currentTime').value;
		var v = utils.timeAtLayer(layer, t);
		// console.log('Ease Change > ', layer, value, v);
		if (v && v.entry) {
			v.entry.tween  = easeType;
		}

		undoManager.save(new UndoState(data, 'Add Ease'));

		repaintAll();
	});

	var startPlay = null;
	var playedFrom = 0; // requires some more tweaking

	dispatcher.on('controls.toggle_play', function() {
		if (startPlay) {
			pausePlaying();
		} else {
			startPlaying();
		}
	});

	dispatcher.on('controls.restartPlay', function() {
		if (!startPlay) {
			startPlaying();
		}

		setCurrentTime(playedFrom);
	});

	dispatcher.on('controls.play', startPlaying);
	dispatcher.on('controls.pause', pausePlaying);

	function startPlaying() {
		// playedFrom = timeline.current_frame;
		startPlay = performance.now() - (data.get('ui:currentTime').value * 1000);
		layerPanel.setControlStatus(true);
		// dispatcher.fire('controls.status', true);
	}

	function pausePlaying() {
		startPlay = null;
		layerPanel.setControlStatus(false);
		// dispatcher.fire('controls.status', false);
	}

	dispatcher.on('controls.stop', function() {
		if (startPlay !== null) pausePlaying();
		setCurrentTime(0);
	});

	var currentTimeStore = data.get('ui:currentTime');
	dispatcher.on('time.update', setCurrentTime);

	dispatcher.on('update.scrollTime', function(v) {
		v = Math.max(0, v);
		data.get('ui:scrollTime').value = v;
		repaintAll();
	});


	function setCurrentTime(value) {
		value = Math.max(0, value);
		currentTimeStore.value = value;

		if (startPlay) startPlay = performance.now() - (value * 1000);
		repaintAll();
		// layerPanel.repaint(s);
	}

	dispatcher.on('target.notify', function(name, value) {
		if (target) target[name] = value;
	});

	dispatcher.on('update.scale', function(v) {
		data.get('ui:timeScale').value = v;

		timeline.repaint();
	});

	// handle undo / redo
	dispatcher.on('controls.undo', function() {
		var history = undoManager.undo();
		data.setJSONString(history.state);

		updateState();
	});

	dispatcher.on('controls.redo', function() {
		var history = undoManager.redo();
		data.setJSONString(history.state);

		updateState();
	});

	/*
		Paint Routines
	*/

	function paint() {
		requestAnimationFrame(paint);

		if (startPlay) {
			var t = (performance.now() - startPlay) / 1000;
			setCurrentTime(t);


			if (t > data.get('ui:totalTime').value) {
				// simple loop
				startPlay = performance.now();
			}
		}

		if (needsResize) {
			// div.style.width = width + 'px';
			// div.style.height = height + 'px';

			restyle(layerPanel.dom, timeline.dom);

			timeline.resize();
			repaintAll();
			needsResize = false;

			dispatcher.fire('resize');
		}

		timeline._paint();
	}

	paint();

	/*
		End Paint Routines
	*/

	function save(name) {
		if (!name) name = 'autosave';

		var json = data.getJSONString();

		try {
			localStorage[STORAGE_PREFIX + name] = json;
			dispatcher.fire('save:done');
		} catch (e) {
			throw new Error('Cannot save ' + name + json);
		}
	}

	function saveAs(name) {
		if (!name) name = data.get('name').value;
		name = prompt('Pick a name to save to (localStorage)', name);
		if (name) {
			data.data.name = name;
			save(name);
		}
	}

	function saveSimply() {
		var name = data.get('name').value;
		if (name) {
			save(name);
		} else {
			saveAs(name);
		}
	}

	function exportJSON() {
		var json = data.getJSONString();
		var ret = prompt('Hit OK to download otherwise Copy and Paste JSON', json);

		if (!ret) return;

		// make json downloadable
		json = data.getJSONString('\t');
		var fileName = 'timeliner-test.json';

		saveToFile(json, fileName);
	}

	function loadJSONString(o) {
		// should catch and check errors here
		var json = JSON.parse(o);
		load(json);
	}

	function load(o) {
		data.setJSON(o);
		//
		if (data.getValue('ui') === undefined) {
			data.setValue('ui', {
				currentTime: 0,
				totalTime: 20,
				scrollTime: 0,
				timeScale: 40
			});
		}

		undoManager.clear();
		undoManager.save(new UndoState(data, 'Loaded'), true);

		updateState();
	}

	function updateState() {
		layers = layerStore.value; // FIXME: support Arrays
		layerPanel.setState(layerStore);
		timeline.setState(layerStore);

		repaintAll();
	}

	function repaintAll() {
		var contentHeight = layers.length * Settings.LINE_HEIGHT;
		scrollbar.setLength(Settings.TIMELINE_SCROLL_HEIGHT / contentHeight);

		layerPanel.repaint();
		timeline.repaint();
	}

	function promptImport() {
		var json = prompt('Paste JSON in here to Load');
		if (!json) return;
		loadJSONString(json);
	}

	function open(title) {
		if (title) {
			loadJSONString(localStorage[STORAGE_PREFIX + title]);
		}
	}

	this.openLocalSave = open;

	dispatcher.on('import', function() {
		promptImport();
	});

	dispatcher.on('new', function() {
		data.blank();
		updateState();
	});

	dispatcher.on('openfile', function() {
		openAs(function(data) {
			// console.log('loaded ' + data);
			loadJSONString(data);
		}, div);
	});

	dispatcher.on('open', open);
	dispatcher.on('export', exportJSON);

	dispatcher.on('save', saveSimply);
	dispatcher.on('save_as', saveAs);

	// Expose API
	this.save = save;
	this.load = load;

	/*
		Start DOM Stuff (should separate file)
	*/

	var div = document.createElement('div');
	div.style.cssText = 'position: absolute;';
	div.style.top = '22px';

	var pane = document.createElement('div');
	pane.id = 'pane';
	style(pane, {
		position: 'fixed',
		top: '20px',
		left: '20px',
		margin: 0,
		border: '1px solid ' + Theme.a,
		padding: 0,
		overflow: 'hidden',
		backgroundColor: Theme.a,
		color: Theme.d,
		zIndex: Z_INDEX,
		fontFamily: 'monospace',
		fontSize: '12px'
	});


	var headerStyles = {
		position: 'absolute',
		top: '0px',
		width: '100%',
		height: '22px',
		lineHeight: '22px',
		overflow: 'hidden'
	};

	var buttonStyles = {
		width: '20px',
		height: '20px',
		padding: '2px',
		marginRight: '2px'
	};

	var paneTitle = document.createElement('div');
	paneTitle.id = 'paneTitle';
	style(paneTitle, headerStyles, {
		borderBottom: '1px solid ' + Theme.b,
		textAlign: 'center'
	});

	var titleBar = document.createElement('span');
	paneTitle.appendChild(titleBar);

	var title = 'Timeliner ' + packageJson.version;
	if (Settings.title) {
		title = Settings.title;
	}
	titleBar.innerHTML = title;
	paneTitle.appendChild(titleBar);

	var topRightBar = document.createElement('div');
	style(topRightBar, headerStyles, {
		textAlign: 'right'
	});

	paneTitle.appendChild(topRightBar);

	// resize minimize
	// var resize_small = new IconButton(10, 'resize_small', 'minimize', dispatcher);
	// topRightBar.appendChild(resize_small.dom);

	// resize full
	var resizeFull = new IconButton(10, 'resize_full', 'maximize', dispatcher);
	style(resizeFull.dom, buttonStyles, { marginRight: '2px' });
	topRightBar.appendChild(resizeFull.dom);

	var paneStatus = document.createElement('div');

	var footerStyles = {
		position: 'absolute',
		width: '100%',
		height: '22px',
		lineHeight: '22px',
		bottom: '0',
		// padding: '2px',
		background: Theme.a,
		fontSize: '11px'
	};

	style(paneStatus, footerStyles, {
		borderTop: '1px solid ' + Theme.b
	});

	pane.appendChild(div);
	pane.appendChild(paneStatus);
	pane.appendChild(paneTitle);

	var labelStatus = document.createElement('span');
	labelStatus.id = 'labelStatus';
	labelStatus.textContent = '';
	labelStatus.style.marginLeft = '10px';
	labelStatus.style.float = 'left';

	this.setStatus = function(text) {
		labelStatus.textContent = text;
	};

	this.setBounds = function(left, top, width, height) {
		utils.setBounds(pane, left, top, width, height);
		utils.setBounds(ghostpane, left, top, width, height);
		resize(width, height);
	};

	dispatcher.on('state:save', function(description) {
		dispatcher.fire('status', description);
		save('autosave');
	});

	dispatcher.on('status', this.setStatus);

	var bottomRight = document.createElement('div');
	style(bottomRight, footerStyles, {
		textAlign: 'right'
	});

	bottomRight.appendChild(labelStatus);
	paneStatus.appendChild(bottomRight);

	// add layer
	var plus = new IconButton(12, 'plus', 'New Layer', dispatcher);
	plus.onClick(function() {
		var name = prompt('Layer name?');
		addLayer(name);

		undoManager.save(new UndoState(data, 'Layer added'));

		repaintAll();
	});
	style(plus.dom, buttonStyles);
	bottomRight.appendChild(plus.dom);


	// trash
	var trash = new IconButton(12, 'trash', 'Delete save', dispatcher);
	trash.onClick(function() {
		var name = data.get('name').value;
		if (name && localStorage[STORAGE_PREFIX + name]) {
			var ok = confirm('Are you sure you wish to delete ' + name + '?');
			if (ok) {
				delete localStorage[STORAGE_PREFIX + name];
				dispatcher.fire('status', name + ' deleted');
				dispatcher.fire('save:done');
			}
		}
	});
	style(trash.dom, buttonStyles, { marginRight: '2px' });
	bottomRight.appendChild(trash.dom);


	/**
   * TODO <Dock Full | Dock Botton | Snap Window Edges | zoom in | zoom out | Settings | help>
   **/

	/*
			End DOM Stuff
	*/

	var ghostpane = document.createElement('div');
	ghostpane.id = 'ghostpane';
	style(ghostpane, {
		background: '#999',
		opacity: 0.2,
		position: 'fixed',
		margin: 0,
		padding: 0,
		zIndex: (Z_INDEX - 1),
		// transition: 'all 0.25s ease-in-out',
		transitionProperty: 'top, left, width, height, opacity',
		transitionDuration: '0.25s',
		transitionTimingFunction: 'ease-in-out'
	});


	//
	// Handle DOM Views
	//

	// Shadow Root
	var root = document.createElement('timeliner');
	document.body.appendChild(root);
	if (root.createShadowRoot) root = root.createShadowRoot();

	window.r = root;

	// var iframe = document.createElement('iframe');
	// document.body.appendChild(iframe);
	// root = iframe.contentDocument.body;

	root.appendChild(pane);
	root.appendChild(ghostpane);

	div.appendChild(layerPanel.dom);
	div.appendChild(timeline.dom);

	var scrollbar = new ScrollBar(200, 10);
	div.appendChild(scrollbar.dom);

	// percentages
	scrollbar.onScroll.do(function(type, scrollTo) {
		if (type === 'scrollto') {
			layerPanel.scrollTo(scrollTo);
			timeline.scrollTo(scrollTo);
		}
	});

	// TODO: Keyboard Shortcuts
	// Esc - Stop and review to last played from / to the start?
	// Space - play / pause from current position
	// Enter - play all
	// k - keyframe

	document.addEventListener('keydown', function(e) {
		var play = e.keyCode === 32; // space
		var enter = e.keyCode === 13; //
		// var undo = e.metaKey && e.keyCode == 91 && !e.shiftKey;

		var active = document.activeElement;
		// console.log( active.nodeName );

		if (active.nodeName.match(/(INPUT|BUTTON|SELECT|TIMELINER)/)) {
			active.blur();
		}

		if (play) {
			dispatcher.fire('controls.toggle_play');
		}
		else if (enter) {
			// FIXME: Return should play from the start or last played from?
			dispatcher.fire('controls.restartPlay');
			// dispatcher.fire('controls.undo');
		}
		else if (e.keyCode === 27) {
			// Esc = stop. FIXME: should rewind head to last played from or Last pointed from?
			dispatcher.fire('controls.pause');
		}
	});

	var needsResize = true;

	function resize(width, height) {
		// data.get('ui:bounds').value = {
		// 	width: width,
		// 	height: height
		// };
		// TODO: remove ugly hardcodes
		width -= 4;
		height -= 44;

		Settings.width = width - Settings.LEFT_PANE_WIDTH;
		Settings.height = height;

		Settings.TIMELINE_SCROLL_HEIGHT = height - Settings.MARKER_TRACK_HEIGHT;
		var scrollableHeight = Settings.TIMELINE_SCROLL_HEIGHT;

		scrollbar.setHeight(scrollableHeight - 2);
		// scrollbar.setThumb

		style(scrollbar.dom, {
			top: Settings.MARKER_TRACK_HEIGHT + 'px',
			left: (width - 16) + 'px'
		});

		needsResize = true;
	}

	function restyle(left, right) {
		var cssText = 'position: absolute; left: 0px; top: 0px; height: ' + Settings.height + 'px;';
		left.style.cssText = cssText;
		style(left, {
			// background: Theme.a,
			overflow: 'hidden'
		});
		left.style.width = Settings.LEFT_PANE_WIDTH + 'px';

		// right.style.cssText = 'position: absolute; top: 0px;';
		right.style.position = 'absolute';
		right.style.top = '0px';
		right.style.left = Settings.LEFT_PANE_WIDTH + 'px';
	}

	function addLayer(name) {
		var layer = new LayerProp(name);

		layers = layerStore.value;
		layers.push(layer);

		layerPanel.setState(layerStore);
	}

	this.addLayer = addLayer;

	this.setTarget = function(t) {
		timeline = t;
	};

	function getValueRanges(ranges, inter) {
		var interval = inter || 0.15;
		ranges = ranges || 2;

		// not optimized! TODO: What does this mean?
		var t = data.get('ui:currentTime').value;

		var values = [];

		for (var u = -ranges; u <= ranges; u++) {
			// if (u == 0) continue;
			var o = {};

			for (var l = 0; l < layers.length; l++) {
				var layer = layers[l];
				var m = utils.timeAtLayer(layer, t + (u * interval));
				o[layer.name] = m.value;
			}

			values.push(o);

		}

		return values;
	}

	this.getValues = getValueRanges;

	DockingWindow(resize, pane, ghostpane, needsResize, paneTitle, resizeFull);
}

window.Timeliner = Timeliner;
