const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../pip.js'), 'utf8');

function fixture() {
  const elements = [], timers = new Map(), warnings = [];
  let counter = 0;
  const document = { pictureInPictureEnabled: true, pictureInPictureElement: null,
    querySelectorAll: () => elements.filter(v => v.isConnected) };
  const context = vm.createContext({ document,
    setInterval: fn => { timers.set(++counter, fn); return counter; },
    clearInterval: id => timers.delete(id), console: { warn: (...args) => warnings.push(args) } });
  vm.runInContext(source, context);
  function video() {
    const events = new EventTarget();
    const attributes = new Map();
    const v = { localName: 'video', readyState: 4, videoWidth: 640,
      isConnected: true, ended: false, paused: false, calls: 0, area: 360,
      getBoundingClientRect: () => ({ width: 640, height: v.area }),
      getRootNode: () => document,
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
      addEventListener: (...args) => events.addEventListener(...args),
      leave: () => events.dispatchEvent(new Event('leavepictureinpicture')),
      requestPictureInPicture: async () => {
        v.calls++;
        if (v.fail) throw new Error('denied');
        const old = document.pictureInPictureElement;
        document.pictureInPictureElement = v;
        if (old && old !== v) old.leave();
      } };
    elements.push(v);
    return v;
  }
  return { video, document, timers, warnings, context, api: context.FloatingVideo,
    tick: async () => { for (const fn of [...timers.values()]) await fn(); } };
}

test('fixture replacement transfers from ended video and preserves opt-out restoration', async () => {
  const p = fixture(), first = p.video();
  first.setAttribute('disablepictureinpicture', 'original');
  await p.api.open(first);
  first.ended = true; first.paused = true;
  const next = p.video(); next.setAttribute('disablepictureinpicture', 'next');
  await p.tick();
  assert.equal(p.document.pictureInPictureElement, next);
  assert.equal(first.getAttribute('disablepictureinpicture'), 'original');
  assert.equal(next.getAttribute('disablepictureinpicture'), null);
  assert.equal(p.timers.size, 1);
  p.document.pictureInPictureElement = null; next.leave();
  assert.equal(next.getAttribute('disablepictureinpicture'), 'next');
  assert.equal(p.timers.size, 0);
});

test('fixture removal transfers only if the browser still reports active PiP', async () => {
  for (const staysOpen of [true, false]) {
    const p = fixture(), first = p.video();
    await p.api.open(first); first.isConnected = false;
    const next = p.video();
    if (!staysOpen) { p.document.pictureInPictureElement = null; first.leave(); }
    await p.tick();
    assert.equal(next.calls, staysOpen ? 1 : 0);
  }
});

test('fixture source swap does not reopen the same video or steal an unrelated playing video', async () => {
  const p = fixture(), first = p.video();
  await p.api.open(first);
  await p.tick();
  first.readyState = 0; await p.tick();
  first.readyState = 4; const unrelated = p.video();
  await p.tick();
  first.paused = true; await p.tick();
  assert.equal(first.calls, 1);
  assert.equal(unrelated.calls, 0);
  assert.equal(p.document.pictureInPictureElement, first);
});

test('waits for a playable replacement and supports paused hidden old players', async () => {
  const p = fixture(), first = p.video();
  await p.api.open(first); first.paused = true; first.area = 0;
  const next = p.video(); next.readyState = 0;
  await p.tick(); assert.equal(next.calls, 0);
  next.readyState = 4; next.paused = true;
  await p.tick(); assert.equal(next.calls, 0);
  next.paused = false;
  await p.tick(); assert.equal(next.calls, 1);
});

test('deliberate close stops watching; reinjection preserves the single watcher', async () => {
  const p = fixture(), first = p.video();
  await p.api.open(first);
  vm.runInContext(source, p.context);
  assert.equal(p.context.FloatingVideo, p.api);
  assert.equal(p.timers.size, 1);
  p.document.pictureInPictureElement = null; first.leave(); first.ended = true;
  const next = p.video(); await p.tick();
  assert.equal(next.calls, 0); assert.equal(p.timers.size, 0);
});

test('failed transfer restores opt-out and stops retrying', async () => {
  const p = fixture(), first = p.video();
  await p.api.open(first); first.ended = true;
  const next = p.video(); next.fail = true;
  next.setAttribute('disablepictureinpicture', 'original');
  await p.tick(); await p.tick();
  assert.equal(next.calls, 1);
  assert.equal(next.getAttribute('disablepictureinpicture'), 'original');
  assert.equal(p.warnings.length, 1); assert.equal(p.timers.size, 0);
});

test('overlapping checks do not issue concurrent transfers', async () => {
  const p = fixture(), first = p.video();
  await p.api.open(first); first.ended = true;
  const next = p.video(); let resolve;
  next.requestPictureInPicture = () => {
    next.calls++;
    return new Promise(done => { resolve = done; });
  };
  const pending = p.tick(); await p.tick();
  assert.equal(next.calls, 1);
  p.document.pictureInPictureElement = next; first.leave(); resolve(); await pending;
  assert.equal(p.timers.size, 1);
});

test('uses the shadow root PiP element rather than the document host', async () => {
  const p = fixture(), first = p.video(), host = {};
  const shadow = { pictureInPictureElement: first };
  await p.api.open(first);
  p.document.pictureInPictureElement = host;
  first.getRootNode = () => shadow;
  first.ended = true;
  const next = p.video();
  next.requestPictureInPicture = async () => {
    next.calls++; shadow.pictureInPictureElement = null;
    p.document.pictureInPictureElement = next; first.leave();
  };
  await p.tick();
  assert.equal(next.calls, 1);
  assert.equal(p.document.pictureInPictureElement, next);
});
