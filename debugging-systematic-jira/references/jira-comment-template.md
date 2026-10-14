# Jira 备注模板与贴图（CP-58922 实测）

## 正文三节（标题必须原样）

有截图时用 **html** 写备注（才能嵌图）；无图可用 markdown。

```html
<p><strong>产生原因：</strong><br/>…</p>
<p><strong>修复方式：</strong></p>
<ul><li><p>…</p></li></ul>
<p><strong>修复验证：</strong></p>
<ul>
  <li><p>环境：…</p></li>
  <li><p>结果：<strong>PASS</strong> — 断言数字…</p></li>
</ul>
<p>说明文字：</p>
<figure data-type="media-single">
  <div data-type="media" data-media-type="file"
       data-id="<fileId>" data-collection="<collection>">说明.png</div>
</figure>
```

markdown 无（无图或只挂附件时）：

```markdown
**产生原因：**
…

**修复方式：**
- …
- Commit：`<sha>`

**修复验证：**
- 环境：…
- 步骤：…
- 结果：PASS / FAIL + 关键断言数字
```

## 🔴 禁止写进备注的

| 禁止 | 原因 |
|---|---|
| `.workbuddy/tmp/...`、`C:\Users\...` 等**本机路径** | 别人打不开 |
| 密码 / token / cookie / 预签名 URL | 凭据纪律 |
| 整页 XHR dump、客户邮箱明文列表 | 噪声 + 隐私 |
| HTML `<b>` | Atlassian 拒收；用 `<strong>` |
| 「有 bug / 已修复」空话 | 不可复核 |

本地截图目录 / `verdict.json` 只给本轮上传用，**不出现在 commentBody**。

## 推荐：备注正文内嵌图（方式 B）

有验证截图时**默认走这条**（读者不用点开附件）。

```
① getAccessibleAtlassianResources → cloudId
② 每张图 phase1：uploadAttachmentToJiraIssue(filePath) → uploadCommand
   → scripts/jira-run-upload-command.mjs 跑命令 → fileId
   （记牢返回的 collection，通常 upload-user-collection-…）
③ ⚠️ 若要用 media 节点嵌正文：phase1 后可先 phase2 挂附件，再用同一 fileId 嵌图；
   或 phase1 后直接嵌图、跳过 phase2。不要对同一 fileId 又 phase2 又 inlineFileId（会重复）
④ addOrEditJiraIssueComment(
     contentFormat=html,
     commentBody=三节 + <figure>…</figure>
   )
⑤ 已发过纯文字备注时：listJiraIssueComments(responseContentFormat=html)
   → addOrEditJiraIssueComment(commentId=…, contentFormat=html, 全文含图)
```

图节点（段间插入）：

```html
<p>生成中已切到 Size Specification：</p>
<figure data-type="media-single">
  <div data-type="media" data-media-type="file"
       data-id="<fileId>" data-collection="upload-user-collection-…">06-switched.png</div>
</figure>
```

备选（图一律追加文末）：`inlineFileId` + `inlineFileCollection` + `inlineFileName`（同样要 `contentFormat: html`）。

辅助脚本：[`../scripts/jira-run-upload-command.mjs`](../scripts/jira-run-upload-command.mjs)

### MCP 调用方式（2026-10-14 核对）

当前 Atlassian MCP 只把少数操作放在顶层工具（如 `getJiraIssue`、`getAccessibleAtlassianResources`），其余按**操作名**走执行工具：

| 操作 | 怎么调 | 核对结果 |
|---|---|---|
| `listJiraIssueComments` | `executeRead`（`responseContentFormat: html` 才能无损回写） | discover 可查到 ✅ |
| `addOrEditJiraIssueComment` | `executeWrite` | discover 的官方说明里点名引用 ✅；写 html 前可先 `executeRead getContentFormatGuide(toolName=addOrEditJiraIssueComment)` |
| `uploadAttachmentToJiraIssue`（phase1 / phase2） | `executeWrite` | 本次 discover 未检出 —— **待确认**（可能被会话权限过滤），用前先 `discover "upload attachment jira"` |

🔴 操作名以 `discover` 返回为准，禁止凭记忆猜名字；顶层工具列表里有同名工具时直接用顶层的。

### 方式 A：只挂附件不嵌正文

无图预览需求时：phase1 → phase2 → markdown 三节，正文用附件**文件名**引用。

## 写法约定

- **产生原因**写 WHY  
- **修复方式**写关键逻辑 + commit  
- **修复验证**写环境 + 步骤 + 断言；有图就嵌进本节下方  
- 失败同样写三节，结论 FAIL，禁止假装 PASS  

## CP-58922 踩过的坑（保留）

| 坑 | 正解 |
|---|---|
| 备注写本机 `.workbuddy/tmp/...` | 删掉；证据 = 内嵌图 / 附件文件名 + 断言 |
| 手抄 Bearer → `invalid signature` | MCP 响应整段 Write 落盘，用 `jira-run-upload-command.mjs` |
| html 用 `<b>` | 改 `<strong>` |
| 只要附件、读者还要点开 | 默认内嵌 `media-single` |
| 已 phase2 还想嵌图 | **同一 fileId 编辑备注即可**，不必重传 |
