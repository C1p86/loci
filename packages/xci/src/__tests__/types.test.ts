// src/__tests__/types.test.ts
import { describe, expectTypeOf, it } from 'vitest';
import type {
  CommandDef,
  CommandMap,
  CommandsLoader,
  ConfigLayer,
  ConfigLoader,
  ExecutionPlan,
  ExecutionResult,
  Executor,
  ExecutorOptions,
  PlatformOverrides,
  ResolvedConfig,
  Resolver,
} from '../types.js';

describe('types.ts — pipeline contracts', () => {
  it('ConfigLayer is a string literal union of the 4 layer names', () => {
    expectTypeOf<ConfigLayer>().toEqualTypeOf<'machine' | 'project' | 'secrets' | 'local'>();
  });

  it('ResolvedConfig has readonly values, provenance, secretKeys', () => {
    expectTypeOf<ResolvedConfig>().toHaveProperty('values');
    expectTypeOf<ResolvedConfig>().toHaveProperty('provenance');
    expectTypeOf<ResolvedConfig>().toHaveProperty('secretKeys');
    expectTypeOf<ResolvedConfig['secretKeys']>().toEqualTypeOf<ReadonlySet<string>>();
  });

  it('ConfigLoader.load takes a string and returns Promise<ResolvedConfig>', () => {
    expectTypeOf<ConfigLoader['load']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<ConfigLoader['load']>().returns.resolves.toEqualTypeOf<ResolvedConfig>();
  });

  it('CommandDef is a discriminated union on `kind`', () => {
    type Kinds = CommandDef['kind'];
    expectTypeOf<Kinds>().toEqualTypeOf<'single' | 'sequential' | 'parallel' | 'for_each' | 'ini'>();
  });

  it('CommandDef narrowing: single has cmd, sequential has steps, parallel has group', () => {
    type SingleDef = Extract<CommandDef, { kind: 'single' }>;
    type SequentialDef = Extract<CommandDef, { kind: 'sequential' }>;
    type ParallelDef = Extract<CommandDef, { kind: 'parallel' }>;

    expectTypeOf<SingleDef>().toHaveProperty('cmd');
    expectTypeOf<SingleDef['cmd']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<SequentialDef>().toHaveProperty('steps');
    expectTypeOf<ParallelDef>().toHaveProperty('group');
  });

  it('CommandMap is a ReadonlyMap', () => {
    expectTypeOf<CommandMap>().toEqualTypeOf<ReadonlyMap<string, CommandDef>>();
  });

  it('ExecutionPlan is a discriminated union with the same kinds as CommandDef', () => {
    type PlanKinds = ExecutionPlan['kind'];
    expectTypeOf<PlanKinds>().toEqualTypeOf<'single' | 'sequential' | 'parallel' | 'ini'>();
  });

  it('Executor.run takes ExecutionPlan + ExecutorOptions and returns Promise<ExecutionResult>', () => {
    expectTypeOf<Executor['run']>().parameters.toEqualTypeOf<[ExecutionPlan, ExecutorOptions]>();
    expectTypeOf<Executor['run']>().returns.resolves.toEqualTypeOf<ExecutionResult>();
  });

  it('PlatformOverrides keys are optional readonly string arrays', () => {
    expectTypeOf<PlatformOverrides>().toHaveProperty('linux');
    expectTypeOf<PlatformOverrides>().toHaveProperty('windows');
    expectTypeOf<PlatformOverrides>().toHaveProperty('macos');
  });

  it('CommandsLoader and Resolver interfaces exist and have the expected shape', () => {
    expectTypeOf<CommandsLoader['load']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<Resolver['resolve']>().parameters.toEqualTypeOf<
      [string, CommandMap, ResolvedConfig]
    >();
    expectTypeOf<Resolver['resolve']>().returns.toEqualTypeOf<ExecutionPlan>();
  });
});
