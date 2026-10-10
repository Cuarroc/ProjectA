// DeskStore core (DR-03): read, serialized atomic change and explicit V1->V2 migration.
// Ledger operations (questions, answers, receipts, progress, patches, delivery) compose
// `change` in DR-04; the root agent id is injected and never defaulted here (D2).
import { readFile, writeFile, rename, unlink, mkdir, chmod } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeskError, ensure, ideaDefaults, migrateState, validateState } from './model.mjs';
import { acquireOwnership, releaseOwnership, getOwnershipContext, ownerRecordPath,
  OwnershipError, OWNERSHIP_RELEASE_MISMATCH } from './ownership.mjs';

export class DeskStore {
  #context; #joined = false; #closed = false; #closing;
  #missingStates = new WeakSet();
  constructor(file, { rootAgentId, ...io } = {}) {
    this.file = resolve(file); this.#context = getOwnershipContext(this.file); this.rootAgentId = rootAgentId;
    this.io = { readFile, writeFile, rename, unlink, sleep, clock: Date.now, ...io };
  }
  #enqueue(fn) {
    const work = this.#context.queue.then(fn);
    this.#context.queue = work.catch(() => {}); return work;
  }
  async #owned(fn) {
    const acquired = !this.#context.session;
    if (acquired) {
      await mkdir(dirname(this.file), { recursive: true });
      this.#context.session = await acquireOwnership(this.file);
    }
    if (!this.#joined) { this.#joined = true; this.#context.users++; }
    try { return await fn(); }
    catch (error) {
      if (acquired) {
        try { await releaseOwnership(this.file, this.#context.session.nonce); }
        catch (cause) { try { error.cause ??= cause; } catch { /* Preserve even immutable thrown values. */ } }
        finally { this.#context.session = null; }
      }
      throw error;
    }
  }
  async #assertOwnership() {
    try {
      const record = JSON.parse(await this.io.readFile(ownerRecordPath(this.file), 'utf8'));
      if (record.nonce === this.#context.session?.nonce) return;
    } catch { /* Missing, corrupt and unreadable ownership all fail closed. */ }
    throw new OwnershipError(OWNERSHIP_RELEASE_MISMATCH);
  }
  // Drain accepted changes; the last joined store releases the process session.
  // Release errors reject close, but clear the session so fresh stores attempt admission anew.
  close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    return this.#closing = this.#enqueue(async () => {
      if (!this.#joined) return;
      this.#joined = false;
      if (--this.#context.users === 0 && this.#context.session) {
        try { await releaseOwnership(this.file, this.#context.session.nonce); }
        finally { this.#context.session = null; }
      }
    });
  }
  async read(projectIdeas = true) {
    try {
      const data = JSON.parse((await this.io.readFile(this.file, 'utf8')).replace(/^﻿/, ''));
      validateState(data);
      if (projectIdeas) for (const idea of data.ideas ?? []) for (const revision of idea.revisions)
        Object.assign(revision, ideaDefaults(revision));
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') {
        const state = migrateState({ schemaVersion: 1, revision: 0, questions: [], answers: [] });
        this.#missingStates.add(state); return state;
      }
      if (e instanceof SyntaxError) throw new DeskError('Datendatei nicht lesbar. Sie wurde nicht überschrieben.', 503);
      throw e;
    }
  }
  async #readWithMeta() {
    // Preserve read overrides; provenance belongs to this state, not the latest concurrent read.
    const state = await this.read(false);
    return { state, existed: !this.#missingStates.has(state) };
  }
  async #rename(from, to) {
    const delays = [10, 20, 40, 80, 100]; let original;
    for (let retry = 0; ; retry++) {
      try { return await this.io.rename(from, to); }
      catch (error) {
        original ??= error;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
          if (error !== original) {
            try { error.cause = original; } catch { /* Preserve even immutable errors. */ }
          }
          throw error;
        }
        if (retry === delays.length) throw original;
        await this.io.sleep(delays[retry]);
      }
    }
  }
  // All instances on this ledger share admission and the read-modify-write queue.
  change(fn) {
    if (this.#closed) return Promise.reject(new OwnershipError(OWNERSHIP_RELEASE_MISMATCH));
    return this.#enqueue(() => this.#owned(async () => {
      await this.#assertOwnership();
      const { state, existed } = await this.#readWithMeta();
      const before = JSON.stringify(state); const oldSchema = state.schemaVersion; const result = await fn(state, existed);
      if (JSON.stringify(state) === before) return result;
      await this.#assertOwnership();
      state.revision++;
      validateState(state);
      await mkdir(dirname(this.file), { recursive: true });
      if (oldSchema === 1 && state.schemaVersion === 2) {
        let original;
        try { original = await this.io.readFile(this.file); } catch (e) {
          if (e.code === 'ENOENT') throw new DeskError('Migrationsquelle fehlt; explizite Migration abgelehnt.', 404);
          throw e;
        }
        ensure(JSON.stringify(JSON.parse(original.toString('utf8').replace(/^﻿/, ''))) === before, 'Stand vor Migration verändert.', 409);
        const backup = `${this.file}.v1-backup`;
        try { await this.io.writeFile(backup, original, { flag: 'wx', mode: 0o600, flush: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        // Secure existing backups before the equality reject path; Windows ACLs are not handled here.
        if (process.platform !== 'win32') {
          try { await chmod(backup, 0o600); }
          catch { throw new DeskError('Migrationsbackup konnte nicht abgesichert werden.', 503); }
        }
        ensure((await this.io.readFile(backup)).equals(original), 'Migrationsbackup stimmt nicht mit dem Altstand überein.', 503);
      }
      const temp = `${this.file}.${randomUUID()}.tmp`;
      const backupTemp = `${temp}.previous`;
      try {
        await this.io.writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600, flush: true });
        try {
          // copyFile inherits legacy permissions; create the copy privately instead.
          await writeFile(backupTemp, await this.io.readFile(this.file), { flag: 'wx', mode: 0o600, flush: true });
          await this.#rename(backupTemp, `${this.file}.previous`);
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await this.#rename(temp, this.file);
      } catch (error) {
        for (const path of [temp, backupTemp]) {
          try { await this.io.unlink(path); }
          catch (cause) {
            if (cause.code !== 'ENOENT') {
              try { error.cause ??= cause; } catch { /* Preserve the original failure. */ }
            }
          }
        }
        throw error;
      }
      return result;
    }));
  }
  migrate(expectedRevision) {
    ensure(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Ungültige expectedRevision.');
    return this.change((state, existed) => {
      if (!existed) throw new DeskError('Migrationsquelle fehlt; explizite Migration abgelehnt.', 404);
      if (state.schemaVersion === 2) return state;
      ensure(state.revision === expectedRevision, 'Stand vor Migration verändert.', 409);
      Object.assign(state, migrateState(state));
      return state;
    });
  }
}
