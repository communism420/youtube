const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDubbingPolicy(context) {
	const source = fs.readFileSync(
		path.join(__dirname, '../../js&css/web-accessible/www.youtube.com/player.js'),
		'utf8'
	);
	const start = source.indexOf('ImprovedTube.getAudioTrackInfo = function (track) {');
	const end = source.indexOf('/*------------------------------------------------------------------------------\n# JUMP TO THE NEXT KEY SCENE', start);

	if (start < 0 || end < 0) {
		throw new Error('Dubbing policy source was not found');
	}

	vm.createContext(context);
	vm.runInContext(source.slice(start, end), context);
}

function audioTrack({id, languageCode, name, isAutoDubbed = false, isDefault = false}) {
	return {
		id,
		isAutoDubbed,
		getLanguageInfo() {
			return {id, languageCode, name, isDefault};
		}
	};
}

function createContext(tracks) {
	let selectedTrack = tracks[0];
	let setAudioTrackCalls = 0;
	const player = {
		getAudioTrack: () => selectedTrack,
		getAvailableAudioTracks: () => tracks,
		querySelector: () => null,
		setAudioTrack: track => {
			setAudioTrackCalls++;
			selectedTrack = track;
		}
	};
	const context = {
		Array,
		console,
		clearInterval: () => {},
		clearTimeout: () => {},
		document: {querySelector: () => null},
		ImprovedTube: {
			elements: {player},
			storage: {
				disable_auto_dubbing: true,
				player_default_dubbed_language: 'ru',
				preferred_dubbing_language: ''
			}
		},
		location: {href: 'https://www.youtube.com/watch?v=test-video'},
		MutationObserver: class { disconnect() {} observe() {} },
		setInterval: () => 1,
		setTimeout: callback => {
			callback();
			return 1;
		},
		Set,
		String,
		window: {
			cancelAnimationFrame: () => {},
			requestAnimationFrame: callback => {
				callback();
				return 1;
			}
		}
	};

	loadDubbingPolicy(context);
	return {context, player, selectedTrack: () => selectedTrack, setAudioTrackCalls: () => setAudioTrackCalls};
}

