// My Notes for Thunderbird — panel.js
"use strict";

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  notes: {},           // { [name]: { content: string, updatedAt: number } }
  activeNote: "",
  theme: "light",
  fontSize: 15,
  fontFamily: "",
  toolbarVisible: true,
  sidebarVisible: true,
};

let saveTimer = null;
let pendingDeleteNote = null;
let pendingRenameNote = null;
let savedSelection = null;
let findMatches = [];
let findIndex = 0;
let dirtySinceExport = false; // true when notes changed since the last HTML/JSON export/backup

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const app              = $("app");
const toolbar          = $("toolbar");
const sidebar          = $("sidebar");
const notesList        = $("notes-list");
const editor           = $("editor");
const themeSelect      = $("theme-select");
const fontSizeSelect   = $("font-size-select");
const fontFamilySelect = $("font-family-select");
const fontColorInput   = $("font-color-input");
const colorPreview     = $("color-preview");
const wordCount        = $("word-count");
const saveStatus       = $("save-status");
const noteNameStatus   = $("note-name-status");
const findBar          = $("find-bar");
const findInput        = $("find-input");
const findCount        = $("find-count");
const exportPanel      = $("export-panel");

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const stored = await browser.storage.local.get(null);
  if (stored.notes) state.notes = stored.notes;
  if (stored.activeNote) state.activeNote = stored.activeNote;
  if (stored.theme) state.theme = stored.theme;
  if (stored.fontSize) state.fontSize = stored.fontSize;
  if (stored.fontFamily != null) state.fontFamily = stored.fontFamily;
  if (stored.toolbarVisible != null) state.toolbarVisible = stored.toolbarVisible;
  if (stored.sidebarVisible != null) state.sidebarVisible = stored.sidebarVisible;

  // Ensure activeNote exists
  if (!state.notes[state.activeNote]) {
    const keys = Object.keys(state.notes);
    state.activeNote = keys.length > 0 ? keys[0] : "";
  }

  applyTheme();
  applyFontSize();
  applyFontFamily();
  applyToolbarVisibility();

  themeSelect.value = state.theme;
  // Select matching font size option (or closest)
  fontSizeSelect.value = String(state.fontSize);
  if (!fontSizeSelect.value) fontSizeSelect.value = "15";
  // Select matching font family
  fontFamilySelect.value = state.fontFamily || "";

  renderSidebar();
  loadActiveNote();
  updateWordCount();
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function scheduleSave() {
  dirtySinceExport = true;
  clearTimeout(saveTimer);
  saveStatus.textContent = "Saving…";
  saveTimer = setTimeout(async () => {
    if (state.activeNote) {
      // Strip resize-wired flags before saving so they don't persist in storage
      editor.querySelectorAll("img[data-resize-wired]").forEach(img => delete img.dataset.resizeWired);
      state.notes[state.activeNote] = {
        content: editor.innerHTML,
        updatedAt: Date.now(),
      };
    }
    await browser.storage.local.set({ notes: state.notes });
    saveStatus.textContent = "Saved";
    setTimeout(() => { saveStatus.textContent = ""; }, 1500);
  }, 600);
}

async function savePrefs() {
  await browser.storage.local.set({
    activeNote: state.activeNote,
    theme: state.theme,
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    toolbarVisible: state.toolbarVisible,
    sidebarVisible: state.sidebarVisible,
  });
}

// ─── Theme & style ────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  themeSelect.value = state.theme;
}

function applyFontSize() {
  document.documentElement.style.setProperty("--font-size", state.fontSize + "px");
}

function applyFontFamily() {
  const ff = (state.fontFamily || "").trim();
  document.documentElement.style.setProperty(
    "--font-family",
    ff ? `"${ff}", system-ui, sans-serif` : "system-ui, sans-serif"
  );
}

function applyToolbarVisibility() {
  toolbar.classList.toggle("hidden", !state.toolbarVisible);
}

