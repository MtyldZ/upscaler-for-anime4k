// Relay shortcuts to every frame of the tab (players often live in iframes).
chrome.commands.onCommand.addListener((cmd, tab) => chrome.tabs.sendMessage(tab.id, cmd).catch(() => {}));

// Inject the 3.4 MB library only into the frame that asks for it, not into every page.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg !== 'load') return;
  chrome.scripting
    .executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, files: ['anime4k-webgpu.js'] })
    .then(() => reply(true), (e) => reply(String(e)));
  return true;
});