describe('dubbing policy', () => {
	test('selects a human preferred-language dub and never its auto-dub counterpart', () => {
		const original = audioTrack({id: 'en', languageCode: 'en', name: 'English', isDefault: true});
		const humanRussian = audioTrack({id: 'ru.1', languageCode: 'ru', name: 'Russian'});
		const autoRussian = audioTrack({id: 'ru.2', languageCode: 'ru', name: 'Russian', isAutoDubbed: true});
		const {context, player, selectedTrack, setAudioTrackCalls} = createContext([original, humanRussian, autoRussian]);

		context.ImprovedTube.selectPermittedAudioTrack(player);
		context.ImprovedTube.selectPermittedAudioTrack(player);

		expect(selectedTrack()).toBe(humanRussian);
		expect(setAudioTrackCalls()).toBe(1);
		expect(context.ImprovedTube.audioTrackIsAutoDubbed(autoRussian)).toBe(true);
		expect(context.ImprovedTube.audioTrackIsAutoDubbed(humanRussian)).toBe(false);
	});

	test('does not pollingly switch tracks when the player cannot report the current track', () => {
		const original = audioTrack({id: 'en', languageCode: 'en', name: 'English', isDefault: true});
		const autoRussian = audioTrack({id: 'ru.2', languageCode: 'ru', name: 'Russian', isAutoDubbed: true});
		const {context, player, setAudioTrackCalls} = createContext([original, autoRussian]);

		delete player.getAudioTrack;
		context.ImprovedTube.disableAutoDubbing();
		context.ImprovedTube.autoDubbingGuard.enforce();
		context.ImprovedTube.autoDubbingGuard.enforce();

		expect(setAudioTrackCalls()).toBe(1);
		expect(context.ImprovedTube.autoDubbingGuard.interval).toBeNull();
	});

	test('falls back to the original track when the preferred language exists only as auto-dub', () => {
		const original = audioTrack({id: 'en', languageCode: 'en', name: 'English', isDefault: true});
		const autoRussian = audioTrack({id: 'ru.2', languageCode: 'ru', name: 'Russian', isAutoDubbed: true});
		const {context, player, selectedTrack} = createContext([original, autoRussian]);

		context.ImprovedTube.selectPermittedAudioTrack(player);

		expect(selectedTrack()).toBe(original);
	});

	test('hides only the auto-dub menu section and keeps human dubs visible', () => {
		const {context} = createContext([]);
		const createStyle = () => {
			const values = {};
			const priorities = {};
			return {
				display: '',
				getPropertyPriority: property => priorities[property] || '',
				getPropertyValue: property => values[property] || '',
				removeProperty(property) {
					delete values[property];
					delete priorities[property];
					if (property === 'display') this.display = '';
					if (property === 'width') this.width = '';
				},
				setProperty(property, value, priority = '') {
					values[property] = value;
					priorities[property] = priority;
					if (property === 'display') this.display = value;
					if (property === 'width') this.width = value;
				}
			};
		};
		const menuItem = (textContent, isSectionHeader = false) => ({
			classList: {contains: value => isSectionHeader && value === 'ytp-menuitem-section-header'},
			dataset: {},
			style: createStyle(),
			textContent
		});
		const humanHeader = menuItem('Available audio tracks', true);
		const humanRussian = menuItem('Russian');
		const autoHeader = menuItem('Автоматическое дублирование', true);
		const autoRussian = menuItem('Russian');
		const items = [humanHeader, humanRussian, autoHeader, autoRussian];
		const panel = {
			closest: () => null,
			dataset: {},
			offsetWidth: 220,
			querySelectorAll: () => items,
			style: createStyle()
		};

		context.document.querySelector = () => panel;
		context.ImprovedTube.storage.hide_auto_dubbed_options = true;
		context.ImprovedTube.hideAutoDubbedMenuItems();

		expect(context.ImprovedTube.isAutoDubbedMenuHeader(autoHeader)).toBe(true);
		expect(context.ImprovedTube.isAutoDubbedMenuHeader(humanHeader)).toBe(false);
		expect(humanHeader.style.display).toBe('');
		expect(humanRussian.style.display).toBe('');
		expect(autoHeader.style.display).toBe('none');
		expect(autoRussian.style.display).toBe('none');
		// Never put fit-content on the inner menu: its footer can make the panel
		// wider than YouTube's normal audio-track menu.
		expect(panel.style.width).toBe(undefined);

		context.ImprovedTube.storage.hide_auto_dubbed_options = false;
		context.ImprovedTube.hideAutoDubbedMenuItems();
		expect(panel.style.width).toBe(undefined);
	});

	test('uses the native width of a filtered panel copy instead of the pre-filter width', () => {
		const {context} = createContext([]);
		const createStyle = () => {
			const values = {};
			const priorities = {};
			return {
				getPropertyPriority: property => priorities[property] || '',
				getPropertyValue: property => values[property] || '',
				removeProperty(property) {
					delete values[property];
					delete priorities[property];
				},
				setProperty(property, value, priority = '') {
					values[property] = value;
					priorities[property] = priority;
				}
			};
		};

		const menuPanel = {dataset: {}, style: createStyle()};
		const probeMenu = {style: createStyle()};
		const probePanel = {
			style: createStyle(),
			getBoundingClientRect: () => ({width: 213})
		};
		const probe = {
			dataset: {},
			style: createStyle(),
			matches: () => false,
			getBoundingClientRect: () => ({width: 228}),
			querySelector: selector => selector === '.ytp-panel' ? probePanel : probeMenu,
			querySelectorAll: () => [],
			remove() {
				this.removed = true;
			}
		};
		const popup = {dataset: {}, style: createStyle(), cloneNode: () => probe};
		const player = {
			appendChild: node => {
				player.appended = node;
			}
		};
		const panel = {
			dataset: {},
			style: createStyle(),
			closest: selector => {
				if (selector === '.ytp-panel') return menuPanel;
				if (selector === '.html5-video-player, #movie_player') return player;
				return null;
			}
		};
		menuPanel.closest = selector => ['.ytp-popup', '.ytp-settings-menu'].includes(selector) ? popup : null;

		context.ImprovedTube.applyFilteredAudioMenuWidth(panel);

		expect(player.appended).toBe(probe);
		expect(probe.removed).toBe(true);
		expect(probe.style.getPropertyValue('right')).toBe('auto');
		expect(menuPanel.style.getPropertyValue('width')).toBe('228px');
		expect(menuPanel.style.getPropertyValue('min-width')).toBe('228px');
		expect(menuPanel.style.getPropertyValue('max-width')).toBe('228px');
		expect(menuPanel.style.getPropertyPriority('width')).toBe('important');
		expect(popup.style.getPropertyValue('width')).toBe('228px');
		expect(popup.style.getPropertyValue('min-width')).toBe('228px');
		expect(popup.style.getPropertyValue('max-width')).toBe('228px');

		context.ImprovedTube.restoreAutoDubbedMenuLayout(panel);
		expect(menuPanel.style.getPropertyValue('width')).toBe('');
		expect(popup.style.getPropertyValue('width')).toBe('');
	});
});
