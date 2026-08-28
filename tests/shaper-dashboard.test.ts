import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardPath = join(process.cwd(), 'shaper-dashboards', 'command-centre.dashboard.sql');

describe('Shaper dashboard artifact', () => {
  it('contains the six requested read-only views and uses only exported files', () => {
    const sql = readFileSync(dashboardPath, 'utf8');
    for (const section of [
      'Major Command Centre',
      'Provider Performance',
      'Token Economics',
      'Worker Performance',
      'Project Activity',
      'Failure Analysis',
    ]) {
      expect(sql).toContain(`SELECT '${section}'::SECTION;`);
    }
    expect(sql.match(/::SECTION/g)).toHaveLength(6);
    expect(sql.match(/read_csv_auto/g)).not.toBeNull();
    expect(sql).toContain("read_csv_auto('major-command-centre.csv', header = true)");
    expect(sql).toContain("read_csv_auto('major-run-telemetry.csv', header = true)");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|ATTACH|COPY)\b/i);
  });
});
