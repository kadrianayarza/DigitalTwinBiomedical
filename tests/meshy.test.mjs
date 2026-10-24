import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshyError, pollMeshyTask, submitMeshyTask } from '../spacetimedb/src/meshy.ts';

const base = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const taskUrl = `${base}/test-task`;
const key = 'unit-test-key';
const photo = 'data:image/jpeg;base64,dGVzdA==';
const response = (body, status = 200) => ({ status, text: () => JSON.stringify(body) });

test('submits one textured A-pose GLB request with server-side bearer auth', () => {
  const calls = [];
  const fetch = (url, options) => {
    calls.push({ url, ...options });
    return response({ result: 'test-task' }, 202);
  };
  assert.equal(submitMeshyTask(fetch, key, photo), taskUrl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, base);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.authorization, `Bearer ${key}`);
  assert.deepEqual(JSON.parse(calls[0].body), {
    image_url: photo,
    ai_model: 'latest',
    should_remesh: true,
    target_polycount: 30_000,
    should_texture: true,
    enable_pbr: true,
    pose_mode: 'a-pose',
    target_formats: ['glb'],
  });
});

test('keeps the photo pose for seated twins', () => {
  const fetch = (_url, options) => {
    assert.equal('pose_mode' in JSON.parse(options.body), false);
    return response({ result: 'test-task' });
  };
  assert.equal(submitMeshyTask(fetch, key, photo, 'latest', true), taskUrl);
});

test('accepts a standard model override and safely encodes opaque task IDs', () => {
  const fetch = (_url, options) => {
    assert.equal(JSON.parse(options.body).ai_model, 'meshy-7.1');
    return response({ result: 'opaque/task?x=1' });
  };
  assert.equal(submitMeshyTask(fetch, key, photo, 'meshy-7.1'), `${base}/opaque%2Ftask%3Fx%3D1`);
});

test('a missing API key never sends a request', () => {
  assert.throws(() => submitMeshyTask(() => assert.fail('unexpected request'), ' ', photo), /API key missing/);
});

for (const result of [undefined, null, '', ' ', 123, '.', '..']) {
  test(`rejects an invalid task ID: ${JSON.stringify(result)}`, () => {
    assert.throws(() => submitMeshyTask(() => response({ result }), key, photo), MeshyError);
  });
}

test('polls pending and in-progress tasks without uploading the photo again', () => {
  const replies = [
    response({ status: 'PENDING' }),
    response({ status: 'IN_PROGRESS', progress: 37.6 }),
    response({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/model.glb' } }),
  ];
  const fetch = (url, options) => {
    assert.equal(url, taskUrl);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, `Bearer ${key}`);
    assert.equal(options.body, undefined);
    return replies.shift();
  };
  assert.match(pollMeshyTask(fetch, key, taskUrl).detail, /queue/);
  assert.deepEqual(pollMeshyTask(fetch, key, taskUrl), {
    status: 'generating', detail: 'Building your 3D twin (38%).',
  });
  assert.deepEqual(pollMeshyTask(fetch, key, taskUrl), {
    status: 'ready', detail: 'Personal twin ready', twinUrl: 'https://assets.meshy.ai/model.glb',
  });
  assert.equal(replies.length, 0);
});

test('progress is bounded and missing progress does not display NaN', () => {
  assert.match(pollMeshyTask(() => response({ status: 'IN_PROGRESS', progress: 101 }), key, taskUrl).detail, /100%/);
  assert.match(pollMeshyTask(() => response({ status: 'IN_PROGRESS', progress: -5 }), key, taskUrl).detail, /0%/);
  assert.equal(pollMeshyTask(() => response({ status: 'IN_PROGRESS' }), key, taskUrl).detail, 'Building your 3D twin.');
});

for (const status of ['FAILED', 'CANCELED', 'UNKNOWN', undefined]) {
  test(`stops on ${status}, without exposing provider error contents`, () => {
    assert.throws(
      () => pollMeshyTask(() => response({ status, task_error: { message: `${photo} ${key}` } }), key, taskUrl),
      error => error instanceof MeshyError && !error.retryable && !error.message.includes(photo) && !error.message.includes(key)
    );
  });
}

for (const glb of [undefined, '', 'javascript:alert(1)', 'http://assets.meshy.ai/model.glb', 'https://secret@assets.meshy.ai/model.glb']) {
  test(`rejects an invalid generated model URL: ${glb}`, () => {
    assert.throws(() => pollMeshyTask(() => response({ status: 'SUCCEEDED', model_urls: { glb } }), key, taskUrl), /valid model/);
  });
}

for (const url of [
  'https://other.example/task',
  'https://api.meshy.ai.evil.example/openapi/v1/image-to-3d/task',
  `${taskUrl}?redirect=elsewhere`,
  `${base}/../account`,
  `${base}/..`,
  `${base}/`,
]) {
  test(`never forwards credentials to an untrusted task URL: ${url}`, () => {
    assert.throws(() => pollMeshyTask(() => assert.fail('unexpected request'), key, url), /valid twin task/);
  });
}

for (const [status, retryable, message] of [
  [400, false, /HTTP 400/],
  [401, false, /API key/],
  [403, false, /API key/],
  [402, false, /credits/],
  [429, true, /busy/],
  [500, true, /unavailable/],
  [503, true, /unavailable/],
]) {
  test(`handles HTTP ${status} without reading sensitive error bodies`, () => {
    assert.throws(
      () => pollMeshyTask(() => ({ status, text: () => assert.fail('must not read error body') }), key, taskUrl),
      error => error instanceof MeshyError && error.retryable === retryable && message.test(error.message)
    );
  });
}

test('invalid JSON is reported without echoing response content', () => {
  assert.throws(
    () => pollMeshyTask(() => ({ status: 200, text: () => `private-photo:${photo}` }), key, taskUrl),
    error => error instanceof MeshyError && error.message === 'The 3D service returned an invalid response.'
  );
});

test('an uncertain billable submission is attempted only once', () => {
  let requests = 0;
  assert.throws(() => submitMeshyTask(() => {
    requests++;
    throw new Error('connection lost');
  }, key, photo), /connection lost/);
  assert.equal(requests, 1);
});
