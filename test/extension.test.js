const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = name => readFileSync(path.join(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function video(area, paused = false, extra = {}) {
  const attributes = new Map();
  return {
    localName: 'video', readyState: 4, videoWidth: 1280, paused, ended: false,
    getBoundingClientRect: () => ({ width: area, height: 1 }),
    getAttribute: key => attributes.get(key) ?? null,
    removeAttribute: key => attributes.delete(key),
    setAttribute: (key, value) => attributes.set(key, value),
    requestPictureInPicture: async () => {}, ...extra
  };
}

function page(elements, extra = {}) {
  const document = { querySelectorAll: () => elements, pictureInPictureEnabled: true, ...extra };
  const context = vm.createContext({ document, setInterval: () => 1, clearInterval: () => {} });
  const result = vm.runInContext(source('pip.js'), context);
  return { context, document, result, api: context.FloatingVideo };
}

test('selection prioritizes playing video, then area, including nested shadow roots', () => {
  const target = video(200);
  const hidden = video(0);
  const host = { shadowRoot: { querySelectorAll: () => [target] } };
  const p = page([video(400, true), video(100), hidden, host]);
  assert.equal(p.api.findVideo().video, target);
  assert.equal(p.result.area, 200);
  assert.equal(p.result.playing, true);
  vm.runInContext(source('pip.js'), p.context);
  assert.equal(p.context.FloatingVideo.findVideo().video, target);
});

test('paused fallback excludes ended, unloaded, audio-only, errored and zero-size videos', () => {
  const target = video(20, true);
  const p = page([target, video(99, false, { ended: true }), video(99, false, { readyState: 0 }),
    video(99, false, { videoWidth: 0 }), video(99, false, { error: {} }), video(0)]);
  assert.equal(p.api.findVideo().video, target);
  assert.equal(p.result.playing, false);
  assert.equal(page([]).result.available, false);
  assert.equal(page([target], { pictureInPictureEnabled: false }).result.available, false);
});

test('site opt-out stays removed while PiP is open and returns when it closes or fails', async () => {
  for (const fail of [false, true]) {
    const leaves = [];
    const target = video(20, false, { addEventListener: (type, fn) => { if (type === 'leavepictureinpicture') leaves.push(fn); } });
    target.setAttribute('disablepictureinpicture', 'original');
    target.requestPictureInPicture = async () => {
      assert.equal(target.getAttribute('disablepictureinpicture'), null);
      if (fail) throw new Error('blocked');
    };
    const promise = page([target]).api.open(target);
    if (fail) await assert.rejects(promise, /blocked/);
    else {
      await promise;
      // Chrome closes PiP the moment the opt-out returns (seen live on Paramount+).
      assert.equal(target.getAttribute('disablepictureinpicture'), null);
      leaves.forEach(fn => fn());
    }
    assert.equal(target.getAttribute('disablepictureinpicture'), 'original');
  }
});

function worker(frames, outcome = [{ result: { ok: true } }]) {
  let click;
  const calls = [], badges = [], titles = [];
  const chrome = {
    runtime: {},
    action: {
      onClicked: { addListener: fn => { click = fn; } },
      setBadgeText: async value => { badges.push(value); },
      setBadgeBackgroundColor: async () => {},
      setTitle: async value => { titles.push(value); }
    },
    scripting: { executeScript: (request, callback) => {
      calls.push(request);
      assert.equal(typeof callback, 'function', 'Keep injections on Chrome’s gesture-preserving callback path');
      const fail = error => {
        chrome.runtime.lastError = error;
        try { callback(); } finally { delete chrome.runtime.lastError; }
      };
      let result;
      try {
        result = calls.length === 1 ? (typeof frames === 'function' ? frames() : frames) :
          (typeof outcome === 'function' ? outcome() : outcome);
      } catch (error) {
        fail(error);
        return;
      }
      if (result?.then) result.then(callback, fail);
      else callback(result);
    } }
  };
  vm.runInNewContext(source('background.js'), { chrome });
  return { click, calls, badges, titles };
}
const frame = (id, area, playing, active = false) => ({ documentId: id,
  result: { available: true, area, playing, active } });

test('toolbar selects only one document across frames, prioritizing playing video', async () => {
  const w = worker([frame('main', 999, false), frame('small', 20, true), frame('large', 40, true)]);
  await w.click({ id: 7 });
  assert.equal(w.calls.length, 2);
  assert.deepEqual(Array.from(w.calls[1].target.documentIds), ['large']);
  assert.equal(w.calls[1].args[0], false);
});

test('toolbar starts injection synchronously before any awaited UI work', () => {
  const w = worker([frame('main', 10, true)]);
  w.click({ id: 7 });
  assert.equal(w.calls.length, 2);
  assert.equal(w.badges.at(-1).text, '');
});

test('active PiP closes instead of opening another frame', async () => {
  const w = worker([frame('main', 999, true), frame('active', 1, false, true)]);
  await w.click({ id: 7 });
  assert.equal(w.calls[1].target.documentIds[0], 'active');
  assert.equal(w.calls[1].args[0], true);
  let closed = 0;
  await vm.runInNewContext(`(${w.calls[1].func})(true)`, {
    document: { pictureInPictureElement: {}, exitPictureInPicture: async () => { closed++; } }
  });
  assert.equal(closed, 1);
});

test('injected action opens selected video and reports rejection', async () => {
  const w = worker([frame('main', 10, true)]);
  await w.click({ id: 7 });
  let opened = 0;
  const target = {};
  const context = { FloatingVideo: { findVideo: () => ({ video: target }), open: async v => {
    assert.equal(v, target); opened++;
  } } };
  assert.equal((await vm.runInNewContext(`(${w.calls[1].func})(false)`, context)).ok, true);
  assert.equal(opened, 1);
  context.FloatingVideo.open = async () => { throw new Error('denied'); };
  assert.equal((await vm.runInNewContext(`(${w.calls[1].func})(false)`, context)).error, 'denied');
});

test('no video, restricted pages, and navigation failures produce error feedback', async () => {
  for (const w of [worker([]), worker(() => { throw new Error('restricted'); }),
    worker([frame('main', 10, true)], () => { throw new Error('restricted'); }),
    worker([frame('main', 10, true)], []), worker([frame('main', 10, true)], [{ result: { error: 'denied' } }])]) {
    await w.click({ id: 7 });
    assert.equal(w.badges.at(-1).text, '!');
    assert.match(w.titles.at(-1).title, /No playable|restricted|page changed|denied/);
  }
});

test('concurrent clicks on a busy tab do not open twice', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const w = worker(() => pending);
  const first = w.click({ id: 7 });
  await tick();
  await w.click({ id: 7 });
  assert.equal(w.calls.length, 1);
  resolve([frame('main', 10, true)]);
  await first;
  assert.equal(w.calls.length, 2);
});

function automatic() {
  let change, resolve;
  const handlers = [], warnings = [];
  const context = {
    navigator: { mediaSession: { setActionHandler: (name, fn) => { handlers.push(fn); } } },
    chrome: { storage: { onChanged: { addListener: fn => { change = fn; } },
      sync: { get: () => new Promise(r => { resolve = r; }) } } },
    console: { warn: (...args) => { warnings.push(args); } },
    document: { pictureInPictureElement: null },
    FloatingVideo: { findVideo: () => null }
  };
  vm.runInNewContext(source('automatic.js'), context);
  return { context, handlers, warnings, change, resolve };
}

test('disabled automatic mode leaves site handlers alone; sync changes configure it', async () => {
  const a = automatic();
  a.resolve({ autoPictureInPicture: false });
  await tick();
  assert.equal(a.handlers.length, 0);
  a.change({ autoPictureInPicture: { newValue: true } }, 'local');
  assert.equal(a.handlers.length, 0);
  a.change({ autoPictureInPicture: { newValue: true } }, 'sync');
  assert.equal(typeof a.handlers[0], 'function');
  a.change({ autoPictureInPicture: { newValue: false } }, 'sync');
  assert.equal(a.handlers[1], null);
});

test('late settings read cannot overwrite a newer setting; unsupported API is caught', async () => {
  const a = automatic();
  a.change({ autoPictureInPicture: { newValue: true } }, 'sync');
  a.resolve({ autoPictureInPicture: false });
  await tick();
  assert.equal(a.handlers.length, 1);
  a.context.navigator.mediaSession.setActionHandler = () => { throw new Error('unsupported'); };
  a.change({ autoPictureInPicture: { newValue: true } }, 'sync');
  assert.equal(a.warnings.length, 1);
});

test('automatic handler ignores paused videos and existing PiP, and catches rejection', async () => {
  const a = automatic();
  a.resolve({ autoPictureInPicture: true });
  await tick();
  let count = 0;
  a.context.FloatingVideo.open = async () => { count++; throw new Error('blocked'); };
  a.context.FloatingVideo.findVideo = () => ({ video: {}, playing: false });
  await a.handlers[0]();
  assert.equal(count, 0);
  a.context.FloatingVideo.findVideo = () => ({ video: {}, playing: true });
  a.context.document.pictureInPictureElement = {};
  await a.handlers[0]();
  assert.equal(count, 0);
  a.context.document.pictureInPictureElement = null;
  await a.handlers[0]();
  assert.equal(count, 1);
  assert.equal(a.warnings.length, 1);
});

test('manifest assets exist and are correctly sized PNGs', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.name, 'Floating Video');
  assert.equal(manifest.update_url, undefined);
  for (const [size, filename] of Object.entries({ ...manifest.icons, ...manifest.action.default_icon })) {
    const png = readFileSync(path.join(root, filename));
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  for (const file of [manifest.background.service_worker, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(entry => entry.js)]) assert.ok(existsSync(path.join(root, file)));
});

