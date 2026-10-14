# 需求源文档跟踪（GitHub / Confluence 版本检查）

> **时机**：① 用户给出 PRD 等需求文档的 GitHub / Confluence 链接时登记；② **每天第一次处理该需求时**检查一次（`check --daily`，当天再调是空操作）；③ 用户说「检查文档有没有更新」时检查（不带 `--daily`）。
> **产出**：分组时把最新版本写回需求目录的「原文档」（见二之一）；需求目录 `源文档/`：`sources.json` 登记表、`README.md` 索引、`<名称>/<文档标题>_v<N>_<日期>_<时分>_<上游版本>.md` 每版快照（文档标题：GitHub 取文件名、Confluence 取页面标题；时间 = 上游版本时间，本机时区；本地基线用文件修改时间）、`<名称>/<文档标题>_差异_v<N-1>-v<N>.md` 相邻版本差异（末尾「影响分析」由 AI 填）。
> **脚本**：`scripts/doc_sources.py`。

## 一、为什么要跟踪

- PRD 在开发过程中会被产品改（改名、加规则、删范围），**没人通知开发**；靠用户「顺手发个新版」会漏，漏掉的就是上线前才发现的需求偏差。
- 手工下载存成 `-v2.md` 只能知道「变了」，**说不清哪一版对应上游哪次提交、是哪天谁改的**；对比也靠人眼。
- 有了版本快照，Step1 问答、Checklist、证据里引用 PRD 时能写明「依据 PRD v3」，事后能追溯当时依据的是哪一版。

## 二、登记（用户给链接时）

```bash
py scripts/doc_sources.py add --dir "<需求目录>" --url "<链接>" [--name 名称] [--note 说明] [--start-version N] [--baseline 本地文件]
py scripts/doc_sources.py check --dir "<需求目录>"          # GitHub 来源立即拉首个版本
```

- **名称**：登记名（子目录名、标记里用它），默认取文件名 / 页面标题；同一需求多份文档（现行 PRD、老版本、AI 接口文档）用 `--name` 起短名，如 `PRD-github`、`PRD-confluence`。
- **文档标题**：快照文件名的开头，让文件单独拿出来也看得出是哪份文档；GitHub 默认取文件名，Confluence 默认取 URL 里的页面名，可用 `--title` 指定。命名规则变了之后，老登记跑 `migrate` 统一改名。
- **`--note`**：写清这份文档的角色，例如「现行 PRD」「老版本需求，仅作历史对照」——影响分析时据此判断变更的分量。
- **衔接已有的手动版本**：需求目录里已经有手动下载的 `xxx-v2.md` 时，用 `--start-version 2`，首次拉到的版本就记为 v2；或用 `--baseline <本地文件>` 把它登记为首个版本（上游版本记为 `local`），紧接着 check 会和上游对比、自动出差异。
- **只登记需求范围的文档**：PRD、AI / 第三方接口文档、设计说明。代码仓库里的技术文档不在此列（它们随代码走 git）。

## 二之一、同一份文档有多个来源（GitHub 与 Confluence 各一份）

产品常把同一份 PRD 同时放在 GitHub 和 Confluence，两边不一定同步。**分成一组，并指定需求目录里的「原文档」**：

```bash
py scripts/doc_sources.py add   --dir … --url <GitHub 链接>     --name PRD-github     --group PRD --canonical "<原文档>.md"
py scripts/doc_sources.py add   --dir … --url <Confluence 链接> --name PRD-confluence --group PRD
py scripts/doc_sources.py group --dir … --source <已登记名> --group PRD [--canonical "<原文档>.md"]   # 已登记的来源后补分组
```

