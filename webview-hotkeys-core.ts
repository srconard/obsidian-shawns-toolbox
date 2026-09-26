// webview-hotkeys-core.ts — framework-free logic for "Forward Obsidian hotkeys
// from Web viewer" (v1.54.0). The Obsidian/Electron glue is webview-hotkeys.ts.
//
// Every key combo is reduced to one canonical string, "Ctrl+Shift+P": modifiers
// in the fixed order Ctrl, Meta, Alt, Shift, then the key. Letters are upper
// case, punctuation is the unshifted character (Ctrl+Shift+, stays ","), the
// space bar is "Space", and anything else keeps its KeyboardEvent.key name
// ("F11", "Enter", "ArrowLeft"). The same function runs on three inputs:
//   - an Obsidian hotkey  { modifiers: ["Mod", "Shift"], key: "P" }
//   - a baked hotkey      { modifiers: "Ctrl,Shift",     key: "P" }  (hotkeyManager.bakedHotkeys)
//   - a KeyboardEvent     { ctrlKey, shiftKey, key, code, … }
// and GUEST_SCRIPT carries a copy of the event half into the web page, so a
// test below evaluates that copy and checks it agrees with this one.

export const MODIFIER_ORDER = ["Ctrl", "Meta", "Alt", "Shift"] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

/** What eco-web's composer and ordinary editing need, per Shawn's brief. */
export const DEFAULT_PASS_THROUGH_KEYS =
	"Ctrl+., Ctrl+L, Ctrl+Enter, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y";

/** Prefix of the console.log line the injected page script emits. */
export const SENTINEL = "__stb_hotkey__";

export type ForwardMode = "auto" | "inject" | "builtin";

/** KeyboardEvent.code → key, for keys whose .key changes with Shift/layout. */
const CODE_KEYS: Record<string, string> = {
	Comma: ",",
	Period: ".",
	Slash: "/",
	Semicolon: ";",
	Quote: "'",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Minus: "-",
	Equal: "=",
	Backquote: "`",
	Space: "Space",
};

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "Hyper", "Super", "CapsLock", "Fn"];

/** Case-insensitive spellings of the named keys a user may type in the setting. */
const NAMED_KEYS: Record<string, string> = {
	esc: "Escape",
	escape: "Escape",
	return: "Enter",
	enter: "Enter",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	del: "Delete",
	insert: "Insert",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	arrowup: "ArrowUp",
	arrowdown: "ArrowDown",
	arrowleft: "ArrowLeft",
	arrowright: "ArrowRight",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	// So a pass-through entry can name a key the list separators would eat.
	comma: ",",
	period: ".",
	semicolon: ";",
	plus: "+",
};

