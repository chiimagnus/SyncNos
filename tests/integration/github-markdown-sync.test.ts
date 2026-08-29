import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { GITHUB_MESSAGE_TYPES, UI_EVENT_TYPES, UI_PORT_NAMES } from '@platform/messaging/message-contracts';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import { addArticleComment } from '@services/comments/data/storage';
import { backgroundStorage } from '@services/conversations/background/storage';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { __resetConversationStorageStateForTests } from '@services/conversations/data/storage-idb';
import {
  clearGithubAuthState,
  getGithubAuthState,
  getGithubSafeAuthSummary,
} from '@services/sync/github/auth/auth-store';
import { cancelDeviceFlow, pollDeviceFlowOnce, startDeviceFlow } from '@services/sync/github/auth/device-flow';
import { getValidAccessToken } from '@services/sync/github/auth/github-auth-service';
import { createGithubApiClient } from '@services/sync/github/github-api-client';
import {
  ackGithubCleanupRows,
  deferGithubCleanupRows,
  getNextGithubCleanupDueAt,
  listDueGithubCleanupRows,
} from '@services/sync/github/github-cleanup-outbox-store';
import { commitGithubStagedOperations, createGithubBlob } from '@services/sync/github/github-git-transport';
import { createGithubSyncOrchestrator } from '@services/sync/github/github-sync-orchestrator';
import githubSyncJobStore from '@services/sync/github/github-sync-job-store';
import { discoverGithubRepositories, preflightGithubRepository } from '@services/sync/github/github-repository-service';
import { registerGithubSettingsHandlers } from '@services/sync/github/settings-background-handlers';
import { getGithubSettings, saveGithubSettings } from '@services/sync/github/settings-store';
import { registerSyncHandlers } from '@services/sync/background-handlers';

const DEVICE_CODE = 'e2e-device-code';
const ACCESS_TOKEN_1 = 'e2e-access-token-1';
const REFRESH_TOKEN_1 = 'e2e-refresh-token-1';
const ACCESS_TOKEN_2 = 'e2e-access-token-2';
const REFRESH_TOKEN_2 = 'e2e-refresh-token-2';
const USER_CODE = 'E2E1-CODE';
const REPOSITORY = 'owner/repo';
const BRANCH = 'main';
const REMOTE_KEY = `github.com/${REPOSITORY}@${BRANCH}`;

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'));
  });
}

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    runtime: { lastError: null as any },
    storage: {
      local: {
        get(keys: string[] | string | null, callback: (result: Record<string, unknown>) => void) {
          if (keys == null) {
            callback({ ...store });
            return;
          }
          const list = Array.isArray(keys) ? keys : [keys];
          callback(
            Object.fromEntries(
              list.map((key) => [key, Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null]),
            ),
          );
        },
        set(payload: Record<string, unknown>, callback?: () => void) {
          Object.assign(store, payload || {});
          callback?.();
        },
        remove(keys: string[] | string, callback?: () => void) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          callback?.();
        },
      },
    },
    __store: store,
  };
}

type TreeEntry = { path: string; mode: string; type: 'blob' | 'tree'; sha: string };

type TreeNode = {
  files: Map<string, string>;
  directories: Map<string, TreeNode>;
};

class FakeGithubServer {
  now = 1_000_000;
  repositoryAccessible = true;
  networkOffline = false;
  failNextBlobUpload = false;
  refreshGrantCalls = 0;
  devicePollCalls = 0;
  syncRefUpdates = 0;
  syncCommitPosts = 0;
  lastTreeRequestEntries: Array<{ path: string; sha: string | null }> = [];

  private shaCounter = 1;
  private acceptedAccessTokens = new Set<string>();
  private blobBytes = new Map<string, Uint8Array>();
  private treeEntries = new Map<string, TreeEntry[]>();
  private rootFiles = new Map<string, Map<string, string>>();
  private commits = new Map<string, { tree: string; parents: string[] }>();
  private headSha = '';

  constructor() {
    const readmeSha = this.storeUtf8('# Existing repository\n\nDo not replace me.\n');
    const treeSha = this.materializeTree(new Map([['README.md', readmeSha]]));
    this.headSha = this.storeCommit(treeSha, []);
  }