- **谁最新**：比较各来源**当前版本的上游时间**（GitHub = 文件最近提交时间，Confluence = 页面版本时间，统一换成本机时区），晚的为准。**不比正文**：Confluence 转 Markdown 有损（图片、附件、部分格式丢失），两边正文永远不会逐字相同；脚本只算一个去掉 Markdown 符号后的相似度供参考。
- **写回原文档**：每次 check / ingest / group 之后，组内最新版本写进 `--canonical` 指定的原文档（相对需求目录），首行注释写明来源、版本、上游时间与写入时间。原文档 = 团队平时看的那份，**以后引用 PRD 就看它**；版本快照仍在 `源文档/<名称>/` 下。
- **原文档被手改过**（去掉首行注释后的正文与所有快照都对不上）：覆盖前备份到 `源文档/_原文档备份/<原文档名>_<时间>.md` 并提示。需要改 PRD 请改上游，不要改原文档。
- **最新来源切换**（例如之前以 GitHub 为准，Confluence 后来又被改了、时间更晚）：脚本打印 `[最新来源切换]`，原文档已换成新来源的内容。🔴 **必须告诉用户**：两边不一致，请确认以哪份为准、是否请产品把另一边同步；用户说「以 GitHub 为准」时，在问答记录留一条，并把 Confluence 来源 `--note` 改成「镜像，以 GitHub 为准」。
- **影响分析只做最新来源**：组内不是最新的来源（镜像）有变化时，verify 对它只给 WARN；切换后新的最新来源要按第四节做影响分析。
- 每次检查都会打印一行 `[同文档 <组>] 最新：… ；其他：…（相似度 NN%）`，汇报时带上。

## 三、检查

```bash
py scripts/doc_sources.py check --dir "<需求目录>" --daily   # 每天第一次处理需求时
py scripts/doc_sources.py check --dir "<需求目录>"           # 用户要求检查时（不跳过今天已查过的）
py scripts/doc_sources.py status --dir "<需求目录>"          # 看各来源当前版本与最后检查日期
```

末行 `RESULT changed=… pending=… unchanged=… errors=…`：

| 字段 | 含义 | 怎么做 |
|---|---|---|
| `changed` | 有新版本，已存快照和差异；分组的来源同时打印 `[同文档]` / `[最新来源切换]` / `[原文档更新]` | 读 `源文档/<名称>/<文档标题>_差异_v*.md` → 第四节；有 `[最新来源切换]` 先按二之一告诉用户 |
| `pending` | Confluence 来源，脚本不联网 | 见下方「Confluence 怎么拉」 |
| `errors` | 拉取失败（退出码 2） | 报给用户：网络 / 凭据 / 文件被移动改名；**不要当成「没变化」** |

**GitHub**：脚本用本机 git 凭据（Windows 下单次覆盖为 Git Credential Manager）在 `~/.cache/doc-sources/<owner>__<repo>` 维护一个只拉元数据的缓存仓（部分克隆、不检出文件，路径含全角字符也不受影响），`git show` 读内容；上游版本 = 该文件最近一次提交的短 SHA，附提交时间、作者、提交说明。

**Confluence 怎么拉**（脚本不调接口，AI 用 Atlassian MCP）：
1. `getConfluenceContent`（`content_id`=登记里的 page_id，`detail=summary`）看 `metadata.version.number`。
2. 与 `pending` 里的上次上游版本相同 → `py scripts/doc_sources.py ingest --dir … --source <名称> --upstream-version <号>`（只记「今天查过、未变」）。
3. 不同（或首次）→ 再取 `detail=full`、`content_format=markdown`，把 `body.value` **原样**写进 scratchpad 临时文件，然后 `ingest … --upstream-version <号> --upstream-time <createdAt> --title "<返回的 title>" --file <临时文件>`（`--title` 让快照文件名用页面真实标题；URL 里的页面名常被截断）。正文没变（如只改了标题）脚本会判未变。
4. Markdown 转换是有损的（返回里的 `lostFeatures`：图片、附件等），差异里看不到图的变化；PRD 的图有变化嫌疑时，打开页面人工看并在影响分析里注明。

## 四、有变更之后（AI 必做，不能只报「文档变了」）

1. **读差异文件**，按改动点逐条列出（标题改名、字段表行增删改、规则新增、范围删减……），纯格式变化（空行、表格对齐）合并成一条说明即可。
2. **逐条对照当前实现与流程产出**，填进差异文件末尾「影响分析」（脚本已生成表头），一条一行：

   | # | 改动 | 当前实现 / 流程产出 | 结论 | 同步位置 |
   |---|---|---|---|---|
   | 1 | 新增：Product Image 来源从素材库选图默认筛 Product Only | 未实现 | ❌ 需新做 | Step 1-需求澄清问答记录.md、Step 3-Checklist.md、Step 8-前端测试验证指标矩阵.md |
   | 2 | 改名 Hook → Selling Point | Q58 已改 | ✅ 一致 | — |
   | 3 | 序号写「1、2、3」 | 设计稿 / AC-88 为 01 | ⚠️ 冲突，需定 | Step 1-需求澄清问答记录.md |

   结论只用四种：✅ 一致 / ❌ 需新做 / ⚠️ 冲突需定 / — 纯文档（日期、截图链接等，无需处理）。
