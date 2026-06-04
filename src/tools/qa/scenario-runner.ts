import { z } from 'zod';
import type { Tool } from '../types.js';
import { toolRegistry, type ToolRegistry } from '../registry.js';
import {
  saveQaScenario,
  loadQaScenario,
  listQaScenarios,
} from '../../storage/qa-scenarios.js';
import type { TestCredentials } from '../../config/env.js';

export interface ScenarioStep {
  action: string;
  url?: string | undefined;
  selector?: string | undefined;
  text?: string | undefined;
  value?: string | undefined;
  pattern?: string | undefined;
  mode?: 'exact' | 'contains' | 'regex' | undefined;
  expected?: number | undefined;
  state?: 'visible' | 'hidden' | 'attached' | 'detached' | undefined;
  timeoutMs?: number | undefined;
  name?: string | undefined; // optional label for qa_assert_* in reports
  preset?: string | undefined; // browser_set_viewport preset
  width?: number | undefined;
  height?: number | undefined;
  path?: string | undefined; // screenshot filename
  fullPage?: boolean | undefined;
  apiPattern?: string | undefined; // qa_intercept_api pattern
}

export interface QaScenario {
  name: string;
  description?: string | undefined;
  baseUrl?: string | undefined;
  steps: ScenarioStep[];
}

/**
 * Substitute credential placeholders in a string value.
 * Supports legacy $TEST_EMAIL / $TEST_PASSWORD / $TEST_ACCOUNT_*
 * Phase 8: $TEST_CREDENTIALS_<APP>_EMAIL / _PASSWORD (e.g. $TEST_CREDENTIALS_CLOUDCASTAI_EMAIL)
 * Only substitutes at execution time; stored scenarios keep the $VAR forms.
 */
function substitute(value: string | undefined, legacy?: TestCredentials, apps?: Record<string, TestCredentials>): string | undefined {
  if (typeof value !== 'string') return value;
  let out = value;
  if (legacy) {
    out = out
      .replace(/\$TEST_EMAIL\b/g, legacy.email)
      .replace(/\$TEST_ACCOUNT_EMAIL\b/g, legacy.email)
      .replace(/\$TEST_PASSWORD\b/g, legacy.password)
      .replace(/\$TEST_ACCOUNT_PASSWORD\b/g, legacy.password);
  }
  if (apps) {
    for (const [app, c] of Object.entries(apps)) {
      const reEmail = new RegExp(`\\$TEST_CREDENTIALS_${app}_EMAIL\\b`, 'gi');
      const rePass = new RegExp(`\\$TEST_CREDENTIALS_${app}_PASSWORD\\b`, 'gi');
      out = out.replace(reEmail, c.email).replace(rePass, c.password);
    }
  }
  return out;
}

function substituteStep(step: ScenarioStep, legacy?: TestCredentials, apps?: Record<string, TestCredentials>): ScenarioStep {
  const s: ScenarioStep = { ...step };
  if (s.url != null) {
    const su = substitute(s.url, legacy, apps);
    s.url = su != null ? su : undefined;
  }
  if (s.value != null) {
    const sv = substitute(s.value, legacy, apps);
    s.value = sv != null ? sv : undefined;
  }
  if (s.text != null) {
    const st = substitute(s.text, legacy, apps);
    s.text = st != null ? st : undefined;
  }
  if (s.pattern != null) {
    const sp = substitute(s.pattern, legacy, apps);
    s.pattern = sp != null ? sp : undefined;
  }
  return s;
}

/**
 * Map a (substituted) step to a tool name + args for execution via registry.
 * Returns isAssert:true for qa_assert_* so callers know they feed the report collector.
 */
