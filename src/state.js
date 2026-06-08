// Shared runtime state — avoids circular deps between main.js and tools/system.js.
// All fields are mutated in-place; never reassign the module.exports object itself.
module.exports = {
  recluseWindow:  null, // BrowserWindow
  currentDisplay: null, // Electron Display object
  overlayWindows: [],   // { hint: string, bounds: { x, y, width, height } }
};
