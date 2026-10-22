import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVE_READ_SCOPE,
  DRIVE_FOLDER_MIME,
  downloadDriveFile,
  getDriveClientId,
  isDriveFolder,
  isSupportedDriveGame,
  listDriveFiles,
  requestDriveAccessToken
} from '../src/google-drive.js';

test('Drive client ID is read from build configuration without exposing secrets', () => {
  assert.equal(getDriveClientId({ VITE_GOOGLE_CLIENT_ID: ' demo.apps.googleusercontent.com ' }), 'demo.apps.googleusercontent.com');
  assert.equal(getDriveClientId({}), '');
});

test('Drive browser distinguishes folders and supported game files', () => {
  assert.equal(isDriveFolder({ mimeType: DRIVE_FOLDER_MIME }), true);
  for (const name of ['game.nes', 'game.SFC', 'game.md', 'archive.zip']) {
    assert.equal(isSupportedDriveGame({ name, mimeType: 'application/octet-stream' }), true);
  }
  for (const file of [null, {}, { name: 'readme.txt' }, { name: 'folder.nes', mimeType: DRIVE_FOLDER_MIME }]) {
    assert.equal(isSupportedDriveGame(file), false);
  }
});

test('Drive token request uses read-only scope and returns access token', async () => {
  let config;
  let request;
  const googleLike = { accounts: { oauth2: {
    initTokenClient(options) {
      config = options;
      return { requestAccessToken(options) { request = options; config.callback({ access_token: 'test-token' }); } };
    }
  } } };
  assert.equal(await requestDriveAccessToken({ clientId: 'client-id', googleLike }), 'test-token');
  assert.equal(config.scope, DRIVE_READ_SCOPE);
  assert.equal(request.prompt, '');
});

test('Drive token request fails safely when not configured or denied', async () => {
  await assert.rejects(requestDriveAccessToken({ clientId: '' }), /VITE_GOOGLE_CLIENT_ID/);
  const googleLike = { accounts: { oauth2: {
    initTokenClient(options) { return { requestAccessToken() { options.callback({ error: 'access_denied' }); } }; }
  } } };
  await assert.rejects(requestDriveAccessToken({ clientId: 'client-id', googleLike }), /access_denied/);
});

test('Drive file listing requests only needed fields and filters malformed entries', async () => {
  let requestedUrl;
  let requestedHeaders;
  const fetchImpl = async (url, options) => {
    requestedUrl = new URL(url);
    requestedHeaders = options.headers;
    return new Response(JSON.stringify({
      files: [
        { id: 'folder', name: 'Games', mimeType: DRIVE_FOLDER_MIME },
        { id: 'rom', name: 'mario.nes', mimeType: 'application/octet-stream' },
        { name: 'bad-record' }
      ],
      nextPageToken: 'next'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await listDriveFiles({ accessToken: 'token', folderId: 'parent-id', fetchImpl });
  assert.equal(result.files.length, 2);
  assert.equal(result.nextPageToken, 'next');
  assert.match(requestedUrl.searchParams.get('q'), /'parent-id' in parents/);
  assert.match(requestedUrl.searchParams.get('fields'), /capabilities\(canDownload\)/);
  assert.equal(requestedUrl.searchParams.get('pageSize'), '100');
  assert.equal(requestedHeaders.Authorization, 'Bearer token');
});

test('Drive listing paginates and reports authorization errors', async () => {
  const fetchImpl = async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('pageToken'), 'cursor-2');
    return new Response(JSON.stringify({ files: [] }), { status: 200 });
  };
  await listDriveFiles({ accessToken: 'token', pageToken: 'cursor-2', fetchImpl });
  await assert.rejects(listDriveFiles({
    accessToken: 'token',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 })
  }), /Permission denied/);
});

test('Drive download uses authenticated media endpoint and returns bytes as a Blob', async () => {
  let requestedUrl;
  const blob = new Blob(['ROM bytes']);
  const result = await downloadDriveFile({
    accessToken: 'token',
    fileId: 'file/id',
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      assert.equal(options.headers.Authorization, 'Bearer token');
      return new Response(blob, { status: 200 });
    }
  });
  assert.equal(requestedUrl.pathname, '/drive/v3/files/file%2Fid');
  assert.equal(requestedUrl.searchParams.get('alt'), 'media');
  assert.equal(await result.text(), 'ROM bytes');
});

test('Drive API failures are readable and do not leak access tokens', async () => {
  await assert.rejects(downloadDriveFile({
    accessToken: 'secret-token',
    fileId: 'file',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
  }), /not found/);
});