3. **❌ 和 ⚠️ 逐条交用户裁决**（不自己定）；用户定了之后与 Figma 差异同一套处理：记进问答记录（新 Q）与决策记录 → 同步受影响的 AC（Checklist → 重新生成 Jira 纯净版 → 证据 case.md）、Spec、Step4 / 6 / 7、前端 / 后端矩阵、tasks → 已写代码按结论改。⚠️ 用户决定「不改」的也要在问答记录里留一条（标记同样要打），否则下次比对又会被当成新问题。
4. 🔴 **每个受影响的步骤文档都要在改动处标注**，标记文本固定为 `需求变更 <名称> v<N>`（`<名称>` 是登记名，`<N>` 是新版本号），让人在任何一份文档里都能看出「这里是因为哪一版需求变更改的」：

   | 文档 | 标在哪 | 写法 |
   |---|---|---|
   | Step 1 问答记录 | 新 Q 的「来源」行 | `- **来源**：需求变更 PRD-github v3（差异：源文档/PRD-github/<文档标题>_差异_v2-v3.md）；用户（明确决策）…` |
   | Step 2 Spec / Step 4 / Step 6 / Step 7 / tasks | 改动的段落或表格行末尾 | `〔需求变更 PRD-github v3〕` |
   | Step 3 Checklist | 受影响 AC 的标题行末尾括注（与「代码 gap-check」同一位置） | `(来源: 需求变更 PRD-github v3)`；已有括注就并进去：`(来源: 代码 gap-check；需求变更 PRD-github v3)`。`checklist_jira.py` 会自动去掉括注，Jira 纯净版不受影响 |
   | Step 8 矩阵 / 回归清单 | 新增或改写的分支行「前置条件」列开头 | `〔需求变更 PRD-github v3〕` |
   | 决策记录 | 新 D 条目的「触发」列 | `需求变更 PRD-github v3` |
   | tests/AC-NN/RESULT.md | 新增的验证小节标题 | `## 需求变更 PRD-github v3 追加（日期）` |

   标完把这些文档（相对需求目录的路径）填进影响分析表的「同步位置」列，然后跑：

   ```bash
   py scripts/doc_sources.py verify --dir "<需求目录>"
   ```

   verify 逐条检查：影响分析填完没有、❌ / ⚠️ 条目有没有写同步位置、同步位置里的每个文档是否真的含有 `需求变更 <名称> v<N>` 标记。**FAIL 视同本次变更没处理完**，不能回到原任务。
5. 老版本 / 仅作历史对照的来源（`--note` 里写「老版本」或「历史」）有变更时，只在汇报里提一句，verify 对它的未填影响分析只给 WARN，除非用户要求展开。
6. 汇报格式：`源文档 <名称> 有更新：v<N-1>@<旧> → v<N>@<新>（<时间> <作者>：<提交说明>）`，后面附影响分析表里 ❌ / ⚠️ 的条目和 verify 结果。

## 五、坑

| 现象 | 处理 |
|---|---|
| 上游有新提交 / 新版本号但正文没变 | 脚本判未变，不建新版本（记在当前版本的 `same_content_upstreams`）；正常 |
| GitHub 上文件被移动或改名 | check 报「找不到文件」进 `errors`：问用户新路径，`add` 新链接（旧来源保留作历史） |
| 本机 `~/.gitconfig` 的凭据助手指向已删除的程序，git fetch 卡住或报错 | 脚本已在 Windows 下单次覆盖为 `manager`；其他平台按本机 git 凭据配置处理，不在脚本里读或写令牌 |
| 用户提出给令牌 | 不需要：GitHub 走本机 git 凭据，Confluence 走已授权的 Atlassian MCP。确需脚本直连时，请用户设成环境变量，**不要贴在对话里** |