  get currentHeadSha() {
    return this.headSha;
  }

  get fetchImpl(): typeof fetch {
    return this.fetch.bind(this) as typeof fetch;
  }

  currentFiles(): Map<string, string> {
    const treeSha = this.commits.get(this.headSha)?.tree;
    if (!treeSha) throw new Error('fake GitHub head missing tree');
    const files = this.rootFiles.get(treeSha);
    if (!files) throw new Error('fake GitHub root tree missing files');
    return new Map(files);
  }

  hasPath(path: string): boolean {
    return this.currentFiles().has(path);
  }

  readText(path: string): string | null {
    const sha = this.currentFiles().get(path);
    if (!sha) return null;
    const bytes = this.blobBytes.get(sha);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  externalWrite(path: string, text: string) {
    const files = this.currentFiles();
    files.set(path, this.storeUtf8(text));
    this.advanceExternal(files);
  }

  externalDelete(path: string) {
    const files = this.currentFiles();
    files.delete(path);
    this.advanceExternal(files);
  }

  private nextSha(): string {
    return (this.shaCounter++).toString(16).padStart(40, '0');
  }

  private storeBytes(bytes: Uint8Array): string {
    const sha = this.nextSha();
    this.blobBytes.set(sha, Uint8Array.from(bytes));
    return sha;
  }

  private storeUtf8(text: string): string {
    return this.storeBytes(new TextEncoder().encode(text));
  }

  private storeCommit(tree: string, parents: string[]): string {
    const sha = this.nextSha();
    this.commits.set(sha, { tree, parents: [...parents] });
    return sha;
  }

  private materializeTree(files: Map<string, string>): string {
    const root: TreeNode = { files: new Map(), directories: new Map() };
    for (const [path, blobSha] of files) {
      const segments = path.split('/').filter(Boolean);
      if (!segments.length) continue;
      let node = root;
      for (const segment of segments.slice(0, -1)) {
        const child = node.directories.get(segment) ?? { files: new Map(), directories: new Map() };
        node.directories.set(segment, child);
        node = child;
      }
      node.files.set(segments.at(-1)!, blobSha);
    }

    const build = (node: TreeNode): string => {
      const entries: TreeEntry[] = [];
      for (const [name, sha] of [...node.files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        entries.push({ path: name, mode: '100644', type: 'blob', sha });
      }
      for (const [name, child] of [...node.directories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        entries.push({ path: name, mode: '040000', type: 'tree', sha: build(child) });
      }
      const sha = this.nextSha();
      this.treeEntries.set(sha, entries);
      return sha;
    };

    const rootSha = build(root);
    this.rootFiles.set(rootSha, new Map(files));
    return rootSha;
  }

  private advanceExternal(files: Map<string, string>) {
    const tree = this.materializeTree(files);
    this.headSha = this.storeCommit(tree, [this.headSha]);
  }

  private sameFiles(left: Map<string, string>, right: Map<string, string>): boolean {
    if (left.size !== right.size) return false;
    for (const [path, sha] of left) if (right.get(path) !== sha) return false;
    return true;
  }

  private json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Request-Id': 'E2E-REQ' },
    });
  }

  private parseJsonBody(init?: RequestInit): any {
    if (init?.body == null) return {};
    return JSON.parse(String(init.body));
  }

  private parseFormBody(init?: RequestInit): URLSearchParams {
    if (init?.body instanceof URLSearchParams) return init.body;
    return new URLSearchParams(String(init?.body ?? ''));
  }

  private requireApiAuth(init?: RequestInit): Response | null {
    const auth = new Headers(init?.headers).get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    return this.acceptedAccessTokens.has(token) ? null : this.json({ message: 'Bad credentials' }, 401);
  }

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = String(init?.method || 'GET').toUpperCase();

    if (url.href === 'https://github.com/login/device/code' && method === 'POST') {
      return this.json({
        device_code: DEVICE_CODE,
        user_code: USER_CODE,
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1,
      });
    }