function options({ failLoad = false, failSave = false } = {}) {
  let change;
  const checkbox = { checked: false, disabled: true, addEventListener: (event, fn) => { change = fn; } };
  const status = { textContent: '' };
  const stored = [];
  const context = {
    document: { getElementById: id => id === 'automatic' ? checkbox : status },
    chrome: { storage: { sync: {
      get: async () => { if (failLoad) throw new Error('load'); return { autoPictureInPicture: true }; },
      set: async value => { if (failSave) throw new Error('save'); stored.push(value); }
    } } }
  };
  vm.runInNewContext(source('options.js'), context);
  return { checkbox, status, stored, change };
}

test('settings load, persist, and report success only after saving', async () => {
  const o = options();
  await tick();
  assert.equal(o.checkbox.checked, true);
  assert.equal(o.checkbox.disabled, false);
  o.checkbox.checked = false;
  await o.change();
  assert.equal(o.stored[0].autoPictureInPicture, false);
  assert.equal(o.status.textContent, 'Saved.');
});

test('settings failures keep the persisted value and offer a retry', async () => {
  const o = options({ failSave: true });
  await tick();
  o.checkbox.checked = false;
  await o.change();
  assert.equal(o.checkbox.checked, true);
  assert.equal(o.checkbox.disabled, false);
  assert.match(o.status.textContent, /Could not save/);
  const broken = options({ failLoad: true });
  await tick();
  assert.equal(broken.checkbox.disabled, true);
  assert.match(broken.status.textContent, /Could not load/);
});
