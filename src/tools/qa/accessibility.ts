import { z } from 'zod';
import type { Tool } from '../types.js';
import { getOrCreatePage } from '../browser/mod.js';
import { AxeBuilder } from '@axe-core/playwright';
import { recordAssertion } from './report.js';

/**
 * QA Accessibility Auditing (Phase 10).
 * Uses @axe-core/playwright (axe-core) to scan the current page for
 * accessibility violations (WCAG, etc.).
 * Runs via page.evaluate under the hood.
 * Results are structured by severity and also fed into the active QA report
 * (as a synthetic assertion entry so they appear in /qa-run reports etc).
 */

export interface QaAccessibilityTools {
  accessibilityAudit: Tool<Record<string, never>>;
}

export interface QaAccessibilityConfig {
  tmpDir: string;
  headless?: boolean;
}

export async function createQaAccessibilityTools(config: QaAccessibilityConfig): Promise<QaAccessibilityTools> {
  const { tmpDir, headless = true } = config;

  const accessibilityAudit: Tool<Record<string, never>> = {
    name: 'qa_accessibility_audit',
    description:
      'QA accessibility audit: Runs axe-core on the current page (and frames) to detect WCAG/ARIA/etc violations. Returns structured JSON grouped by severity: critical, serious, moderate, minor. Each violation includes id, help, helpUrl, and affected node count. Critical/serious issues are highlighted. If an active QA report is collecting (e.g. during /qa-run or after using qa_assert_*), the audit result is also recorded as a report entry. Call after navigation or significant UI changes. No parameters.',
    inputSchema: z.object({}),
    execute: async () => {
      const page = await getOrCreatePage(tmpDir, headless);
      const results = await new AxeBuilder({ page }).analyze();

      const violations = results.violations || [];

      // Group by impact (severity)
      const bySeverity: Record<string, any[]> = {
        critical: [],
        serious: [],
        moderate: [],
        minor: [],
        unknown: [],
      };

      for (const v of violations) {
        const sev = (v.impact || 'unknown') as string;
        const entry = {
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes ? v.nodes.length : 0,
        };
        if (bySeverity[sev]) {
          bySeverity[sev].push(entry);
        } else {
          bySeverity.unknown!.push(entry);
        }
      }

      const critical = (bySeverity.critical || []).length;
      const serious = (bySeverity.serious || []).length;
      const moderate = (bySeverity.moderate || []).length;
      const minor = (bySeverity.minor || []).length;
      const total = violations.length;

      const summary = total === 0
        ? 'No accessibility violations found.'
        : `Found ${total} violations: ${critical} critical, ${serious} serious, ${moderate} moderate, ${minor} minor.`;

      const structured = {
        summary,
        violations: bySeverity,
        passes: (results.passes || []).length,
        incomplete: (results.incomplete || []).length,
      };

      // Integrate with QA report collector (if active report from assertions or /qa-run)
      // Record as a synthetic assertion entry so a11y findings appear in structured QA reports.
      const hasSeriousIssues = critical + serious > 0;
      const reportName = 'Accessibility audit';
      const reportResult = {
        passed: !hasSeriousIssues,
        expected: 'no critical or serious accessibility violations',
        actual: summary,
        message: hasSeriousIssues
          ? `Accessibility issues detected. Review critical/serious first. Full details in tool output.`
          : 'Page passes critical/serious a11y checks (minor/moderate may still exist).',
      };
      // duration n/a
      recordAssertion(reportName, reportResult);

      return {
        ok: true,
        content: JSON.stringify(structured, null, 2),
        metadata: {
          totalViolations: total,
          critical,
          serious,
          moderate,
          minor,
          hasSeriousIssues,
        },
      };
    },
  };

  return { accessibilityAudit };
}