    if (url.href === 'https://github.com/login/oauth/access_token' && method === 'POST') {
      const form = this.parseFormBody(init);
      const grantType = form.get('grant_type');
      if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
        this.devicePollCalls += 1;
        if (form.get('device_code') !== DEVICE_CODE) return this.json({ error: 'incorrect_device_code' }, 400);
        this.acceptedAccessTokens.add(ACCESS_TOKEN_1);
        return this.json({
          access_token: ACCESS_TOKEN_1,
          expires_in: 600,
          refresh_token: REFRESH_TOKEN_1,
          refresh_token_expires_in: 7_200,
          token_type: 'bearer',
        });
      }
      if (grantType === 'refresh_token') {
        this.refreshGrantCalls += 1;
        if (form.get('refresh_token') !== REFRESH_TOKEN_1) return this.json({ error: 'bad_refresh_token' }, 400);
        this.acceptedAccessTokens.add(ACCESS_TOKEN_2);
        return this.json({
          access_token: ACCESS_TOKEN_2,
          expires_in: 600,
          refresh_token: REFRESH_TOKEN_2,
          refresh_token_expires_in: 7_200,
          token_type: 'bearer',
        });
      }
      return this.json({ error: 'unsupported_grant_type' }, 400);
    }

    if (url.origin !== 'https://api.github.com') return this.json({ message: 'unexpected destination' }, 404);
    if (this.networkOffline) throw new TypeError('fake GitHub offline');
    const authFailure = this.requireApiAuth(init);
    if (authFailure) return authFailure;

    const path = decodeURIComponent(url.pathname);
    if (method === 'GET' && path === '/user') {
      return this.json({
        login: 'octocat',
        avatar_url: 'https://avatars.example.test/octocat',
        html_url: 'https://github.com/octocat',
      });
    }
    if (method === 'GET' && path === '/user/installations') {
      return this.json({
        installations: [{ id: 7, app_slug: 'syncnos', permissions: { contents: 'write', metadata: 'read' } }],
      });
    }
    if (method === 'GET' && path === '/user/installations/7/repositories') {
      return this.json({
        repositories: this.repositoryAccessible
          ? [
              {
                owner: { login: 'owner' },
                name: 'repo',
                private: true,
                permissions: { admin: false, maintain: false, push: true, pull: true, triage: false },
              },
            ]
          : [],
      });
    }
    if (method === 'GET' && path === '/repos/owner/repo') return this.json({ default_branch: BRANCH });
    if (method === 'GET' && path === '/repos/owner/repo/git/ref/heads/main') {
      return this.json({ object: { type: 'commit', sha: this.headSha } });
    }
    if (method === 'GET' && path.startsWith('/repos/owner/repo/git/commits/')) {
      const sha = path.split('/').at(-1)!;
      const commit = this.commits.get(sha);
      return commit ? this.json({ sha, tree: { sha: commit.tree } }) : this.json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && path.startsWith('/repos/owner/repo/git/trees/')) {
      const sha = path.split('/').at(-1)!;
      const tree = this.treeEntries.get(sha);
      return tree ? this.json({ sha, truncated: false, tree }) : this.json({ message: 'Not Found' }, 404);
    }

    if (method === 'POST' && path === '/repos/owner/repo/git/blobs') {
      if (this.failNextBlobUpload) {
        this.failNextBlobUpload = false;
        return this.json({ message: 'temporary blob failure' }, 500);
      }
      const body = this.parseJsonBody(init);
      const bytes =
        body.encoding === 'base64'
          ? Uint8Array.from(Buffer.from(String(body.content || ''), 'base64'))
          : new TextEncoder().encode(String(body.content || ''));
      return this.json({ sha: this.storeBytes(bytes) }, 201);
    }

    if (method === 'POST' && path === '/repos/owner/repo/git/trees') {
      const body = this.parseJsonBody(init);
      const baseTree = String(body.base_tree || '');
      const baseFiles = this.rootFiles.get(baseTree);
      if (!baseFiles) return this.json({ message: 'base tree missing' }, 422);
      const files = new Map(baseFiles);
      const entries = Array.isArray(body.tree) ? body.tree : [];
      this.lastTreeRequestEntries = entries.map((entry: any) => ({
        path: String(entry.path || ''),
        sha: entry.sha ?? null,
      }));
      for (const entry of entries) {
        const entryPath = String(entry?.path || '');
        if (!entryPath) continue;
        if (entry.sha == null) files.delete(entryPath);
        else files.set(entryPath, String(entry.sha));
      }
      if (this.sameFiles(baseFiles, files)) return this.json({ sha: baseTree }, 201);
      return this.json({ sha: this.materializeTree(files) }, 201);
    }

    if (method === 'POST' && path === '/repos/owner/repo/git/commits') {
      const body = this.parseJsonBody(init);
      const tree = String(body.tree || '');
      if (!this.rootFiles.has(tree)) return this.json({ message: 'tree missing' }, 422);
      this.syncCommitPosts += 1;
      return this.json(
        { sha: this.storeCommit(tree, Array.isArray(body.parents) ? body.parents.map(String) : []) },
        201,
      );
    }

    if (method === 'PATCH' && path === '/repos/owner/repo/git/refs/heads/main') {
      const body = this.parseJsonBody(init);
      const next = String(body.sha || '');
      if (body.force !== false || !this.commits.has(next)) return this.json({ message: 'Invalid ref update' }, 422);
      this.headSha = next;
      this.syncRefUpdates += 1;
      return this.json({ object: { type: 'commit', sha: next } });
    }

    return this.json({ message: `Unhandled ${method} ${path}` }, 404);
  }
}