/** Normalise a key name: single characters upper-cased, " " → "Space", named keys canonical. */
export function normaliseKey(key: string): string {
	if (key === " " || key.toLowerCase() === "space" || key.toLowerCase() === "spacebar") return "Space";
	if (key.length === 1) return key.toUpperCase();
	if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
	const named = NAMED_KEYS[key.toLowerCase()];
	if (named) return named;
	return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Canonical string from a modifier set + key. */
export function comboString(mods: Iterable<string>, key: string): string {
	const set = new Set<string>();
	for (const m of mods) set.add(m);
	const parts: string[] = [];
	for (const m of MODIFIER_ORDER) if (set.has(m)) parts.push(m);
	parts.push(normaliseKey(key));
	return parts.join("+");
}

/** Map one modifier word (any spelling) to a canonical modifier. */
export function resolveModifier(word: string, isMac: boolean): Modifier | null {
	switch (word.trim().toLowerCase()) {
		case "mod":
			return isMac ? "Meta" : "Ctrl";
		case "ctrl":
		case "control":
		case "ctl":
			return "Ctrl";
		case "meta":
		case "cmd":
		case "command":
		case "⌘":
		case "win":
		case "super":
			return "Meta";
		case "alt":
		case "option":
		case "opt":
		case "⌥":
			return "Alt";
		case "shift":
		case "⇧":
			return "Shift";
		default:
			return null;
	}
}

/** An Obsidian hotkey: modifiers as an array (settings) or a comma string (baked). */
export interface HotkeyLike {
	modifiers: string[] | string;
	key: string;
}

export function hotkeyCombo(h: HotkeyLike, isMac: boolean): string | null {
	if (!h || typeof h.key !== "string" || !h.key) return null;
	const words = Array.isArray(h.modifiers)
		? h.modifiers
		: String(h.modifiers || "").split(",").filter((w) => w.trim() !== "");
	const mods: Modifier[] = [];
	for (const w of words) {
		const m = resolveModifier(w, isMac);
		if (!m) return null;
		mods.push(m);
	}
	return comboString(mods, h.key);
}

/** The slice of a KeyboardEvent the matcher reads. */
export interface KeyEventLike {
	key: string;
	code?: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	/** True when AltGr is down (Windows reports AltGr as Ctrl+Alt). */
	altGraph?: boolean;
}

/** Canonical combo for a keydown, or null for a bare modifier press. */
export function eventCombo(e: KeyEventLike): string | null {
	if (!e || typeof e.key !== "string") return null;
	if (MODIFIER_KEYS.indexOf(e.key) >= 0) return null;
	const code = e.code || "";
	let key = e.key;
	const letter = /^Key([A-Z])$/.exec(code);
	const digit = /^Digit([0-9])$/.exec(code);
	if (letter) key = letter[1];
	else if (digit) key = digit[1];
	else if (CODE_KEYS[code]) key = CODE_KEYS[code];
	if (key === "Unidentified" || key === "Dead" || key === "") return null;
	const mods: Modifier[] = [];
	if (e.ctrlKey) mods.push("Ctrl");
	if (e.metaKey) mods.push("Meta");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	return comboString(mods, key);
}

/**
 * Whether a combo is the kind that may be forwarded at all: it must hold Ctrl,
 * Meta or Alt, or be a function key. Plain typing and Shift+letter never are.
 * AltGr (Ctrl+Alt on Windows) types characters on many layouts, so it is out.
 */
export function isForwardableCombo(combo: string, altGraph = false): boolean {
	if (altGraph) return false;
	const parts = combo.split("+");
	const key = parts[parts.length - 1];
	const mods = parts.slice(0, -1);
	if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return true;
	return mods.indexOf("Ctrl") >= 0 || mods.indexOf("Meta") >= 0 || mods.indexOf("Alt") >= 0;
}

/**
 * Parse the "Keys to leave to the web page" setting. Comma, semicolon or
 * newline separated; "Mod"/"Cmd" understood; on a Mac every Ctrl entry also
 * covers the ⌘ version, because that is what "Ctrl+C" means there. Entries
 * that do not parse are returned in `invalid` rather than silently dropped.
 */
export function parsePassThrough(text: string, isMac: boolean): { combos: Set<string>; invalid: string[] } {
	const combos = new Set<string>();
	const invalid: string[] = [];
	for (const raw of String(text || "").split(/[,;\n]/)) {
		const entry = raw.trim();
		if (!entry) continue;
		// The key is whatever follows the last "+", except "Ctrl++" means the + key.
		let keyPart: string;
		let modPart: string;
		if (/\+\+$/.test(entry)) {
			keyPart = "+";
			modPart = entry.slice(0, -2);
		} else {
			const i = entry.lastIndexOf("+");
			keyPart = i < 0 ? entry : entry.slice(i + 1).trim();
			modPart = i < 0 ? "" : entry.slice(0, i);
		}
		const modWords = modPart.split("+").filter((w) => w.trim() !== "");
		const mods: Modifier[] = [];
		let ok = keyPart !== "";
		for (const w of modWords) {
			const r = resolveModifier(w, isMac);
			if (!r) ok = false;
			else mods.push(r);
		}
		if (!ok) {
			invalid.push(entry);
			continue;
		}
		const key = keyPart;
		combos.add(comboString(mods, key));
		if (isMac && mods.indexOf("Ctrl") >= 0 && mods.indexOf("Meta") < 0) {
			combos.add(comboString(mods.map((x) => (x === "Ctrl" ? "Meta" : x)), key));
		}
	}
	return { combos, invalid };
}

/** combo → the command ids bound to it, in Obsidian's own order. */
export type HotkeyIndex = Map<string, string[]>;

/** Build the index from hotkeyManager.bakedHotkeys + bakedIds (parallel arrays). */
export function indexFromBaked(hotkeys: HotkeyLike[], ids: string[], isMac: boolean): HotkeyIndex {
	const index: HotkeyIndex = new Map();
	const n = Math.min(hotkeys.length, ids.length);
	for (let i = 0; i < n; i++) addToIndex(index, hotkeyCombo(hotkeys[i], isMac), ids[i]);
	return index;
}

/**
 * Build the index per command: custom hotkeys win when set (an empty custom list
 * means "unbound", exactly as in Obsidian's settings), else the defaults.
 */
export function indexFromCommands(
	ids: string[],
	custom: (id: string) => HotkeyLike[] | undefined | null,
	defaults: (id: string) => HotkeyLike[] | undefined | null,
	isMac: boolean
): HotkeyIndex {
	const index: HotkeyIndex = new Map();
	for (const id of ids) {
		const c = custom(id);
		const list = c != null ? c : defaults(id) || [];
		for (const h of list) addToIndex(index, hotkeyCombo(h, isMac), id);
	}
	return index;
}

function addToIndex(index: HotkeyIndex, combo: string | null, id: string): void {
	if (!combo || !id) return;
	const list = index.get(combo);
	if (!list) index.set(combo, [id]);
	else if (list.indexOf(id) < 0) list.push(id);
}

/** The combos worth forwarding: bound in Obsidian, forwardable, not left to the page. */
export function forwardSet(index: HotkeyIndex, passThrough: Set<string>): string[] {
	const out: string[] = [];
	index.forEach((_ids, combo) => {
		if (!isForwardableCombo(combo)) return;
		if (passThrough.has(combo)) return;
		out.push(combo);
	});
	return out.sort();
}

/** Why a keydown is (not) forwarded — one decision shared by every path. */
export type ForwardDecision = "forward" | "not-forwardable" | "left-to-page" | "unbound";

export function decide(
	combo: string | null,
	index: HotkeyIndex,
	passThrough: Set<string>,
	altGraph = false
): ForwardDecision {
	if (!combo || !isForwardableCombo(combo, altGraph)) return "not-forwardable";
	if (passThrough.has(combo)) return "left-to-page";
	if (!index.has(combo)) return "unbound";
	return "forward";
}

/** Parse a console-message line from the page script; null if it is not ours. */
export function parseSentinel(message: unknown): string | null {
	if (typeof message !== "string" || message.indexOf(SENTINEL) !== 0) return null;
	try {
		const data = JSON.parse(message.slice(SENTINEL.length));
		return data && typeof data.combo === "string" ? data.combo : null;
	} catch {
		return null;
	}
}

/**
 * Whether this Obsidian's Web viewer already forwards keys itself. Obsidian
 * 1.13.x hooks the guest's `before-input-event` in WebviewerView
 * .configureWebContents and replays each keydown into app.keymap — measured on
 * the NAS Obsidian 1.13.7, 2026-09-26. Older builds may not; then we inject.
 */
export function hasBuiltinForwarding(configureWebContentsSource: string | null | undefined): boolean {
	return typeof configureWebContentsSource === "string" && configureWebContentsSource.indexOf("before-input-event") >= 0;
}

/** Which mechanism to use for a view, given the setting and what Obsidian has. */
export function chooseMechanism(mode: ForwardMode, builtin: boolean): "builtin" | "inject" {
	if (mode === "builtin") return "builtin";
	if (mode === "inject") return "inject";
	return builtin ? "builtin" : "inject";
}

/**
 * Page script, run in the guest by webview.executeJavaScript. Installs once per
 * page (window.__stbHotkeys) and afterwards only replaces the combo list.
 *
 * Two listeners on window. A capture listener notices a combo on the list; a
 * bubble listener, which runs after the page's own document/element handlers,
 * claims it: if the page did not preventDefault, it preventDefaults and emits
 * the sentinel. If the page stopped propagation, the bubble listener never
 * runs, so a zero-delay timeout emits instead when the page still did not
 * preventDefault. A page that preventDefaults a key has handled it and keeps it.
 */
export function guestScript(combos: string[]): string {
	return `(function(){
var list = ${JSON.stringify(combos)};
var S = ${JSON.stringify(SENTINEL)};
if (window.__stbHotkeys) { window.__stbHotkeys.set(list); return "updated"; }
var CODE = ${JSON.stringify(CODE_KEYS)};
var MODK = ${JSON.stringify(MODIFIER_KEYS)};
var set = {};
function setList(l){ set = {}; for (var i=0;i<l.length;i++) set[l[i]] = true; }
setList(list);
function norm(k){
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}
function combo(e){
  if (MODK.indexOf(e.key) >= 0) return null;
  var c = e.code || "", k = e.key, m;
  if ((m = /^Key([A-Z])$/.exec(c))) k = m[1];
  else if ((m = /^Digit([0-9])$/.exec(c))) k = m[1];
  else if (CODE[c]) k = CODE[c];
  if (!k || k === "Unidentified" || k === "Dead") return null;
  var p = [];
  if (e.ctrlKey) p.push("Ctrl");
  if (e.metaKey) p.push("Meta");
  if (e.altKey) p.push("Alt");
  if (e.shiftKey) p.push("Shift");
  p.push(norm(k));
  return p.join("+");
}
function emit(c){ console.log(S + JSON.stringify({ combo: c })); }
var pending = null;
function onCapture(e){
  if (e.isComposing) return;
  if (e.getModifierState && e.getModifierState("AltGraph")) return;
  var c = combo(e);
  if (!c || !set[c]) return;
  var rec = { e: e, c: c, done: false };
  pending = rec;
  setTimeout(function(){
    if (!rec.done && !e.defaultPrevented) { rec.done = true; emit(c); }
  }, 0);
}
function onBubble(e){
  var rec = pending;
  if (!rec || rec.e !== e || rec.done) return;
  rec.done = true;
  if (e.defaultPrevented) return;
  e.preventDefault();
  emit(rec.c);
}
window.addEventListener("keydown", onCapture, true);
window.addEventListener("keydown", onBubble, false);
window.__stbHotkeys = {
  set: setList,
  combo: combo,
  remove: function(){
    window.removeEventListener("keydown", onCapture, true);
    window.removeEventListener("keydown", onBubble, false);
    delete window.__stbHotkeys;
  }
};
return "installed";
})()`;
}

/** Page script that removes the listeners again (toggle off / unload). */
export const GUEST_REMOVE_SCRIPT =
	"(function(){ if (window.__stbHotkeys) { window.__stbHotkeys.remove(); return 'removed'; } return 'absent'; })()";

/**
 * Body-level overlays Obsidian creates for commands and menus. While a leaf is
 * in element fullscreen (web-fullscreen.ts, F11) only that element's subtree is
 * painted, so an overlay appended to <body> exists but is invisible: Ctrl+P
 * "did nothing" because the palette opened behind the fullscreen leaf and took
 * the focus with it (reproduced on the NAS Obsidian 1.13.7, 2026-09-26). These
 * are moved into the fullscreen element while it lasts.
 */
export const FULLSCREEN_OVERLAY_CLASSES = [
	"modal-container",
	"menu",
	"suggestion-container",
	"notice-container",
	"tooltip",
	"popover",
];

export function isFullscreenOverlay(classList: { contains(token: string): boolean } | null | undefined): boolean {
	if (!classList) return false;
	for (const c of FULLSCREEN_OVERLAY_CLASSES) if (classList.contains(c)) return true;
	return false;
}