// ─── Sidebar rendering ────────────────────────────────────────────────────────
function renderSidebar() {
  notesList.innerHTML = "";
  const names = Object.keys(state.notes).sort((a, b) => {
    const ta = state.notes[a]?.updatedAt ?? 0;
    const tb = state.notes[b]?.updatedAt ?? 0;
    return tb - ta; // most recently updated first
  });

  for (const name of names) {
    const item = document.createElement("div");
    item.className = "note-item" + (name === state.activeNote ? " active" : "");
    item.dataset.name = name;

    const nameSpan = document.createElement("span");
    nameSpan.className = "note-item-name";
    nameSpan.textContent = name;

    const actions = document.createElement("div");
    actions.className = "note-item-actions";

    const renameBtn = document.createElement("button");
    renameBtn.title = "Rename";
    renameBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    renameBtn.addEventListener("click", e => {
      e.stopPropagation();
      openRenameModal(name);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.title = "Delete";
    deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      openDeleteModal(name);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(nameSpan);
    item.appendChild(actions);

    item.addEventListener("click", () => switchNote(name));
    notesList.appendChild(item);
  }

  noteNameStatus.textContent = state.activeNote || "";
  document.title = state.activeNote ? `${state.activeNote} — My Notes` : "My Notes";
}

// ─── Note management ──────────────────────────────────────────────────────────
function loadActiveNote() {
  if (state.activeNote && state.notes[state.activeNote]) {
    editor.innerHTML = state.notes[state.activeNote].content || "";
  } else {
    editor.innerHTML = "";
  }
  // Strip stale wired-flag so listeners get re-attached on this DOM instance
  editor.querySelectorAll("img[data-resize-wired]").forEach(img => delete img.dataset.resizeWired);
  wireImgResizeHandlers();
  updateWordCount();
  closeFindBar();
  removeResizeOverlay();
}

function switchNote(name) {
  // Save current
  if (state.activeNote) {
    state.notes[state.activeNote] = {
      content: editor.innerHTML,
      updatedAt: state.notes[state.activeNote]?.updatedAt ?? Date.now(),
    };
  }
  state.activeNote = name;
  savePrefs();
  renderSidebar();
  loadActiveNote();
}

async function createNote() {
  let base = "New Note";
  let name = base;
  let i = 2;
  while (state.notes[name]) {
    name = base + " " + i++;
  }
  state.notes[name] = { content: "", updatedAt: Date.now() };
  state.activeNote = name;
  dirtySinceExport = true;
  await browser.storage.local.set({ notes: state.notes });
  await savePrefs();
  renderSidebar();
  loadActiveNote();
  editor.focus();
}

// Delete
function openDeleteModal(name) {
  pendingDeleteNote = name;
  $("delete-note-name").textContent = name;
  $("delete-modal").classList.remove("hidden");
}

$("delete-cancel").addEventListener("click", () => {
  $("delete-modal").classList.add("hidden");
  pendingDeleteNote = null;
});

$("delete-confirm").addEventListener("click", async () => {
  if (!pendingDeleteNote) return;
  delete state.notes[pendingDeleteNote];
  if (state.activeNote === pendingDeleteNote) {
    const remaining = Object.keys(state.notes);
    state.activeNote = remaining.length > 0 ? remaining[0] : "";
    if (!state.activeNote) {
      state.notes["Note 1"] = { content: "", updatedAt: Date.now() };
      state.activeNote = "Note 1";
    }
  }
  pendingDeleteNote = null;
  dirtySinceExport = true;
  $("delete-modal").classList.add("hidden");
  await browser.storage.local.set({ notes: state.notes });
  await savePrefs();
  renderSidebar();
  loadActiveNote();
});

// Rename
function openRenameModal(name) {
  pendingRenameNote = name;
  $("rename-input").value = name;
  $("rename-modal").classList.remove("hidden");
  $("rename-input").select();
}

$("rename-cancel").addEventListener("click", () => {
  $("rename-modal").classList.add("hidden");
  pendingRenameNote = null;
});

$("rename-confirm").addEventListener("click", async () => {
  const newName = $("rename-input").value.trim();
  if (!newName || !pendingRenameNote) return;
  if (newName === pendingRenameNote) { $("rename-modal").classList.add("hidden"); return; }
  if (state.notes[newName]) { alert("A note with that name already exists."); return; }

  state.notes[newName] = { ...state.notes[pendingRenameNote] };
  delete state.notes[pendingRenameNote];

  if (state.activeNote === pendingRenameNote) state.activeNote = newName;
  pendingRenameNote = null;
  dirtySinceExport = true;
  $("rename-modal").classList.add("hidden");

  await browser.storage.local.set({ notes: state.notes });
  await savePrefs();
  renderSidebar();
  noteNameStatus.textContent = state.activeNote;
});

$("rename-input").addEventListener("keydown", e => {
  if (e.key === "Enter") $("rename-confirm").click();
  if (e.key === "Escape") $("rename-cancel").click();
});

// ─── Editor events ────────────────────────────────────────────────────────────
editor.addEventListener("input", () => {
  updateWordCount();
  scheduleSave();
});

editor.addEventListener("keydown", e => {
  // Ctrl+F
  if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); openFindBar(); }
  // Tab = indent, Shift+Tab = outdent
  if (e.key === "Tab") {
    e.preventDefault();
    indentSelection(e.shiftKey ? -1 : 1);
  }
});

function updateWordCount() {
  const text = editor.innerText.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;
  wordCount.textContent = `${words} word${words !== 1 ? "s" : ""} · ${chars} chars`;
}

// ─── Toolbar commands ─────────────────────────────────────────────────────────
function cmd(command, value = null) {
  editor.focus();
  document.execCommand(command, false, value);
}

$("btn-bold").addEventListener("click", () => cmd("bold"));
$("btn-italic").addEventListener("click", () => cmd("italic"));
$("btn-underline").addEventListener("click", () => cmd("underline"));
$("btn-strike").addEventListener("click", () => cmd("strikeThrough"));
$("btn-h1").addEventListener("click", () => cmd("formatBlock", "h1"));
$("btn-h2").addEventListener("click", () => cmd("formatBlock", "h2"));
$("btn-h3").addEventListener("click", () => cmd("formatBlock", "h3"));
$("btn-ul").addEventListener("click", () => {
  cmd("insertUnorderedList");
  // Auto-indent the newly created list by 1 level
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    let list = null;
    while (node && node !== editor) {
      if (node.tagName === "UL") { list = node; break; }
      node = node.parentElement;
    }
    if (list && !list.style.marginLeft) {
      list.style.marginLeft = INDENT_PX + "px";
      scheduleSave();
    }
  }
});
$("btn-ol").addEventListener("click", () => {
  cmd("insertOrderedList");
  // Auto-indent the newly created list by 1 level
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    let list = null;
    while (node && node !== editor) {
      if (node.tagName === "OL") { list = node; break; }
      node = node.parentElement;
    }
    if (list && !list.style.marginLeft) {
      list.style.marginLeft = INDENT_PX + "px";
      scheduleSave();
    }
  }
});
// btn-quote (Blockquote) removed