function markdownPath(mapping: any): string {
  const entries = Object.entries(mapping?.githubManagedFiles || {}) as Array<[string, any]>;
  const found = entries.find(([, file]) => file?.kind === 'markdown');
  if (!found) throw new Error('missing GitHub markdown mapping');
  return found[0];
}

function assetPaths(mapping: any): string[] {
  return (Object.entries(mapping?.githubManagedFiles || {}) as Array<[string, any]>)
    .filter(([, file]) => file?.kind === 'asset')
    .map(([path]) => path);
}

function assertSecretFree(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [DEVICE_CODE, ACCESS_TOKEN_1, REFRESH_TOKEN_1, ACCESS_TOKEN_2, REFRESH_TOKEN_2]) {
    expect(serialized).not.toContain(secret);
  }
}

async function seedImageAsset(id: number, conversationId: number, url: string, byte: number) {
  const db = await openDb();
  const tx = db.transaction(['image_cache'], 'readwrite');
  await reqToPromise(
    tx.objectStore('image_cache').add({
      id,
      conversationId,
      url,
      dataUrl: `data:image/png;base64,${Buffer.from([byte, byte + 1, byte + 2]).toString('base64')}`,
      byteSize: 3,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    }) as any,
  );
  await txDone(tx);
}

function waitForGithubSyncFinished(router: ReturnType<typeof createBackgroundRouter>) {
  return new Promise<void>((resolve, reject) => {
    const registered = router.eventsHub.registerPort({
      name: UI_PORT_NAMES.POPUP_EVENTS,
      postMessage(message: any) {
        if (
          message?.type === UI_EVENT_TYPES.CONVERSATIONS_CHANGED &&
          message?.payload?.reason === 'syncFinished' &&
          message?.payload?.provider === 'github'
        ) {
          resolve();
        }
      },
    });
    if (!registered) reject(new Error('failed to register GitHub sync completion listener'));
  });
}

const testIndexedDb = new IDBFactory();
const chromeMock = mockChromeStorage();
const fakeGithub = new FakeGithubServer();

const api = createGithubApiClient({
  fetchImpl: fakeGithub.fetchImpl,
  getAccessToken: () => getValidAccessToken({ fetchImpl: fakeGithub.fetchImpl, now: () => fakeGithub.now }),
  clock: {
    now: () => fakeGithub.now,
    setTimeout: () => 0,
    clearTimeout: () => {},
  },
  sleep: async (ms) => {
    fakeGithub.now += Math.max(0, ms);
  },
});

const orchestrator = createGithubSyncOrchestrator({
  getSettings: getGithubSettings,
  preflight: (input) => preflightGithubRepository(input, api),
  storage: backgroundStorage,
  loadImage: getImageCacheAssetById,
  createBlob: (input) => createGithubBlob(input, api),
  commit: (input) => commitGithubStagedOperations(input, api),
  listDueCleanupRows: listDueGithubCleanupRows,
  getNextCleanupDueAt: getNextGithubCleanupDueAt,
  deferCleanupRows: deferGithubCleanupRows,
  ackCleanupRows: ackGithubCleanupRows,
  jobStore: githubSyncJobStore,
  replacementDeferMs: 5_000,
  now: Date.now,
});

