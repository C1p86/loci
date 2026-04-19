import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { type NewTask, tasks } from '../db/schema.js';
import type { TriggerConfig } from '../plugins-trigger/types.js';
import { DatabaseError, TaskNameConflictError } from '../errors.js';

/**
 * D-29: Org-scoped repo for task definitions.
 * All queries include eq(tasks.orgId, orgId) in their WHERE clause.
 * Never exported from repos/index.ts (D-01 discipline).
 */
export function makeTasksRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * List tasks for this org (metadata only — no yamlDefinition per D-10 lean list view).
     */
    async list() {
      return db
        .select({
          id: tasks.id,
          name: tasks.name,
          description: tasks.description,
          labelRequirements: tasks.labelRequirements,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(eq(tasks.orgId, orgId))
        .orderBy(desc(tasks.createdAt));
    },

    /**
     * Get full task row (including yamlDefinition) by ID, scoped to this org.
     * Returns undefined if not found.
     */
    async getById(taskId: string) {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)))
        .limit(1);
      return rows[0];
    },

    /**
     * Create a new task. Catches PG 23505 (tasks_org_name_unique) -> TaskNameConflictError.
     * Returns { id } of the new task.
     */
    async create(params: {
      name: string;
      description?: string;
      yamlDefinition: string;
      labelRequirements?: string[];
      createdByUserId: string;
    }): Promise<{ id: string }> {
      const id = generateId('tsk');
      const payload = {
        id,
        orgId,
        name: params.name,
        description: params.description ?? '',
        yamlDefinition: params.yamlDefinition,
        labelRequirements: params.labelRequirements ?? [],
        createdByUserId: params.createdByUserId,
      } satisfies NewTask;
      try {
        await db.insert(tasks).values(payload);
      } catch (err) {
        const pgCode =
          (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '23505') {
          throw new TaskNameConflictError();
        }
        throw new DatabaseError('tasks.create failed', err);
      }
      return { id };
    },

    /**
     * Update an existing task. Catches PG 23505 -> TaskNameConflictError.
     * Returns { rowCount } (route treats 0 as TaskNotFoundError).
     */
    async update(
      taskId: string,
      params: Partial<{
        name: string;
        description: string;
        yamlDefinition: string;
        labelRequirements: string[];
      }>,
    ): Promise<{ rowCount: number }> {
      try {
        const result = await db
          .update(tasks)
          .set({ ...params, updatedAt: sql`now()` })
          .where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)))
          .returning({ id: tasks.id });
        return { rowCount: result.length };
      } catch (err) {
        const pgCode =
          (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '23505') {
          throw new TaskNameConflictError();
        }
        throw new DatabaseError('tasks.update failed', err);
      }
    },

    /**
     * Plan 12-03: List tasks that have at least one trigger config.
     * Returns [{id, triggerConfigs}] for all tasks with a non-empty trigger_configs array.
     * Used by the webhook shared handler to find candidate tasks for mapToTask.
     * Scoped to this org via eq(tasks.orgId, orgId).
     */
    async listTriggerable(): Promise<Array<{ id: string; triggerConfigs: TriggerConfig[] }>> {
      const rows = await db
        .select({ id: tasks.id, triggerConfigs: tasks.triggerConfigs })
        .from(tasks)
        .where(and(eq(tasks.orgId, orgId), sql`jsonb_array_length(trigger_configs) > 0`));
      return rows as Array<{ id: string; triggerConfigs: TriggerConfig[] }>;
    },

    /**
     * Delete a task scoped to this org.
     * Returns rows-affected count (route treats 0 as TaskNotFoundError).
     */
    async delete(taskId: string): Promise<{ rowCount: number }> {
      const result = await db
        .delete(tasks)
        .where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)))
        .returning({ id: tasks.id });
      return { rowCount: result.length };
    },
  };
}

export type TasksRepo = ReturnType<typeof makeTasksRepo>;
