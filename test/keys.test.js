const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " is missing");
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      seen = true;
    } else if (ch === "}") {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + " is unclosed");
}

const duelShortcut = new Function(extractFunction(app, "duelShortcut") + "\nreturn duelShortcut;")();

describe("duel shortcut map", () => {
  it("undoes with Z, including Ctrl or Cmd, and not with Backspace", () => {
    assert.equal(duelShortcut({ key: "z" }), "undo");
    assert.equal(duelShortcut({ key: "Z" }), "undo");
    assert.equal(duelShortcut({ key: "z", ctrlKey: true }), "undo");
    assert.equal(duelShortcut({ key: "z", metaKey: true }), "undo");
    assert.equal(duelShortcut({ key: "Z", ctrlKey: true }), "undo");
    assert.equal(duelShortcut({ key: "z", shiftKey: true }), null);
    assert.equal(duelShortcut({ key: "z", altKey: true }), null);
    assert.equal(duelShortcut({ key: "z", ctrlKey: true, shiftKey: true }), null);
    assert.equal(duelShortcut({ key: "Backspace" }), null);
    assert.equal(duelShortcut({ key: "t" }), null);
    assert.equal(duelShortcut({ key: "s" }), null);
  });

  it("keeps the arrow keys for pick, tie, and skip", () => {
    assert.equal(duelShortcut({ key: "ArrowLeft" }), "a");
    assert.equal(duelShortcut({ key: "ArrowRight" }), "b");
    assert.equal(duelShortcut({ key: "ArrowDown" }), "tie");
    assert.equal(duelShortcut({ key: "ArrowUp" }), "skip");
  });

  it("wires Z in the page and leaves Backspace out of the handler", () => {
    const handler = app.slice(
      app.indexOf('window.addEventListener("keydown"'),
      app.indexOf('els.stage.addEventListener("pointerdown"'),
    );
    assert.match(handler, /duelShortcut\(event\)/);
    assert.equal(handler.includes("Backspace"), false);
    assert.equal(app.includes("Backspace"), false);
    assert.match(handler, /tag === "INPUT"/);
    assert.match(handler, /speciesPanel/);
    assert.match(handler, /dataPanel\.hidden === false/);
    assert.match(handler, /els\.modal\.hidden === false/);
    assert.match(html, /id="undo"[^>]*>Undo <kbd>Z<\/kbd>/);
    assert.equal(html.includes("⌫"), false);
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert.match(readme, /`Z`, `Ctrl\+Z`, or `Cmd\+Z`/);
    assert.equal(readme.includes("Backspace"), false);
  });
});