const router = createBackgroundRouter({
  fallback: (message) => ({
    ok: false,
    data: null,
    error: { message: `unknown message type: ${message?.type}`, extra: null },
  }),
});

registerGithubSettingsHandlers(router, {
  getSettings: getGithubSettings,
  saveSettings: saveGithubSettings,
  getSafeAuthSummary: getGithubSafeAuthSummary,
  startDeviceFlow: () => startDeviceFlow({ fetchImpl: fakeGithub.fetchImpl, now: () => fakeGithub.now }),
  pollDeviceFlowOnce: () => pollDeviceFlowOnce({ fetchImpl: fakeGithub.fetchImpl, now: () => fakeGithub.now }),
  cancelDeviceFlow,
  clearAuthState: clearGithubAuthState,
  discoverRepositories: () => discoverGithubRepositories(api),
  preflightRepository: (input) => preflightGithubRepository(input, api),
});

registerSyncHandlers(router as any, {
  getInstanceId: () => 'github-integration-instance',
  notionSyncOrchestrator: {
    syncConversations: async () => ({}),
    getSyncJobStatus: async () => ({ job: null }),
    clearSyncJobStatus: async () => ({ job: null }),
  },
  obsidianSyncOrchestrator: {
    testConnection: async () => ({ ok: true }),
    syncConversations: async () => ({}),
    getSyncStatus: async () => ({ job: null }),
    clearSyncStatus: async () => ({ job: null }),
  },
  feishuSyncOrchestrator: {
    syncConversations: async () => ({}),
    getSyncStatus: async () => ({ job: null }),
    clearSyncStatus: async () => ({ job: null }),
  },
  githubSyncOrchestrator: orchestrator,
});

beforeAll(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = testIndexedDb;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  // @ts-expect-error test global
  globalThis.chrome = chromeMock;
  // @ts-expect-error test global
  globalThis.browser = undefined;
  await clearGithubAuthState();
  await githubSyncJobStore.setJob(null);
});

afterAll(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
});