// ─── Remove list formatting from selected items ───────────────────────────────
// Extracts each selected LI from its UL/OL into a plain DIV, preserving content.
function removeListFormatting(listTag) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  // Find the nearest ancestor LI from the selection start
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  let li = null;
  while (node && node !== editor) {
    if (node.tagName === "LI") { li = node; break; }
    node = node.parentElement;
  }
  if (!li) return;

  const list = li.parentElement;
  if (!list || list.tagName !== listTag) return;

  // Collect all LIs touched by the range within this list
  const selectedLIs = Array.from(list.children).filter(
    child => child.tagName === "LI" && range.intersectsNode(child)
  );
  if (!selectedLIs.length) selectedLIs.push(li);

  // Replace each selected LI with a plain DIV, inserted before the list
  for (const item of selectedLIs) {
    const div = document.createElement("div");
    // Move all child nodes of the LI into the div
    while (item.firstChild) div.appendChild(item.firstChild);
    list.parentNode.insertBefore(div, list);
    item.remove();
  }

  // If the list is now empty, remove it too; also clean up empty wrapper divs
  if (!list.querySelector("li")) {
    // Remove empty wrapper if the list was inside a block div
    const wrapper = list.parentElement;
    list.remove();
    if (wrapper && wrapper !== editor && wrapper.tagName === "DIV" &&
        !wrapper.childNodes.length) {
      wrapper.remove();
    }
  }

  scheduleSave();
}

$("btn-unul").addEventListener("click", () => removeListFormatting("UL"));
$("btn-unol").addEventListener("click", () => removeListFormatting("OL"));

$("btn-indent").addEventListener("click", () => indentSelection(1));
$("btn-outdent").addEventListener("click", () => indentSelection(-1));
$("btn-undo").addEventListener("click", () => cmd("undo"));
$("btn-redo").addEventListener("click", () => cmd("redo"));

// btn-code (Inline code) removed

// Highlight
$("btn-highlight").addEventListener("click", () => {
  const sel = window.getSelection();
  if (sel && sel.toString()) {
    cmd("hiliteColor", "#ffe06a");
  }
});

// Font color
fontColorInput.addEventListener("input", () => {
  const color = fontColorInput.value;
  colorPreview.style.background = color;
  const sel = window.getSelection();
  if (sel && sel.toString()) {
    cmd("foreColor", color);
    scheduleSave();
  }
});

fontColorInput.addEventListener("change", () => {
  const color = fontColorInput.value;
  colorPreview.style.background = color;
  editor.focus();
  cmd("foreColor", color);
  scheduleSave();
});

// Link
$("btn-link").addEventListener("click", () => {
  savedSelection = saveSelection();
  const sel = window.getSelection();
  $("link-text-input").value = sel ? sel.toString() : "";
  $("link-url-input").value = "";
  $("link-modal").classList.remove("hidden");
  $("link-url-input").focus();
});

$("link-cancel").addEventListener("click", () => $("link-modal").classList.add("hidden"));
$("link-confirm").addEventListener("click", () => {
  const url = $("link-url-input").value.trim();
  const text = $("link-text-input").value.trim();
  if (!url) return;
  $("link-modal").classList.add("hidden");
  editor.focus();
  restoreSelection(savedSelection);
  if (text) {
    cmd("insertHTML", `<a href="${url}" target="_blank">${text}</a>`);
  } else {
    cmd("createLink", url);
  }
  scheduleSave();
});

$("link-url-input").addEventListener("keydown", e => {
  if (e.key === "Enter") $("link-confirm").click();
  if (e.key === "Escape") $("link-cancel").click();
});

// ─── Image insert ──────────────────────────────────────────────────────────────
function insertImageDataUrl(dataUrl) {
  editor.focus();
  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.maxWidth = "100%";
  // Insert at cursor position
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(img);
  }
  // Wire and show resize handles immediately
  wireImgResizeHandlers();
  attachResizeOverlay(img);
  scheduleSave();
}

$("btn-image").addEventListener("click", () => {
  $("img-file-input").value = "";
  $("img-file-input").click();
});

$("img-file-input").addEventListener("change", () => {
  const file = $("img-file-input").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => insertImageDataUrl(e.target.result);
  reader.readAsDataURL(file);
});

// Drag-and-drop images into the editor
editor.addEventListener("dragover", e => {
  if ([...e.dataTransfer.items].some(i => i.type.startsWith("image/"))) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
});

editor.addEventListener("drop", e => {
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = ev => insertImageDataUrl(ev.target.result);
  reader.readAsDataURL(file);
});

// Paste images from clipboard
editor.addEventListener("paste", e => {
  const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = ev => insertImageDataUrl(ev.target.result);
  reader.readAsDataURL(file);
});

// New note
$("new-note-btn").addEventListener("click", createNote);

// Theme
themeSelect.addEventListener("change", () => {
  state.theme = themeSelect.value;
  applyTheme();
  savePrefs();
});

