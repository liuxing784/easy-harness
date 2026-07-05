# E2E 用例目录（`e2e/specs/**`）

本目录为**空骨架**，用例由 **test-engineer** 在测试阶段按项目实际需求编写与维护，不随 harness 模板预置任何产品相关用例（保持跨技术栈通用）。

## 编写约定（与 `test-engineer.md` / `AGENTS.md` §8.3 保持一致）

1. **仅需支持 Chrome 内核浏览器**：`playwright.config.ts` 仅声明 `chromium` project，无需（也不应）新增 Firefox / WebKit project。
2. **`[R-xxx]` 追溯标签**：每条用例标题须以 `[R-xxx]` 开头，对应 `requirement-list.md` 中的需求编号，供 `e2e-run.mjs` 统计覆盖率。
3. **交互行为级断言**：断言须到具体交互结果（值/时机/落盘等），不得仅断言「页面加载成功」或「HTTP 200」。
4. 如需跨用例复用的辅助函数、fixture 或运行前置（`globalSetup` / `test.beforeAll`），按当前项目技术栈自建于 `e2e/helpers/`、`e2e/fixtures/` 等目录，并在 `playwright.config.ts` 中声明；harness 模板不预置这些目录，避免绑定到某一具体产品的数据结构。
5. 如需登记已解释的覆盖率豁免，创建 `e2e/coverage-waivers.json`（可选，格式见 `test-engineer.md`）。

## 执行

```bash
node .trae/scripts/e2e-run.mjs --scope=batch --required-ids=R-001,R-002
node .trae/scripts/e2e-run.mjs --scope=final --baseline=docs/requirement/requirement-list.md
```

产物：`test-results/e2e/.e2e-batch-result.json` / `.e2e-final-result.json`（`gatePassed` 判据见 `AGENTS.md` §8.3，唯一权威定义）。