function mapStepToTool(
  step: ScenarioStep,
  baseUrl?: string
): { name: string; args: Record<string, unknown>; isAssert?: boolean } | null {
  let url = step.url;
  if (url && baseUrl && !/^https?:\/\//i.test(url)) {
    const b = baseUrl.replace(/\/+$/, '');
    const u = url.startsWith('/') ? url : `/${url}`;
    url = `${b}${u}`;
  }

  switch (step.action) {
    case 'navigate':
      if (!url) return null;
      return { name: 'browser_navigate', args: { url } };

    case 'click':
      return { name: 'browser_click', args: { selector: step.selector, text: step.text } };

    case 'fill':
      if (!step.selector || step.value == null) return null;
      return { name: 'browser_fill', args: { selector: step.selector, value: step.value } };

    case 'assert_visible':
      return {
        name: 'qa_assert_visible',
        args: { name: step.name, selector: step.selector, text: step.text },
        isAssert: true,
      };

    case 'assert_not_visible':
      return {
        name: 'qa_assert_not_visible',
        args: { name: step.name, selector: step.selector, text: step.text },
        isAssert: true,
      };

    case 'assert_text_contains':
      if (!step.text) return null;
      return {
        name: 'qa_assert_text_contains',
        args: { name: step.name, selector: step.selector, text: step.text },
        isAssert: true,
      };

    case 'assert_url':
      if (!step.pattern) return null;
      return {
        name: 'qa_assert_url',
        args: { name: step.name, pattern: step.pattern, mode: step.mode },
        isAssert: true,
      };

    case 'assert_element_count':
      if (!step.selector || typeof step.expected !== 'number') return null;
      return {
        name: 'qa_assert_element_count',
        args: { name: step.name, selector: step.selector, expected: step.expected },
        isAssert: true,
      };

    case 'assert_status':
      if (typeof step.expected !== 'number') return null;
      return {
        name: 'qa_assert_status',
        args: { name: step.name, expected: step.expected },
        isAssert: true,
      };

    case 'inspect_form':
      return { name: 'browser_inspect_form', args: {} };

    case 'screenshot':
      return {
        name: 'browser_screenshot',
        args: { path: step.path, fullPage: step.fullPage },
      };

    case 'set_viewport':
      return {
        name: 'browser_set_viewport',
        args: { preset: step.preset, width: step.width, height: step.height },
      };

    case 'accessibility_audit':
    case 'a11y_audit':
      return { name: 'qa_accessibility_audit', args: {}, isAssert: true };

    case 'check_console_errors':
      return { name: 'qa_check_console_errors', args: {} };

    case 'check_network_failures':
      return { name: 'qa_check_network_failures', args: {} };

    case 'intercept_api':
      if (!step.apiPattern && !step.pattern) return null;
      return {
        name: 'qa_intercept_api',
        args: { pattern: step.apiPattern || step.pattern },
      };

    case 'extract_text':
      return {
        name: 'browser_extract_text',
        args: { selector: step.selector },
      };

    case 'wait_for':
      if (!step.selector) return null;
      return {
        name: 'browser_wait_for',
        args: { selector: step.selector, state: step.state, timeoutMs: step.timeoutMs },
      };

    case 'wait_for_network_idle':
      return { name: 'browser_wait_for_network_idle', args: { timeoutMs: step.timeoutMs } };

    case 'wait_for_text':
      if (!step.text) return null;
      return { name: 'browser_wait_for_text', args: { text: step.text, timeoutMs: step.timeoutMs } };

    case 'reset':
      return { name: 'browser_reset', args: {} };

    default:
      return null;
  }
}

/**
 * Execute the steps of a scenario sequentially using the global tool registry.
 * - Variable substitution is performed (using provided creds).
 * - Assertions automatically feed the active QA report collector (via their own recordAssertion).
 * - Non-assertion steps (nav, fill, click, wait) run directly; failures are collected but execution continues.
 * Returns summary of what happened (no report here — caller manages start/endQaReport).
 */
export async function executeScenarioSteps(
  scenario: QaScenario,
  options: { testCredentials?: TestCredentials | undefined; appCredentials?: Record<string, TestCredentials> | undefined; registry?: ToolRegistry } = {}
): Promise<{ executed: number; failed: number; errors: string[] }> {
  const { testCredentials, appCredentials, registry } = options;
  const reg = registry ?? toolRegistry;
  const errors: string[] = [];
  let executed = 0;
  let failed = 0;

  const subbedSteps = scenario.steps.map((st) => substituteStep(st, testCredentials, appCredentials));

  for (let i = 0; i < subbedSteps.length; i++) {
    const step = subbedSteps[i]!;
    const call = mapStepToTool(step, scenario.baseUrl);
    if (!call) {
      errors.push(`Step ${i + 1}: unknown or invalid action "${step.action}"`);
      failed++;
      continue;
    }

    try {
      const result = await reg.execute(call.name, call.args);
      executed++;
      if (!result.ok) {
        failed++;
        errors.push(`Step ${i + 1} (${step.action}): ${result.error || 'tool failed'}`);
      }
      // For asserts: they always return ok:true; pass/fail is inside content + they called recordAssertion.
      // We could parse here if we wanted to short-circuit, but per design we run all steps.
    } catch (err: any) {
      failed++;
      errors.push(`Step ${i + 1} (${step.action}) error: ${err?.message || String(err)}`);
    }
  }

  return { executed, failed, errors };
}