// Toggle toolbar (both rows)
$("btn-toggle-toolbar").addEventListener("click", () => {
  state.toolbarVisible = !state.toolbarVisible;
  applyToolbarVisibility();
  savePrefs();
});

// ─── Indent / Outdent (works on any block, not just list items) ───────────────
const INDENT_PX = 32;

function indentSelection(dir) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const blocks = getSelectedBlocks(range);

  blocks.forEach(block => {
    const current = parseInt(block.style.marginLeft || "0", 10);
    const next = Math.max(0, current + dir * INDENT_PX);
    block.style.marginLeft = next > 0 ? next + "px" : "";
  });

  scheduleSave();
}

// Returns the specific block elements touched by the selection.
// If the selection is inside a list (UL/OL), returns only the individual LI
// elements that the range touches — even when the list is nested inside another
// block (e.g. a DIV created by execCommand). For plain blocks the block itself
// is returned.
function getSelectedBlocks(range) {
  const BLOCK_TAGS = new Set(["P","DIV","H1","H2","H3","H4","H5","H6",
    "BLOCKQUOTE","PRE","SECTION","ARTICLE","HEADER","FOOTER"]);

  // First check: is the selection entirely within a list item?
  // Walk up from startContainer to find the nearest LI ancestor inside the editor.
  function nearestLI(node) {
    while (node && node !== editor) {
      if (node.tagName === "LI") return node;
      node = node.parentElement;
    }
    return null;
  }

  const startLI = nearestLI(
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer
  );

  if (startLI) {
    // Selection starts inside a list. Collect all LIs in the same list that
    // the range touches (handles multi-item selection too).
    const parentList = startLI.parentElement; // UL or OL
    const touched = Array.from(parentList.children).filter(
      li => li.tagName === "LI" && range.intersectsNode(li)
    );
    return touched.length ? touched : [startLI];
  }

  // Selection is not in a list — collect direct-editor-child blocks that intersect.
  const blocks = [];
  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (!range.intersectsNode(child)) continue;
    // If this block contains a list, drill into it and collect LIs
    const lists = child.querySelectorAll("ul, ol");
    if (lists.length) {
      let foundLI = false;
      for (const list of lists) {
        for (const li of Array.from(list.children)) {
          if (li.tagName === "LI" && range.intersectsNode(li)) {
            blocks.push(li);
            foundLI = true;
          }
        }
      }
      if (foundLI) continue; // don't also push the wrapper block
    }
    if (BLOCK_TAGS.has(child.tagName)) {
      blocks.push(child);
    }
  }

  // Fallback: selection is in a non-block direct child (e.g. a span or text node)
  if (blocks.length === 0) {
    let el = range.startContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el && el.parentElement !== editor) el = el.parentElement;
    if (el && el !== editor) blocks.push(el);
  }

  return blocks;
}

// ─── Font family / size — apply to SELECTION only via execCommand ─────────────
// execCommand("fontName") and ("fontSize") apply inline spans to the selection.
// The CSS variable approach (applyFontFamily/applyFontSize) only sets the
// editor default for new text; it does NOT re-style existing content.

// ─── Update font picker to reflect selected text's font ───────────────────────
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    // No selection: restore picker to global default
    fontFamilySelect.value = state.fontFamily || "";
    return;
  }
  // Check that selection is inside the editor
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }
  // Get the element at the start of the selection to read its computed font
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const computedFont = window.getComputedStyle(node).fontFamily;
  // Try to match against one of the select option values (case-insensitive)
  const options = Array.from(fontFamilySelect.options);
  let matched = "";
  for (const opt of options) {
    if (!opt.value) continue; // skip "System Default"
    // computedFont may be quoted, e.g. '"Times New Roman"' or 'Arial'
    const normalized = computedFont.replace(/['"]/g, "").toLowerCase();
    if (normalized.startsWith(opt.value.toLowerCase())) {
      matched = opt.value;
      break;
    }
  }
  fontFamilySelect.value = matched;
});

fontFamilySelect.addEventListener("change", () => {
  const ff = fontFamilySelect.value;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    // Selection exists: apply only to selected text, do NOT change global default.
    // Save the range before editor.focus() — focusing can reset/lose the selection.
    const savedRange = saveSelection();
    editor.focus();
    restoreSelection(savedRange);
    applyFontToSelection("fontFamily", ff || "system-ui, sans-serif");
    scheduleSave();
  } else {
    // No selection: change the global editor default for future typing
    state.fontFamily = ff;
    applyFontFamily();
    savePrefs();
  }
});

fontSizeSelect.addEventListener("change", () => {
  const v = parseInt(fontSizeSelect.value, 10);
  if (isNaN(v)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    // Selection exists: apply only to selected text, do NOT change global default.
    // Save the range before editor.focus() — focusing can reset/lose the selection.
    const savedRange = saveSelection();
    editor.focus();
    restoreSelection(savedRange);
    applyFontToSelection("fontSize", v + "px");
    scheduleSave();
    // Reset selector to the current global default
    fontSizeSelect.value = String(state.fontSize);
  } else {
    // No selection: change the global editor default for future typing
    state.fontSize = v;
    applyFontSize();
    savePrefs();
  }
});

