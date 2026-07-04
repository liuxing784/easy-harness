import { describe, expect, it } from 'vitest';
import {
  extractRequirementTag,
  parseChromiumResults,
  parseRequirementP0Ids,
  parseCoverageWaivers,
  computeGateResult,
} from './e2e-run-lib.mjs';

describe('extractRequirementTag', () => {
  it('提取标题中的 [R-xxx] 标签', () => {
    expect(extractRequirementTag('[R-001] 用户可以登录')).toBe('R-001');
  });

  it('无标签时返回 null', () => {
    expect(extractRequirementTag('普通用例标题')).toBeNull();
  });

  it('非字符串输入返回 null', () => {
    // @ts-expect-error 测试非法输入的健壮性
    expect(extractRequirementTag(undefined)).toBeNull();
  });
});

describe('parseChromiumResults', () => {
  it('只解析 chromium project，忽略 firefox/webkit（Chrome-only 唯一简化维度）', () => {
    const report = {
      suites: [
        {
          file: 'login.spec.ts',
          specs: [
            {
              title: '[R-001] 登录成功',
              tests: [
                { projectName: 'chromium', results: [{ status: 'passed' }] },
                { projectName: 'firefox', results: [{ status: 'passed' }] },
                { projectName: 'webkit', results: [{ status: 'failed' }] },
              ],
            },
          ],
          suites: [],
        },
      ],
    };
    const results = parseChromiumResults(report);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'R-001', status: 'passed' });
  });

  it('递归解析嵌套 suite', () => {
    const report = {
      suites: [
        {
          file: 'outer.spec.ts',
          specs: [],
          suites: [
            {
              file: 'outer.spec.ts',
              specs: [
                {
                  title: '[R-002] 嵌套用例',
                  tests: [{ projectName: 'chromium', results: [{ status: 'failed' }] }],
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    };
    const results = parseChromiumResults(report);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'R-002', status: 'failed' });
  });

  it('空/缺失 suites 返回空数组', () => {
    expect(parseChromiumResults(null)).toEqual([]);
    expect(parseChromiumResults({})).toEqual([]);
  });
});

describe('parseRequirementP0Ids', () => {
  it('提取优先级为 P0 的需求编号', () => {
    const content = `# 需求清单

| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |
| -------- | -------- | -------- | -------- | ---------- | -------- | ---- |
| R-001 | 登录 | | 场景 | P0 | 用户确认 | 已确认 |
| R-002 | 导出 | | 场景 | P1 | 用户确认 | 已确认 |
| R-003 | 找回密码 | | 场景 | P0 | 用户确认 | 已确认 |
`;
    expect(parseRequirementP0Ids(content)).toEqual(['R-001', 'R-003']);
  });

  it('空内容返回空数组', () => {
    expect(parseRequirementP0Ids('')).toEqual([]);
    expect(parseRequirementP0Ids(null as unknown as string)).toEqual([]);
  });
});

describe('parseCoverageWaivers', () => {
  it('只接受含 reason 说明的豁免项', () => {
    const content = JSON.stringify({
      waivers: [
        { id: 'R-010', reason: '无 UI，人工核查' },
        { id: 'R-011' }, // 缺 reason，不生效
      ],
    });
    const waived = parseCoverageWaivers(content);
    expect(waived.has('R-010')).toBe(true);
    expect(waived.has('R-011')).toBe(false);
  });

  it('支持数组根格式', () => {
    const content = JSON.stringify([{ id: 'R-020', reason: '说明' }]);
    expect(parseCoverageWaivers(content).has('R-020')).toBe(true);
  });

  it('非法 JSON 返回空集合', () => {
    expect(parseCoverageWaivers('not-json').size).toBe(0);
  });
});

describe('computeGateResult', () => {
  it('全部通过且覆盖率完整时 gatePassed=true', () => {
    const results = [
      { id: 'R-001', status: 'passed' },
      { id: 'R-002', status: 'passed' },
    ];
    const gate = computeGateResult(results, ['R-001', 'R-002']);
    expect(gate.gatePassed).toBe(true);
    expect(gate.missingIds).toEqual([]);
  });

  it('存在失败用例时 gatePassed=false', () => {
    const results = [
      { id: 'R-001', status: 'passed' },
      { id: 'R-002', status: 'failed' },
    ];
    const gate = computeGateResult(results, ['R-001', 'R-002']);
    expect(gate.allPassed).toBe(false);
    expect(gate.gatePassed).toBe(false);
  });

  it('required id 未被覆盖时 coverageComplete=false', () => {
    const results = [{ id: 'R-001', status: 'passed' }];
    const gate = computeGateResult(results, ['R-001', 'R-002']);
    expect(gate.coverageComplete).toBe(false);
    expect(gate.missingIds).toEqual(['R-002']);
    expect(gate.gatePassed).toBe(false);
  });

  it('未解释的 skip 导致 coverageComplete=false', () => {
    const results = [
      { id: 'R-001', status: 'passed' },
      { id: 'R-002', status: 'skipped' },
    ];
    const gate = computeGateResult(results, ['R-001']);
    expect(gate.unexplainedSkips).toEqual(['R-002']);
    expect(gate.gatePassed).toBe(false);
  });

  it('已登记豁免的 skip 不计入未解释 skip，也不计入 missingIds', () => {
    const results = [
      { id: 'R-001', status: 'passed' },
      { id: 'R-002', status: 'skipped' },
    ];
    const waived = new Set(['R-002']);
    const gate = computeGateResult(results, ['R-001', 'R-002'], waived);
    expect(gate.unexplainedSkips).toEqual([]);
    expect(gate.missingIds).toEqual([]);
    expect(gate.gatePassed).toBe(true);
  });
});
