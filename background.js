// Rashid-Thunderbird-Notepad — Background Script
"use strict";

const NOTES_PAGE = browser.runtime.getURL("panel/panel.html");

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await browser.storage.local.set({
      notes: { "Note 1": { content: "", updatedAt: Date.now() } },
      activeNote: "Note 1", theme: "light", fontSize: 15,
      fontFamily: "", toolbarVisible: true, sidebarVisible: true,
    });
  }
});

browser.browserAction.onClicked.addListener(async () => {
  const existing = await browser.tabs.query({ url: NOTES_PAGE });
  if (existing.length > 0) await browser.tabs.update(existing[0].id, { active: true });
  else await browser.tabs.create({ url: NOTES_PAGE });
});