// Apply a CSS font property to the current selection by wrapping in a <span>
function applyFontToSelection(prop, value) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  // Split boundary text nodes first so the range covers only whole text nodes.
  // startContainer: split off the unselected left part, then the selected portion
  // becomes a new sibling — update range.startContainer to point at it.
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
    const after = range.startContainer.splitText(range.startOffset);
    range.setStart(after, 0);
  }
  // endContainer: split off the unselected right part at endOffset.
  if (range.endContainer.nodeType === Node.TEXT_NODE &&
      range.endOffset < range.endContainer.length) {
    range.endContainer.splitText(range.endOffset);
    range.setEnd(range.endContainer, range.endContainer.length);
  }

  // Now collect every text node fully inside the (trimmed) range.
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;

  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (range.intersectsNode(n)) textNodes.push(n);
  }

  // For each text node, find or create a plain carrier span and apply the style.
  // Also strip the same property from any descendant spans so they don't override.
  for (const tn of textNodes) {
    let carrier = tn.parentElement;
    if (!carrier || carrier === editor ||
        carrier.tagName !== 'SPAN' || carrier.className) {
      const wrapper = document.createElement('span');
      tn.parentNode.insertBefore(wrapper, tn);
      wrapper.appendChild(tn);
      carrier = wrapper;
    }
    carrier.style[prop] = value;
    carrier.querySelectorAll('span').forEach(s => {
      s.style[prop] = '';
      if (!s.getAttribute('style')) s.removeAttribute('style');
    });
  }

  // Restore selection so the font picker updates and the highlight stays visible.
  try {
    sel.removeAllRanges();
    sel.addRange(range);
  } catch(e) { /* range endpoints are still valid after splitting */ }

  scheduleSave();
}

// ─── Image resize (drag handles) ─────────────────────────────────────────────
let activeResizeImg = null;
let resizeOverlay = null;