describe('GitHub Markdown production-chain integration', () => {
  it('runs Device Flow through repository preflight and durable Markdown reconciliation', async () => {
    const startedAuth = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW });
    expect(startedAuth).toMatchObject({
      ok: true,
      data: { auth: { state: 'pending', userCode: USER_CODE, verificationUri: 'https://github.com/login/device' } },
    });
    assertSecretFree(startedAuth);

    const restoredPending = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SETTINGS });
    expect(restoredPending).toMatchObject({
      ok: true,
      data: {
        auth: {
          state: 'pending',
          userCode: USER_CODE,
          verificationUri: 'https://github.com/login/device',
          nextPollAt: startedAuth.data.auth.nextPollAt,
        },
      },
    });
    assertSecretFree(restoredPending);

    const pending = restoredPending.data.auth;
    fakeGithub.now = pending.nextPollAt;
    const polled = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW });
    expect(polled).toMatchObject({ ok: true, data: { auth: { state: 'connected' } } });
    expect(fakeGithub.devicePollCalls).toBe(1);
    assertSecretFree(polled);

    const repositories = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES });
    expect(repositories).toMatchObject({
      ok: true,
      data: { status: 'ready', repositories: [{ fullName: REPOSITORY, contentWriteCapable: true }] },
    });
    assertSecretFree(repositories);

    const saved = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SAVE_SETTINGS,
      repository: REPOSITORY,
      branch: BRANCH,
    });
    expect(saved).toMatchObject({ ok: true, data: { settings: { repository: REPOSITORY, branch: BRANCH } } });
    assertSecretFree(saved);

    const commitsBeforeTest = fakeGithub.syncCommitPosts;
    const refsBeforeTest = fakeGithub.syncRefUpdates;
    const tested = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.TEST_CONNECTION });
    expect(tested).toMatchObject({
      ok: true,
      data: { ok: true, target: { repository: REPOSITORY, branch: BRANCH, remoteKey: REMOTE_KEY, installationId: 7 } },
    });
    expect(fakeGithub.syncCommitPosts).toBe(commitsBeforeTest);
    expect(fakeGithub.syncRefUpdates).toBe(refsBeforeTest);
    assertSecretFree(tested);

    const chat = await backgroundStorage.upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'github-e2e-chat',
      title: 'E2E Chat',
      url: 'https://chatgpt.com/c/github-e2e-chat',
      warningFlags: [],
      lastCapturedAt: 10,
    });
    const article = await backgroundStorage.upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/github-e2e-article',
      title: 'E2E Article',
      url: 'https://example.com/github-e2e-article',
      warningFlags: [],
      lastCapturedAt: 20,
    });
    await seedImageAsset(1, Number(chat.id), 'https://images.example.test/one.png', 1);
    await backgroundStorage.syncConversationMessages(Number(chat.id), [
      {
        messageKey: 'chat-1',
        role: 'assistant',
        contentText: 'Chat body with cached image',
        contentMarkdown: 'Chat body with cached image\n\n![cached](syncnos-asset://1)',
        sequence: 1,
        updatedAt: 10,
      },
    ]);
    await backgroundStorage.syncConversationMessages(Number(article.id), [
      {
        messageKey: 'article_body',
        role: 'article',
        contentText: 'Article body',
        contentMarkdown: '# Article body\n\nLocal article text.',
        sequence: 1,
        updatedAt: 20,
      },
    ]);
    await addArticleComment({
      canonicalUrl: String(article.url),
      conversationId: Number(article.id),
      authorName: 'Alice',
      quoteText: 'Local article text',
      commentText: 'E2E owned comment',
      createdAt: 30,
      updatedAt: 30,
    });

    const refUpdatesBeforeFirstSync = fakeGithub.syncRefUpdates;
    const syncFinished = waitForGithubSyncFinished(router);
    const manualStart = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [chat.id, article.id],
    });
    expect(manualStart).toMatchObject({ ok: true, data: { started: true, provider: 'github' } });
    assertSecretFree(manualStart);
    await syncFinished;
    const firstStatus = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS });
    expect(firstStatus.data.job).toMatchObject({ status: 'done', okCount: 2, failCount: 0 });
    assertSecretFree(firstStatus);
    expect(fakeGithub.syncRefUpdates - refUpdatesBeforeFirstSync).toBe(1);

    const chatAfterFirst = await backgroundStorage.getSyncMappingByConversation(Number(chat.id));
    const articleAfterFirst = await backgroundStorage.getSyncMappingByConversation(Number(article.id));
    const chatPath = markdownPath(chatAfterFirst?.mapping);
    const articlePath = markdownPath(articleAfterFirst?.mapping);
    const firstAssetPaths = assetPaths(chatAfterFirst?.mapping);
    expect(firstAssetPaths).toHaveLength(1);
    expect(chatPath.startsWith('AIChats/')).toBe(true);
    expect(articlePath.startsWith('WebArticles/')).toBe(true);
    expect(fakeGithub.hasPath('README.md')).toBe(true);
    expect(fakeGithub.readText('README.md')).toContain('Do not replace me.');
    expect(fakeGithub.hasPath(chatPath)).toBe(true);
    expect(fakeGithub.hasPath(articlePath)).toBe(true);
    expect(fakeGithub.hasPath(firstAssetPaths[0]!)).toBe(true);
    expect(fakeGithub.readText(articlePath)).toContain('E2E owned comment');
    expect(fakeGithub.readText(chatPath)).not.toContain('syncnos-asset://');

    const commitsBeforeNoOp = fakeGithub.syncRefUpdates;
    const unchanged = await orchestrator.sync({
      conversationIds: [chat.id, article.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    expect(unchanged.items.map((item) => item.status)).toEqual(['synced', 'synced']);
    expect(unchanged.transport.status).toBe('no_changes');
    expect(fakeGithub.syncRefUpdates).toBe(commitsBeforeNoOp);

    const localMessagesBeforeDrift = await backgroundStorage.getMessagesByConversationId(Number(chat.id));
    fakeGithub.externalWrite(chatPath, '# REMOTE DRIFT\n');
    expect(fakeGithub.readText(chatPath)).toContain('REMOTE DRIFT');
    const reconcile = await orchestrator.sync({
      conversationIds: [chat.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    expect(reconcile.items[0]).toMatchObject({ status: 'synced' });
    expect(fakeGithub.readText(chatPath)).not.toContain('REMOTE DRIFT');
    expect(await backgroundStorage.getMessagesByConversationId(Number(chat.id))).toEqual(localMessagesBeforeDrift);

    const oldChatPath = markdownPath((await backgroundStorage.getSyncMappingByConversation(Number(chat.id)))?.mapping);
    await backgroundStorage.upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'github-e2e-chat',
      title: 'E2E Chat Renamed',
      url: 'https://chatgpt.com/c/github-e2e-chat',
      warningFlags: [],
      lastCapturedAt: 40,
    });
    const renameCommitsBefore = fakeGithub.syncRefUpdates;
    const renamedChat = await orchestrator.sync({
      conversationIds: [chat.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    const newChatPath = markdownPath((await backgroundStorage.getSyncMappingByConversation(Number(chat.id)))?.mapping);
    expect(renamedChat.items[0]).toMatchObject({ status: 'synced' });
    expect(newChatPath).not.toBe(oldChatPath);
    expect(fakeGithub.syncRefUpdates - renameCommitsBefore).toBe(1);
    expect(fakeGithub.hasPath(oldChatPath)).toBe(false);
    expect(fakeGithub.hasPath(newChatPath)).toBe(true);
    expect(fakeGithub.lastTreeRequestEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: oldChatPath, sha: null }),
        expect.objectContaining({ path: newChatPath }),
      ]),
    );

    const oldArticlePath = markdownPath(
      (await backgroundStorage.getSyncMappingByConversation(Number(article.id)))?.mapping,
    );
    fakeGithub.externalDelete(oldArticlePath);
    expect(fakeGithub.hasPath(oldArticlePath)).toBe(false);
    await backgroundStorage.upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: String(article.conversationKey),
      title: 'E2E Article Renamed',
      url: String(article.url),
      warningFlags: [],
      lastCapturedAt: 50,
    });
    const absentDelete = await orchestrator.sync({
      conversationIds: [article.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    const newArticlePath = markdownPath(
      (await backgroundStorage.getSyncMappingByConversation(Number(article.id)))?.mapping,
    );
    expect(absentDelete.items[0]).toMatchObject({ status: 'synced' });
    expect(newArticlePath).not.toBe(oldArticlePath);
    expect(fakeGithub.hasPath(newArticlePath)).toBe(true);
    expect(fakeGithub.hasPath(oldArticlePath)).toBe(false);

    await seedImageAsset(2, Number(chat.id), 'https://images.example.test/fallback.png', 9);
    await backgroundStorage.syncConversationMessages(Number(chat.id), [
      {
        messageKey: 'chat-1',
        role: 'assistant',
        contentText: 'Chat body after upload fallback',
        contentMarkdown: 'Chat body after upload fallback\n\n![fallback](syncnos-asset://2)',
        sequence: 1,
        updatedAt: 60,
      },
    ]);
    fakeGithub.failNextBlobUpload = true;
    const imageFallback = await orchestrator.sync({
      conversationIds: [chat.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    expect(imageFallback.items[0]).toMatchObject({ status: 'synced' });
    expect(imageFallback.items[0]?.warnings).toContain('image_upload_failed');
    const fallbackChatPath = markdownPath(
      (await backgroundStorage.getSyncMappingByConversation(Number(chat.id)))?.mapping,
    );
    expect(fakeGithub.readText(fallbackChatPath)).toContain('https://images.example.test/fallback.png');
    expect(fakeGithub.readText(fallbackChatPath)).not.toContain('syncnos-asset://');

    const authBeforeRefresh = await getGithubAuthState();
    expect(authBeforeRefresh.state).toBe('connected');
    if (authBeforeRefresh.state !== 'connected' || authBeforeRefresh.token.accessExpiresAt == null) {
      throw new Error('expected expiring GitHub access token');
    }
    fakeGithub.now = authBeforeRefresh.token.accessExpiresAt - 299_000;
    const refreshBefore = fakeGithub.refreshGrantCalls;
    const [discoveryA, discoveryB] = await Promise.all([
      discoverGithubRepositories(api),
      discoverGithubRepositories(api),
    ]);
    expect(discoveryA.status).toBe('ready');
    expect(discoveryB.status).toBe('ready');
    expect(fakeGithub.refreshGrantCalls - refreshBefore).toBe(1);

    await backgroundStorage.syncConversationMessages(Number(article.id), [
      {
        messageKey: 'article_body',
        role: 'article',
        contentText: 'Article body after refresh',
        contentMarkdown: '# Article body\n\nLocal article text after refresh.',
        sequence: 1,
        updatedAt: 70,
      },
    ]);
    const afterRefresh = await orchestrator.sync({
      conversationIds: [article.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    expect(afterRefresh.items[0]).toMatchObject({ status: 'synced' });
    assertSecretFree(afterRefresh);
    assertSecretFree(await backgroundStorage.getSyncMappingByConversation(Number(article.id)));
    assertSecretFree(fakeGithub.readText(newArticlePath));

    const settingsBeforeRemoval = await getGithubSettings();
    fakeGithub.repositoryAccessible = false;
    const unavailable = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.TEST_CONNECTION });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { message: 'github_no_accessible_repositories', extra: { code: 'github_no_accessible_repositories' } },
    });
    expect(await getGithubSettings()).toMatchObject({
      repository: settingsBeforeRemoval.repository,
      branch: settingsBeforeRemoval.branch,
    });
    assertSecretFree(unavailable);

    fakeGithub.repositoryAccessible = true;
    const restored = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.TEST_CONNECTION });
    expect(restored).toMatchObject({
      ok: true,
      data: { ok: true, target: { repository: REPOSITORY, branch: BRANCH } },
    });
    const finalRun = await orchestrator.sync({
      conversationIds: [chat.id, article.id],
      mode: 'reconcile',
      instanceId: 'github-integration-instance',
    });
    expect(finalRun.summary.failedCount).toBe(0);
    expect(fakeGithub.hasPath('README.md')).toBe(true);
    assertSecretFree(finalRun);

    const chatBeforeDelete = await backgroundStorage.getSyncMappingByConversation(Number(chat.id));
    const deletedRemotePaths = Object.keys(chatBeforeDelete?.mapping?.githubManagedFiles ?? {});
    expect(deletedRemotePaths.length).toBeGreaterThan(0);
    expect(deletedRemotePaths.every((path) => fakeGithub.hasPath(path))).toBe(true);

    const localDelete = await backgroundStorage.deleteConversationsByIds([chat.id]);
    expect(localDelete).toMatchObject({ deletedConversations: 1, deletedMappings: 1 });
    expect(await backgroundStorage.getConversationById(Number(chat.id))).toBeNull();
    const pendingCleanup = await listDueGithubCleanupRows(REMOTE_KEY, Date.now(), 100);
    expect(pendingCleanup.rows).toHaveLength(1);
    expect(pendingCleanup.rows[0]?.paths).toEqual(expect.arrayContaining(deletedRemotePaths));

    fakeGithub.networkOffline = true;
    await expect(
      orchestrator.sync({ conversationIds: [], instanceId: 'github-integration-instance' }),
    ).rejects.toMatchObject({
      code: 'github_network_error',
    });
    expect((await listDueGithubCleanupRows(REMOTE_KEY, Date.now(), 100)).rows).toHaveLength(1);
    expect(deletedRemotePaths.every((path) => fakeGithub.hasPath(path))).toBe(true);

    fakeGithub.networkOffline = false;
    const cleanupRecovered = await orchestrator.sync({
      conversationIds: [],
      instanceId: 'github-integration-instance',
    });
    expect(cleanupRecovered.transport.status).toMatch(/^(committed|no_changes)$/);
    expect((await listDueGithubCleanupRows(REMOTE_KEY, Date.now(), 100)).rows).toEqual([]);
    expect(deletedRemotePaths.every((path) => !fakeGithub.hasPath(path))).toBe(true);
    expect(fakeGithub.hasPath('README.md')).toBe(true);
    assertSecretFree(cleanupRecovered);
  });
});
