import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '../../src/tools/registry.js';
import {
  executeScenarioSteps,
  createQaSaveScenarioTool,
  type QaScenario,
} from '../../src/tools/qa/scenario-runner.js';
import { withQaReportCollector, __resetQaReportForTest } from '../../src/tools/qa/report.js';
import { saveQaScenario, loadQaScenario, listQaScenarios } from '../../src/storage/qa-scenarios.js';

describe('qa scenarios storage (Phase 7)', () => {
  let tmpData: string;

  beforeEach(async () => {
    tmpData = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-scen-storage-'));
  });

  afterEach(async () => {
    await rm(tmpData, { recursive: true, force: true });
  });

  it('save / load roundtrip + list', async () => {
    const scen: QaScenario = {
      name: 'login-test',
      description: 'basic login',
      baseUrl: 'https://example.com',
      steps: [
        { action: 'navigate', url: '/login' },
        { action: 'fill', selector: 'input[name=email]', value: '$TEST_EMAIL' },
      ],
    };

    const saved = await saveQaScenario(tmpData, scen);
    expect(saved).toBe('login-test');

    const loaded = await loadQaScenario(tmpData, 'login-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('login-test');
    expect(loaded!.steps.length).toBe(2);
    expect(loaded!.baseUrl).toBe('https://example.com');

    const list = await listQaScenarios(tmpData);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('login-test');
    expect(list[0].stepCount).toBe(2);
  });

  it('normalizes names on save and load', async () => {
    const scen = { name: 'My Cool Flow!', steps: [{ action: 'navigate', url: 'https://x' }] } as QaScenario;
    await saveQaScenario(tmpData, scen);
    const loaded = await loadQaScenario(tmpData, 'my-cool-flow');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('my-cool-flow');
  });
});

describe('qa scenario substitution + executor (Phase 7)', () => {
  let testReg: ToolRegistry;

  beforeEach(() => {
    __resetQaReportForTest();
    testReg = new ToolRegistry();

    // Register minimal fakes for the actions we exercise
    const fakeOk = (name: string) =>
      testReg.register({
        name,
        description: 'fake for test',
        inputSchema: z.object({}).passthrough(),
        execute: async (args: any) => ({
          ok: true,
          content: JSON.stringify({ ok: true, called: name, args }),
        }),
      });

    fakeOk('browser_navigate');
    fakeOk('browser_fill');
    fakeOk('browser_click');
    fakeOk('browser_wait_for');
    fakeOk('browser_reset');

    // For assert tests, the fake can also simulate the record side-effect if we want full integration
    testReg.register({
      name: 'qa_assert_visible',
      description: 'fake assert',
      inputSchema: z.object({}).passthrough(),
      execute: async (args: any) => {
        // Simulate what the real one does: record if active
        // (in real run the record is inside the assert tool impl)
        return { ok: true, content: JSON.stringify({ passed: true, ...args }) };
      },
    });
  });

  afterEach(() => {
    __resetQaReportForTest();
  });

  it('substitutes $TEST_* placeholders (both naming styles) at execution time', async () => {
    const scen: QaScenario = {
      name: 'cred-test',
      steps: [
        { action: 'fill', selector: 'input#e', value: '$TEST_EMAIL' },
        { action: 'fill', selector: 'input#p', value: '$TEST_ACCOUNT_PASSWORD' },
      ],
    };
    const creds = { email: 'user@ex.com', password: 's3cr3t' };

    const calls: any[] = [];
    const captureReg = new ToolRegistry();
    captureReg.register({
      name: 'browser_fill',
      description: 'cap',
      inputSchema: z.object({}).passthrough(),
      execute: async (a: any) => {
        calls.push(a);
        return { ok: true, content: 'ok' };
      },
    });

    await executeScenarioSteps(scen, { testCredentials: creds, registry: captureReg });
    expect(calls.length).toBe(2);
    expect(calls[0].value).toBe('user@ex.com');
    expect(calls[1].value).toBe('s3cr3t');
  });

  it('maps extended scenario actions to the correct tools', async () => {
    const calls: string[] = [];
    const capReg = new ToolRegistry();
    const capture = (name: string) => {
      capReg.register({
        name,
        description: 'cap',
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          calls.push(name);
          return { ok: true, content: 'ok' };
        },
      });
    };
    [
      'browser_navigate',
      'browser_inspect_form',
      'browser_screenshot',
      'browser_set_viewport',
      'qa_accessibility_audit',
      'qa_check_console_errors',
      'qa_check_network_failures',
      'qa_intercept_api',
      'qa_assert_status',
    ].forEach(capture);

    const scen: QaScenario = {
      name: 'extended',
      steps: [
        { action: 'navigate', url: 'https://example.com' },
        { action: 'inspect_form' },
        { action: 'screenshot', path: 'shot.png' },
        { action: 'set_viewport', preset: 'mobile' },
        { action: 'accessibility_audit' },
        { action: 'check_console_errors' },
        { action: 'check_network_failures' },
        { action: 'intercept_api', apiPattern: '/api/user' },
        { action: 'assert_status', expected: 200 },
      ],
    };

    await executeScenarioSteps(scen, { registry: capReg });
    expect(calls).toEqual([
      'browser_navigate',
      'browser_inspect_form',
      'browser_screenshot',
      'browser_set_viewport',
      'qa_accessibility_audit',
      'qa_check_console_errors',
      'qa_check_network_failures',
      'qa_intercept_api',
      'qa_assert_status',
    ]);
  });

  it('executes steps via registry and counts success/failure', async () => {
    const scen: QaScenario = {
      name: 'simple',
      steps: [
        { action: 'navigate', url: 'https://example.com' },
        { action: 'fill', selector: '#e', value: 'foo' },
        { action: 'click', text: 'Go' },
      ],
    };

    const res = await executeScenarioSteps(scen, { registry: testReg });
    expect(res.executed).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.errors.length).toBe(0);
  });

  it('records failures for bad steps but continues', async () => {
    // one unknown action
    const scen: QaScenario = {
      name: 'mixed',
      steps: [
        { action: 'navigate', url: 'https://x' },
        { action: 'no-such-action-ever' },
        { action: 'reset' },
      ],
    };

    const res = await executeScenarioSteps(scen, { registry: testReg });
    expect(res.executed).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toMatch(/unknown/);
  });

  it('assert steps work with active report collector (records via real mechanism when using real tools, here we just run)', async () => {
    const scen: QaScenario = {
      name: 'with-assert',
      steps: [{ action: 'assert_visible', selector: '.ok', name: 'thing visible' }],
    };
    const { result: res, report } = await withQaReportCollector('scenario test run', () =>
      executeScenarioSteps(scen, { registry: testReg })
    );
    expect(res.executed).toBe(1);
    expect(report).toBeNull();
  });
});

describe('qa_save_scenario tool (Phase 7)', () => {
  let tmpData: string;
  let saveTool: ReturnType<typeof createQaSaveScenarioTool>;

  beforeEach(async () => {
    tmpData = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-scen-tool-'));
    saveTool = createQaSaveScenarioTool({ dataDir: tmpData });
  });

  afterEach(async () => {
    await rm(tmpData, { recursive: true, force: true });
  });

  it('saves via tool and can be loaded', async () => {
    const input = {
      name: 'tool-saved',
      description: 'from tool test',
      steps: [{ action: 'navigate', url: 'https://t' }],
    };
    const res = await saveTool.execute(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('tool-saved');
    }

    const loaded = await loadQaScenario(tmpData, 'tool-saved');
    expect(loaded).not.toBeNull();
    expect(loaded!.description).toBe('from tool test');
  });

  it('rejects bad input', async () => {
    const res = await saveTool.execute({ steps: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/name|steps/);
  });
});