// Inject overlay CSS once
(function injectResizeStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .img-resize-overlay {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid var(--accent);
      pointer-events: none;
      z-index: 50;
    }
    .img-resize-handle {
      position: absolute;
      width: 10px;
      height: 10px;
      background: var(--accent);
      border: 1px solid white;
      border-radius: 2px;
      pointer-events: all;
      cursor: nwse-resize;
      z-index: 51;
    }
    .img-resize-handle[data-pos="nw"] { top:-5px; left:-5px; cursor:nwse-resize; }
    .img-resize-handle[data-pos="ne"] { top:-5px; right:-5px; cursor:nesw-resize; }
    .img-resize-handle[data-pos="sw"] { bottom:-5px; left:-5px; cursor:nesw-resize; }
    .img-resize-handle[data-pos="se"] { bottom:-5px; right:-5px; cursor:nwse-resize; }
    .img-resize-handle[data-pos="n"]  { top:-5px; left:calc(50% - 5px); cursor:ns-resize; }
    .img-resize-handle[data-pos="s"]  { bottom:-5px; left:calc(50% - 5px); cursor:ns-resize; }
    .img-resize-handle[data-pos="w"]  { top:calc(50% - 5px); left:-5px; cursor:ew-resize; }
    .img-resize-handle[data-pos="e"]  { top:calc(50% - 5px); right:-5px; cursor:ew-resize; }
    #editor img { cursor: pointer; max-width: 100%; }
    #editor img.img-selected { outline: 2px solid var(--accent); }
  `;
  document.head.appendChild(style);
})();

// Make the editor wrapper the positioning parent
editor.parentElement.style.position = "relative";

function positionOverlay(img) {
  if (!resizeOverlay || !img) return;
  const editorRect = editor.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  resizeOverlay.style.left   = (imgRect.left - editorRect.left + editor.scrollLeft) + "px";
  resizeOverlay.style.top    = (imgRect.top  - editorRect.top  + editor.scrollTop)  + "px";
  resizeOverlay.style.width  = imgRect.width  + "px";
  resizeOverlay.style.height = imgRect.height + "px";
}

function attachResizeOverlay(img) {
  removeResizeOverlay();

  // Mark image selected
  editor.querySelectorAll("img.img-selected").forEach(i => i.classList.remove("img-selected"));
  img.classList.add("img-selected");
  activeResizeImg = img;

  // Build overlay
  resizeOverlay = document.createElement("div");
  resizeOverlay.className = "img-resize-overlay";

  ["nw","n","ne","w","e","sw","s","se"].forEach(pos => {
    const handle = document.createElement("div");
    handle.className = "img-resize-handle";
    handle.dataset.pos = pos;
    handle.addEventListener("mousedown", onResizeStart);
    resizeOverlay.appendChild(handle);
  });

  // Append to editor-wrap so it scrolls with the editor
  editor.parentElement.appendChild(resizeOverlay);
  positionOverlay(img);
}

function removeResizeOverlay() {
  if (resizeOverlay) { resizeOverlay.remove(); resizeOverlay = null; }
  if (activeResizeImg) { activeResizeImg.classList.remove("img-selected"); activeResizeImg = null; }
}

// Resize drag state
let resizeDrag = null;

function onResizeStart(e) {
  e.preventDefault();
  e.stopPropagation();
  const img = activeResizeImg;
  if (!img) return;
  const pos = e.currentTarget.dataset.pos;
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = img.offsetWidth;
  const startH = img.offsetHeight;
  const aspectRatio = startW / startH;

  resizeDrag = { pos, startX, startY, startW, startH, aspectRatio, img };

  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup",   onResizeEnd);
}

function onResizeMove(e) {
  if (!resizeDrag) return;
  const { pos, startX, startY, startW, startH, aspectRatio, img } = resizeDrag;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  let newW = startW;
  let newH = startH;

  // Determine resize direction
  if (pos.includes("e")) newW = Math.max(20, startW + dx);
  if (pos.includes("w")) newW = Math.max(20, startW - dx);
  if (pos.includes("s")) newH = Math.max(20, startH + dy);
  if (pos.includes("n")) newH = Math.max(20, startH - dy);

  // For corner handles, maintain aspect ratio
  if (pos.length === 2) {
    if (Math.abs(dx) > Math.abs(dy)) {
      newH = Math.round(newW / aspectRatio);
    } else {
      newW = Math.round(newH * aspectRatio);
    }
  }

  img.style.width  = newW + "px";
  img.style.height = newH + "px";
  positionOverlay(img);
}

function onResizeEnd() {
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup",   onResizeEnd);
  resizeDrag = null;
  if (activeResizeImg) positionOverlay(activeResizeImg);
  scheduleSave();
}

// Directly wire resize-on-click to every <img> inside the editor.
// Called on note load (for pre-existing images) and after any insert.
// Uses a data attribute to avoid attaching duplicate listeners.
function wireImgResizeHandlers() {
  editor.querySelectorAll("img:not([data-resize-wired])").forEach(img => {
    img.dataset.resizeWired = "1";
    img.style.cursor = "pointer";
    if (!img.style.maxWidth) img.style.maxWidth = "100%";
    img.addEventListener("click", e => {
      e.stopPropagation();
      attachResizeOverlay(img);
    });
  });
}

// Fallback delegation — catches any image that somehow missed wireImgResizeHandlers,
// and removes the overlay when clicking anywhere else in the editor.
editor.addEventListener("click", e => {
  if (e.target.tagName === "IMG") {
    attachResizeOverlay(e.target);
  } else {
    removeResizeOverlay();
  }
});

// Re-position overlay on editor scroll
editor.addEventListener("scroll", () => {
  if (activeResizeImg) positionOverlay(activeResizeImg);
});

// Remove overlay when note changes
function removeResizeOverlayOnSwitch() { removeResizeOverlay(); }

// ─── Find ─────────────────────────────────────────────────────────────────────
$("btn-find").addEventListener("click", openFindBar);
$("find-close").addEventListener("click", closeFindBar);
$("find-prev").addEventListener("click", () => navigateFind(-1));
$("find-next").addEventListener("click", () => navigateFind(1));

findInput.addEventListener("input", runFind);
findInput.addEventListener("keydown", e => {
  if (e.key === "Enter") navigateFind(e.shiftKey ? -1 : 1);
  if (e.key === "Escape") closeFindBar();
});

function openFindBar() {
  findBar.classList.add("visible");
  findInput.value = "";
  findInput.focus();
  findMatches = [];
  findIndex = 0;
  findCount.textContent = "";
}

function closeFindBar() {
  findBar.classList.remove("visible");
  clearHighlights();
}

function clearHighlights() {
  const marks = editor.querySelectorAll("mark[data-find]");
  marks.forEach(m => {
    const text = document.createTextNode(m.textContent);
    m.replaceWith(text);
  });
  editor.normalize();
}

function runFind() {
  clearHighlights();
  const query = findInput.value.trim();
  if (!query) { findCount.textContent = ""; findMatches = []; return; }

  const re = new RegExp(escapeRe(query), "gi");
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  let count = 0;
  for (const tn of textNodes) {
    const text = tn.nodeValue;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.setAttribute("data-find", "1");
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = re.lastIndex;
      count++;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    tn.replaceWith(frag);
  }

  findMatches = Array.from(editor.querySelectorAll("mark[data-find]"));
  findIndex = 0;
  findCount.textContent = count > 0 ? `1 / ${count}` : "No results";
  if (findMatches.length > 0) highlightCurrent();
}

function navigateFind(dir) {
  if (!findMatches.length) return;
  findMatches[findIndex].style.outline = "";
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  findCount.textContent = `${findIndex + 1} / ${findMatches.length}`;
  highlightCurrent();
}

function highlightCurrent() {
  const el = findMatches[findIndex];
  el.style.outline = "2px solid var(--accent)";
  el.scrollIntoView({ block: "nearest" });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Export / Import ──────────────────────────────────────────────────────────
$("btn-export").addEventListener("click", () => {
  exportPanel.classList.toggle("visible");
});

$("exp-close").addEventListener("click", () => exportPanel.classList.remove("visible"));

// Sync the currently-open note's live editor content back into state.notes
// so any "export all" action reflects unsaved edits in the open note too.
function syncActiveNoteIntoState() {
  if (state.activeNote) {
    state.notes[state.activeNote] = {
      content: editor.innerHTML,
      updatedAt: state.notes[state.activeNote]?.updatedAt ?? Date.now(),
    };
  }
}

// Downloads every note as its own standalone .html file.
async function downloadAllNotesAsHtml() {
  syncActiveNoteIntoState();
  const names = Object.keys(state.notes);
  if (!names.length) { alert("There are no notes to export."); return; }
  for (const name of names) {
    const note = state.notes[name];
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(name)}</title></head><body>${note?.content || ""}</body></html>`;
    download(sanitizeFileName(name) + ".html", html, "text/html");
    // Small stagger so the browser doesn't block/collapse near-simultaneous downloads
    await new Promise(r => setTimeout(r, 150));
  }
  dirtySinceExport = false;
}

