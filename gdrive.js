// localSync.js (loaded as gdrive.js for compatibility)
// Saves notes as .md files using browser.downloads API.
//
// HOW IT WORKS:
//   browser.downloads.download() accepts a RELATIVE filename only.
//   Files are saved under the browser's default download directory.
//   The user sets a subfolder name (e.g. "MyNotes") and files land at:
//     Linux:   ~/Downloads/MyNotes/NoteName.md
//     Windows: C:\Users\user\Downloads\MyNotes\NoteName.md
//   The user can change their default download folder in Thunderbird preferences.
//
// RESTORE: Via <input type="file"> — works everywhere, no API quirks.

"use strict";

const GDRIVE = (() => {

  // ── Config ────────────────────────────────────────────────────────────────
  async function getConfig() {
    return browser.storage.local.get(["ls_subfolder", "ls_auto_sync", "ls_last_sync"]);
  }

  async function setSubfolder(name) {
    // Strip leading slashes/backslashes, sanitise
    name = name.trim().replace(/^[/\\]+/, "").replace(/[<>:"|?*\x00-\x1F]/g, "_");
    if (!name) throw new Error("Please enter a folder name.");
    await browser.storage.local.set({ ls_subfolder: name });
    return name;
  }

  // ── Safe filename ─────────────────────────────────────────────────────────
  function safeFilename(noteName) {
    return noteName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 180);
  }

  // ── HTML → Markdown ───────────────────────────────────────────────────────
  function htmlToMarkdown(html) {
    if (!html || !html.trim()) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return nodeToMd(tmp).trim();
  }

  function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag   = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(nodeToMd).join("");

    switch (tag) {
      case "h1": return `# ${inner()}\n\n`;
      case "h2": return `## ${inner()}\n\n`;
      case "h3": return `### ${inner()}\n\n`;
      case "h4": return `#### ${inner()}\n\n`;
      case "h5": return `##### ${inner()}\n\n`;
      case "h6": return `###### ${inner()}\n\n`;
      case "p":  { const t = inner().trim(); return t ? t + "\n\n" : ""; }
      case "br": return "\n";
      case "strong": case "b": return `**${inner()}**`;
      case "em":     case "i": return `*${inner()}*`;
      case "u":               return `<u>${inner()}</u>`;
      case "s": case "strike": case "del": return `~~${inner()}~~`;
      case "code": return `\`${inner()}\``;
      case "pre":  return `\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
      case "blockquote": return inner().split("\n").map(l => `> ${l}`).join("\n") + "\n\n";
      case "hr": return `---\n\n`;
      case "a":  { const href = node.getAttribute("href") || ""; return `[${inner()}](${href})`; }
      case "img":{ const src = node.getAttribute("src") || ""; const alt = node.getAttribute("alt") || ""; return `![${alt}](${src})`; }
      case "ul": {
        return Array.from(node.children).filter(c => c.tagName === "LI")
          .map(li => `- ${Array.from(li.childNodes).map(nodeToMd).join("").trim()}`)
          .join("\n") + "\n\n";
      }
      case "ol": {
        return Array.from(node.children).filter(c => c.tagName === "LI")
          .map((li, i) => `${i + 1}. ${Array.from(li.childNodes).map(nodeToMd).join("").trim()}`)
          .join("\n") + "\n\n";
      }
      case "li": return "";
      case "table": {
        const rows = [...node.querySelectorAll("tr")];
        if (!rows.length) return "";
        const mdRows = rows.map(r =>
          "| " + [...r.querySelectorAll("th,td")].map(c => c.textContent.trim().replace(/\|/g,"\\|")).join(" | ") + " |"
        );
        if (rows[0].querySelectorAll("th").length) {
          const cols = rows[0].querySelectorAll("th,td").length;
          mdRows.splice(1, 0, "|" + " --- |".repeat(cols));
        }
        return mdRows.join("\n") + "\n\n";
      }
      default: return inner();
    }
  }

  // ── Markdown → HTML (for restore into editor) ─────────────────────────────
  function mdToHtml(md) {
    if (!md || !md.trim()) return "";
    let h = md
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/^###### (.+)$/gm,"<h6>$1</h6>")
      .replace(/^##### (.+)$/gm,"<h5>$1</h5>")
      .replace(/^#### (.+)$/gm,"<h4>$1</h4>")
      .replace(/^### (.+)$/gm,"<h3>$1</h3>")
      .replace(/^## (.+)$/gm,"<h2>$1</h2>")
      .replace(/^# (.+)$/gm,"<h1>$1</h1>")
      .replace(/^---+$/gm,"<hr/>")
      .replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
      .replace(/\*(.+?)\*/g,"<em>$1</em>")
      .replace(/~~(.+?)~~/g,"<del>$1</del>")
      .replace(/`([^`\n]+)`/g,"<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>')
      .replace(/^[*\-] (.+)$/gm,"<li>$1</li>")
      .replace(/^\d+\. (.+)$/gm,"<li>$1</li>")
      .replace(/^&gt; (.+)$/gm,"<blockquote>$1</blockquote>")
      .replace(/(<li>[\s\S]*?<\/li>)+/g, m => `<ul>${m}</ul>`)
      .split(/\n\n+/).map(p => {
        p = p.trim();
        if (!p) return "";
        if (/^<(h[1-6]|hr|ul|ol|blockquote|pre)/.test(p)) return p;
        return `<p>${p.replace(/\n/g,"<br/>")}</p>`;
      }).join("\n");
    return h;
  }

  // ── Write one note via downloads API ──────────────────────────────────────
  async function downloadNote(subfolder, noteName, htmlContent) {
    const md       = htmlToMarkdown(htmlContent);
    const filename = (subfolder ? subfolder + "/" : "") + safeFilename(noteName) + ".md";

    // Encode content as data URL
    const dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);

    const dlId = await browser.downloads.download({
      url:            dataUrl,
      filename:       filename,
      conflictAction: "overwrite",
      saveAs:         false,
    });

    // Wait for completion (max 30s)
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      function poll() {
        browser.downloads.search({ id: dlId }).then(([dl]) => {
          if (!dl)                    return reject(new Error("Download lost"));
          if (dl.state === "complete") return resolve();
          if (dl.state === "interrupted") return reject(new Error(dl.error || "Download failed"));
          if (Date.now() > deadline)   return reject(new Error("Timed out"));
          setTimeout(poll, 400);
        });
      }
      poll();
    });
  }

  // ── Public: save all notes ────────────────────────────────────────────────
  async function saveAllNow(localNotes) {
    const cfg = await getConfig();
    const subfolder = cfg.ls_subfolder || "Rashid-Notepad";
    const names = Object.keys(localNotes);
    let saved = 0;
    for (const name of names) {
      await downloadNote(subfolder, name, localNotes[name].content || "");
      saved++;
    }
    await browser.storage.local.set({ ls_last_sync: Date.now() });
    return saved;
  }

  // ── Public: restore from md files ────────────────────────────────────────
  async function restoreFromMd(mdFiles) {
    const { notes: existing } = await browser.storage.local.get("notes");
    const notes    = { ...(existing || {}) };
    const imported = [];
    for (const { name, content } of mdFiles) {
      const noteName = name.replace(/\.md$/i, "").trim() || "Restored Note";
      notes[noteName] = { content: mdToHtml(content), updatedAt: Date.now() };
      imported.push(noteName);
    }
    await browser.storage.local.set({ notes });
    return imported;
  }

  async function getLastSync() {
    const r = await browser.storage.local.get("ls_last_sync");
    return r.ls_last_sync || null;
  }

  async function disconnect() {
    await browser.storage.local.remove(["ls_subfolder", "ls_last_sync"]);
  }

  return { getConfig, setSubfolder, saveAllNow, restoreFromMd, getLastSync, disconnect, htmlToMarkdown };

})();
