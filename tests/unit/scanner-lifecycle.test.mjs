import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync(new URL('../../src/components/ScannerModal.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function scanner(getUserMedia, { video = null } = {}) {
  const callbacks = [];
  const refs = [];
  const states = [];
  const react = {
    useState(initial) {
      const state = { value: initial };
      states.push(state);
      return [initial, value => { state.value = value; }];
    },
    useRef(value) { const ref = { current: value }; refs.push(ref); return ref; },
    useCallback(fn) { callbacks.push(fn); return fn; },
    useEffect() {},
  };
  const context = {
    exports: {}, require: () => react,
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia, enumerateDevices: async () => [
      { kind: 'videoinput', deviceId: 'front' }, { kind: 'videoinput', deviceId: 'rear' },
    ] } },
    performance: { now: () => 100 },
    console: { warn() {}, error() {} }, DOMException,
    setTimeout() {}, cancelAnimationFrame() {},
  };
  vm.runInNewContext(source, context);
  context.exports.default({ isOpen: false, onClose() {}, onDetected() {} });
  refs[0].current = video;
  return { stop: callbacks[0], start: callbacks[4], states };
}

function mediaStream() {
  let stops = 0;
  const track = { stop() { stops++; }, getSettings: () => ({ deviceId: 'rear' }), addEventListener() {} };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] }, stopped: () => stops };
}

test('a camera opened after closing is immediately stopped', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const app = scanner(() => pending);
  const opening = app.start();
  app.stop();
  const media = mediaStream();
  resolve(media.stream);
  await opening;
  assert.equal(media.stopped(), 1);
});

test('an older request cannot stop the newer camera', async () => {
  const pending = [];
  const app = scanner(() => new Promise(resolve => pending.push(resolve)));
  const first = app.start();
  const second = app.start();
  const oldMedia = mediaStream();
  pending[0](oldMedia.stream);
  await first;
  assert.equal(oldMedia.stopped(), 1);
  // Missing video element must also release the current stream.
  const newMedia = mediaStream();
  pending[1](newMedia.stream);
  await second;
  assert.equal(newMedia.stopped(), 1);
  assert.equal(app.states[15].value, 1); // Actual rear camera index.
});

test('permission denial does not trigger a second camera request', async () => {
  let calls = 0;
  const app = scanner(async () => { calls++; throw new DOMException('Denied', 'NotAllowedError'); });
  await app.start();
  assert.equal(calls, 1);
});

test('constraint fallback retains the selected camera', async () => {
  const requests = [];
  const media = mediaStream();
  const app = scanner(async constraints => {
    requests.push(constraints);
    if (requests.length === 1) throw new DOMException('Resolution', 'OverconstrainedError');
    return media.stream;
  });
  await app.start('rear');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].video.deviceId.exact, 'rear');
  assert.equal(media.stopped(), 1);
});

test('playback failure releases the camera', async () => {
  const media = mediaStream();
  const video = { setAttribute() {}, pause() {}, async play() { throw new Error('Playback failed'); } };
  const app = scanner(async () => media.stream, { video });
  await app.start();
  assert.ok(media.stopped() >= 1);
  assert.equal(video.srcObject, null);
});