/**
 * Factory for the qa_save_scenario tool.
 * Registered so the agent (during normal runs or /qa-test) can persist flows it discovers.
 * Stored scenarios keep $VAR placeholders; substitution happens only on /qa-run execution.
 */
export function createQaSaveScenarioTool(config: { dataDir: string; testCredentials?: TestCredentials | undefined; appCredentials?: Record<string, TestCredentials> | undefined }): Tool<any> {
  const { dataDir, testCredentials, appCredentials } = config;

  const stepSchema = z
    .object({
      action: z.string().min(1).describe('Action name, e.g. navigate, fill, click, assert_visible, wait_for, ...'),
      url: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      value: z.string().optional(),
      pattern: z.string().optional(),
      mode: z.enum(['exact', 'contains', 'regex']).optional(),
      expected: z.number().int().optional(),
      state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
      timeoutMs: z.number().int().positive().max(30000).optional(),
      name: z.string().optional(),
      preset: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      path: z.string().optional(),
      fullPage: z.boolean().optional(),
      apiPattern: z.string().optional(),
    })
    .passthrough();

  return {
    name: 'qa_save_scenario',
    description:
      'Persist a reusable QA scenario (test plan) so it can be re-run later with /qa-run <name>. ' +
      'Provide a full scenario object: { name, description?, baseUrl?, steps: [...] }. ' +
      'Steps use documented actions (navigate/fill/click/assert_*/wait_*/inspect_form/screenshot/set_viewport/accessibility_audit/check_console_errors/check_network_failures/intercept_api). ' +
      'Use the literal placeholders $TEST_EMAIL and $TEST_PASSWORD (or $TEST_ACCOUNT_*) in "value" fields etc; they are resolved from environment at execution time only and are never stored literally. ' +
      'After saving, the owner can run it with /qa-run to get a fresh browser + full QA report from the assertions inside the scenario. ' +
      'The agent may call this after successfully exploring a flow in order to save it for regression.',
    inputSchema: z.object({
      name: z.string().min(1).describe('Unique short name for the scenario (used for /qa-run <name>)'),
      description: z.string().optional().describe('What this scenario tests'),
      baseUrl: z.string().optional().describe('Base URL for relative step urls (e.g. https://app.example.com)'),
      steps: z.array(stepSchema).min(1).describe('Array of step objects. See description for supported actions and $VAR rules.'),
    }),
    execute: async (input) => {
      try {
        if (!input.name || !Array.isArray(input.steps) || input.steps.length < 1) {
          return { ok: false, error: 'name (string) and steps (non-empty array) are required' };
        }
        // Defense-in-depth: never persist literal credential values (only $PLACEHOLDERS).
        // The model is instructed to use placeholders; this blocks accidents.
        const stepStr = JSON.stringify(input.steps);
        const allCreds: TestCredentials[] = [];
        if (testCredentials) allCreds.push(testCredentials);
        if (appCredentials) allCreds.push(...Object.values(appCredentials));
        for (const c of allCreds) {
          if (c.email && stepStr.includes(c.email)) {
            return { ok: false, error: 'Do not include literal test email in scenario steps. Use the appropriate $TEST_... or $TEST_CREDENTIALS_<APP>_EMAIL placeholder instead.' };
          }
          if (c.password && stepStr.includes(c.password)) {
            return { ok: false, error: 'Do not include literal test password in scenario steps. Use the appropriate $TEST_... or $TEST_CREDENTIALS_<APP>_PASSWORD placeholder instead.' };
          }
        }
        const savedName = await saveQaScenario(dataDir, input as unknown as QaScenario);
        return {
          ok: true,
          content: JSON.stringify(
            {
              saved: true,
              name: savedName,
              stepCount: input.steps.length,
              note: `Run with /qa-run ${savedName} (resets browser, executes steps, emits report for any qa_assert_* steps)`,
            },
            null,
            2
          ),
          metadata: { savedName, stepCount: input.steps.length },
        };
      } catch (err: any) {
        return { ok: false, error: `Failed to save scenario: ${err?.message || err}` };
      }
    },
  };
}

// Re-export storage list/load for the bot commands (types are the local interfaces above)
export { listQaScenarios, loadQaScenario };
