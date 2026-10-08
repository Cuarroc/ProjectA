// DeskStore core (DR-03): read, serialized atomic change and explicit V1->V2 migration.
// Ledger operations (questions, answers, receipts, progress, patches, delivery) compose
// `change` in DR-04; the root agent id is injected and never defaulted here (D2).
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeskError, ensure, ideaDefaults, migrateState, validateState } from './model.mjs';

export class DeskStore {
  #queue = Promise.resolve();
  constructor(file, { rootAgentId, ...io } = {}) {
    this.file = file; this.rootAgentId = rootAgentId; this.io = { writeFile, rename, clock: Date.now, ...io };
  }
  async read(projectIdeas = true) {
    try {
      const data = JSON.parse((await readFile(this.file, 'utf8')).replace(/^﻿/, ''));
      validateState(data);
      if (projectIdeas) for (const idea of data.ideas ?? []) for (const revision of idea.revisions)
        Object.assign(revision, ideaDefaults(revision));
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') return { schemaVersion: 1, revision: 0, questions: [], answers: [] };
      if (e instanceof SyntaxError) throw new DeskError('Datendatei nicht lesbar. Sie wurde nicht überschrieben.', 503);
      throw e;
    }
  }
  // Runs fn(state) after every earlier change; writes only when the state actually changed.
  change(fn) {
    const work = this.#queue.then(async () => {
      const state = await this.read(false); const before = JSON.stringify(state); const oldSchema = state.schemaVersion; const result = await fn(state);
      if (JSON.stringify(state) === before) return result;
      state.revision++;
      validateState(state);
      await mkdir(dirname(this.file), { recursive: true });
      if (oldSchema === 1 && state.schemaVersion === 2) {
        let original;
        try { original = await readFile(this.file); } catch (e) {
          if (e.code === 'ENOENT') throw new DeskError('Migrationsquelle fehlt; explizite Migration abgelehnt.', 404);
          throw e;
        }
        ensure(JSON.stringify(JSON.parse(original.toString('utf8').replace(/^﻿/, ''))) === before, 'Stand vor Migration verändert.', 409);
        const backup = `${this.file}.v1-backup`;
        try { await this.io.writeFile(backup, original, { flag: 'wx', mode: 0o600, flush: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        ensure((await readFile(backup)).equals(original), 'Migrationsbackup stimmt nicht mit dem Altstand überein.', 503);
      }
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await this.io.writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600, flush: true });
      const backupTemp = `${temp}.previous`;
      try {
        await copyFile(this.file, backupTemp);
        await this.io.rename(backupTemp, `${this.file}.previous`);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await this.io.rename(temp, this.file);
      return result;
    });
    this.#queue = work.catch(() => {}); return work;
  }
  migrate(expectedRevision) {
    ensure(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Ungültige expectedRevision.');
    return this.change(state => {
      if (state.schemaVersion === 2) return state;
      ensure(state.revision === expectedRevision, 'Stand vor Migration verändert.', 409);
      Object.assign(state, migrateState(state));
      return state;
    });
  }
}