function downloadAllNotesAsJson() {
  syncActiveNoteIntoState();
  download("my-notes-backup.json", JSON.stringify(state.notes, null, 2), "application/json");
  dirtySinceExport = false;
}

function sanitizeFileName(name) {
  return (name || "Untitled").replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("exp-download-html").addEventListener("click", () => {
  downloadAllNotesAsHtml();
});

$("exp-export-json").addEventListener("click", () => {
  downloadAllNotesAsJson();
});

// ─── Import backup JSON: pick a file, review, then import ────────────────────
const importFileInput = $("import-json-file-input");
const importSummary = $("import-summary");
const importConfirmBtn = $("import-confirm");
let pendingImportData = null;

$("exp-import-json").addEventListener("click", () => {
  pendingImportData = null;
  importSummary.textContent = "Select a backup JSON file exported from My Notes.";
  importConfirmBtn.disabled = true;
  importFileInput.value = "";
  importFileInput.click();
});

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files && importFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (typeof data !== "object" || Array.isArray(data) || data === null) throw new Error("Invalid format");
      pendingImportData = data;
      const count = Object.keys(data).length;
      importSummary.textContent = `"${file.name}" — ${count} note${count !== 1 ? "s" : ""} found. Click Import to continue.`;
      importConfirmBtn.disabled = false;
    } catch (e) {
      pendingImportData = null;
      importSummary.textContent = `Couldn't read "${file.name}": ${e.message}`;
      importConfirmBtn.disabled = true;
    }
    $("import-modal").classList.remove("hidden");
  };
  reader.onerror = () => {
    pendingImportData = null;
    importSummary.textContent = "Failed to read the selected file.";
    importConfirmBtn.disabled = true;
    $("import-modal").classList.remove("hidden");
  };
  reader.readAsText(file);
});

$("import-cancel").addEventListener("click", () => $("import-modal").classList.add("hidden"));
$("import-confirm").addEventListener("click", async () => {
  if (!pendingImportData) return;
  try {
    for (const [name, note] of Object.entries(pendingImportData)) {
      let key = name;
      let i = 2;
      while (state.notes[key] && key !== name) key = name + " " + i++;
      state.notes[key] = note;
    }
    await browser.storage.local.set({ notes: state.notes });
    $("import-modal").classList.add("hidden");
    pendingImportData = null;
    dirtySinceExport = true;
    renderSidebar();
    alert("Import successful!");
  } catch (e) {
    alert("Import failed: " + e.message);
  }
});

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function flash(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ─── Selection helpers ────────────────────────────────────────────────────────
function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) return sel.getRangeAt(0).cloneRange();
  return null;
}

function restoreSelection(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "n") { e.preventDefault(); createNote(); }
  if (mod && e.key === "z") { /* handled natively */ }
  if (mod && (e.key === "y" || (e.shiftKey && e.key === "z"))) { /* handled natively */ }
  if (e.key === "Escape") {
    $("delete-modal").classList.add("hidden");
    $("rename-modal").classList.add("hidden");
    $("link-modal").classList.add("hidden");
    $("import-modal").classList.add("hidden");
    $("auth-modal").classList.add("hidden");
    $("close-save-modal").classList.add("hidden");
  }
});

// ─── Google Drive sync ────────────────────────────────────────────────────────
const syncStatus = $("sync-status");

$("btn-sync-now").addEventListener("click", async () => {
  const btn = $("btn-sync-now");
  const cfg = await GDRIVE.getConfig();

  if (!cfg.ls_subfolder) {
    openSaveFolderModal();
    return;
  }

  btn.textContent = "⟳";
  btn.style.animation = "spin 1s linear infinite";
  syncStatus.textContent = "Saving…";

  try {
    const count = await GDRIVE.saveAllNow(state.notes);
    syncStatus.textContent = `💾 Saved ${count} — ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    syncStatus.textContent = "⚠ Save failed";
    console.error("Save error:", e);
  } finally {
    btn.textContent = "💾";
    btn.style.animation = "";
  }
});

// ─── Save Folder Modal ────────────────────────────────────────────────────────
function openSaveFolderModal() {
  $("auth-error").style.display = "none";
  GDRIVE.getConfig().then(cfg => {
    if (cfg.ls_subfolder) $("auth-subfolder").value = cfg.ls_subfolder;
  });
  $("auth-modal").classList.remove("hidden");
  setTimeout(() => $("auth-subfolder").focus(), 50);
}

$("auth-cancel").addEventListener("click", () => {
  $("auth-modal").classList.add("hidden");
});

$("btn-auth-save-path").addEventListener("click", async () => {
  const raw   = $("auth-subfolder").value.trim();
  const errEl = $("auth-error");
  const btn   = $("btn-auth-save-path");
  if (!raw) { errEl.textContent = "Please enter a subfolder name."; errEl.style.display = "block"; return; }

  btn.disabled = true;
  btn.textContent = "Saving…";
  errEl.style.display = "none";

  try {
    await GDRIVE.setSubfolder(raw);
    $("auth-modal").classList.add("hidden");
    syncStatus.textContent = `📁 ${raw}`;
    $("btn-sync-now").click();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 Save & Sync";
  }
});

browser.runtime.onMessage.addListener((msg) => { void msg; });

// Auto-save on open if subfolder is set and auto-save enabled
(async () => {
  const { ls_auto_sync } = await browser.storage.local.get("ls_auto_sync");
  const cfg = await GDRIVE.getConfig();
  if (ls_auto_sync && cfg.ls_subfolder) $("btn-sync-now").click();
})();

// ─── Close Notepad: ask to save notes first ──────────────────────────────────
async function closeThisTab() {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab && tab.id != null) {
      await browser.tabs.remove(tab.id);
      return;
    }
  } catch (e) {
    console.error("Could not close tab:", e);
  }
  window.close();
}

$("btn-close-notepad").addEventListener("click", () => {
  $("close-save-modal").classList.remove("hidden");
});

$("close-cancel").addEventListener("click", () => {
  $("close-save-modal").classList.add("hidden");
});

$("close-no-save").addEventListener("click", () => {
  $("close-save-modal").classList.add("hidden");
  closeThisTab();
});

$("close-save-json").addEventListener("click", () => {
  $("close-save-modal").classList.add("hidden");
  downloadAllNotesAsJson();
  setTimeout(closeThisTab, 400);
});

$("close-save-html").addEventListener("click", async () => {
  $("close-save-modal").classList.add("hidden");
  await downloadAllNotesAsHtml();
  closeThisTab();
});

// ─── Silent background auto-backup (real fix for the tab/app-close case) ─────
// The previous approach — triggering an <a download> click inside
// beforeunload — silently did nothing in practice: browsers cancel any
// download started that way as part of their unload-abuse prevention.
// A second attempt used browser.downloads.download() with a data: URL on a
// 60s timer, which you reported also isn't producing a file. Two likely
// causes for that: (1) data: URLs are the less-reliable of the two download
// sources browsers accept — Blob URLs (what the working "Download .html" /
// "Export JSON" buttons already use successfully) are the safer choice; and
// (2) with zero visible feedback, a silent failure and "not running at all"
// looked identical from the outside, which is exactly what made this hard to
// diagnose. Fixing both below: switched to a Blob URL, and added a status
// line so success/failure is visible in the app itself, not just devtools.
const autobackupStatus = $("autobackup-status");
const AUTO_BACKUP_INTERVAL_MS = 60 * 1000;
let autoBackupInFlight = false;

// Saved into a "Note Backup" subfolder under Thunderbird's default download
// directory — a WebExtension has no permission to write to arbitrary system
// folders (e.g. the real ~/Documents) directly, only inside the configured
// download directory (optionally in a subfolder of it).

const AUTO_BACKUP_SUBFOLDER = "Note Backup";
const AUTO_BACKUP_FILENAME = `${AUTO_BACKUP_SUBFOLDER}/my-notes-autobackup.json`;

async function silentAutoBackup() {
  if (autoBackupInFlight) return;
  if (!dirtySinceExport) {
    autobackupStatus.textContent = `Auto-backup: no changes (${new Date().toLocaleTimeString()})`;
    return;
  }
  autoBackupInFlight = true;
  autobackupStatus.textContent = "Auto-backing up…";
  syncActiveNoteIntoState();
  const json = JSON.stringify(state.notes, null, 2);
  let blobUrl = null;
  try {
    if (browser.downloads && browser.downloads.download) {
      blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const downloadId = await browser.downloads.download({
        url: blobUrl,
        filename: AUTO_BACKUP_FILENAME,
        conflictAction: "overwrite",
        saveAs: false,
      });
      console.log("Auto-backup succeeded via downloads API, downloadId:", downloadId);
    } else {
      throw new Error("browser.downloads.download unavailable");
    }
    dirtySinceExport = false;
    autobackupStatus.textContent = `Auto-backup saved ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error("downloads.download auto-backup failed, falling back to link download:", e);
    // Fallback: the same link-click mechanism the manual "Export JSON" button
    // already uses successfully. The restriction that broke this technique
    // earlier only applies inside beforeunload — this timer-driven call runs
    // while the tab is fully alive, so it isn't subject to that restriction.
    // Firefox/Thunderbird also honour a "subfolder/file.ext" path in the
    // <a download> attribute, creating the subfolder under the download dir.
    try {
      download(AUTO_BACKUP_FILENAME, json, "application/json");
      dirtySinceExport = false;
      autobackupStatus.textContent = `Auto-backup saved (fallback) ${new Date().toLocaleTimeString()}`;
    } catch (e2) {
      autobackupStatus.textContent = `Auto-backup failed: ${e2.message || e2}`;
      console.error("Fallback auto-backup also failed:", e2);
    }
  } finally {
    autoBackupInFlight = false;
    // Revoke well after the download has had time to start reading the blob
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  }
}

setInterval(silentAutoBackup, AUTO_BACKUP_INTERVAL_MS);

// Best-effort extra attempt as soon as the tab is backgrounded or about to
// close — this fires earlier and separately from beforeunload/unload, so
// unlike the old approach it has a real chance of completing, though the
// periodic interval above is what actually guarantees a fresh-enough backup.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") silentAutoBackup();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
