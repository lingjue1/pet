# 已完成功能清单（从打开游戏开始）

本文按真实运行顺序列出 Tiny Pasture × Coopanion 扩展当前已经完成的行为，便于直接放进仓库说明。

## 0. 安装前提

1. 游戏：Tiny Pasture 1.7.x（Godot 4.3）+ Godot Mod Loader。
2. 游戏 mod：`Coopanion-TinyPastureBridge-0.1.0.zip` 放进 `mods/`（或解压到 `mods-unpacked/`）。
3. Coopanion 扩展：`cortico-world-pasture`，从本机 `extension/` 目录以 link 方式安装。
4. 重启 Coopanion，在 World 总览启用「牧场」。

---

## 1. 打开游戏：mod 自动接管

1. 游戏启动，Mod Loader 加载 `Coopanion-TinyPastureBridge`。
2. `probe.gd` 挂到场景树，设置 `PROCESS_MODE_ALWAYS`，即使开始菜单暂停也能继续处理命令。
3. 创建 `%APPDATA%\TinyPasture\bridge\`，写入 `meta.json`。
4. 每 2 秒写一次 `heartbeat.json`（含窗口大小、根节点数、时间）。
5. 启动约 2 秒后，自动查找开始菜单的 `BT_Continue` 并按下「开始游戏」；按钮还没出现就下一帧继续试。
6. 游戏进入牧场后，mod 开始接受 `cmd.json` 命令，并把结果写入 `result.json`。

扩展侧判断“游戏在运行”的标准：`heartbeat.json` 的修改时间在 15 秒内。

---

## 2. Coopanion 启动：World 挂载

1. 扩展加载 `WorldDefinition`（id `pasture`，api 6，kind world）。
2. `start(host)` 被调用：
   - 立即读一次牧场状态；
   - 启动轮询定时器，默认每 **30 秒**一次（`pollSeconds`）。
3. 每次轮询通过 bridge 取 `summary`：金币、牧场名、栏位上限、每只动物的饥饿/健康/星级/是否成年/是否生病。
4. 更新 World 页：
   - 状态灯：动物栏 online/offline（最后读取时间）；
   - 徽标：金币、动物数；
   - 控制台面板状态卡。
5. 状态变化推事件：
   - `pasture.hungry`：有动物低于饥饿阈值；
   - `pasture.sick`：出现生病动物；
   - `pasture.newAnimal`：动物数增加。
6. 第一次轮询同时记录小时报基线。

---

## 3. 手动功能：13 个工具

| 工具 | 做什么 | 关键参数 |
|---|---|---|
| `pasture_status` | 读金币、牧场名、动物数、每只饥饿/健康/星级 | 无 |
| `pasture_pet` | 摸一只，默认最饿的，播 `interact_0` | `index?` |
| `pasture_feed` | 一次投喂多份，按物种选食物，避开左右边缘 | `count?` 默认 3，最大 5 |
| `pasture_shop` | 打开指定商店页，返回货架名称/价格/解锁状态，**分析完自动关** | `page`：animals/items/facility/decoration |
| `pasture_buy_food` | 物资页买一种食物并喂最饿的，**操作完自动关** | `name?`、`confirm?` |
| `pasture_buy_animal` | 买一只动物，受每种上限与预算限制，**买完自动喂** | `type_id?`、`max_price?`、`confirm?` |
| `pasture_spend` | 今日花费、每日预算、预留、还能花多少 | 无 |
| `pasture_auto` | 开关自动巡视，改间隔/每轮喂几只/指定物种 | `enabled?`、`interval_seconds?`、`max_feed?`、`buy_type_id?` |
| `pasture_sell` | 卖一只 4 星以下成年动物；单只不卖 | `name?`、`confirm` |
| `pasture_new` | 新牧场/栏位：2 倍价格询问，4 倍自动买 | `confirm?` |
| `pasture_trim` | 清理超量/低星动物，规则同自动巡视 | 无 |
| `pasture_log` | 读最近几份小时报 | `limit?` 默认 3 |
| `pasture_start` | 在开始菜单点「开始游戏」 | 无 |

所有工具回执都是给桌宠看的中文事实描述；失败会说明原因，不会假装成功。

---

## 4. 喂食细节

1. 选目标：饥饿从低到高，最多 `count` 只（默认 3）。
2. 按物种选食物 id：
   - 兔子 → 0 胡萝卜
   - 猫 → 2 爪爪饼
   - 狗/柯基 → 3 奶酪
   - 鱼 → 8 蘑菇
   - 其它 → 1 卷心菜
3. 调用游戏自己的 `_on_food_picked(food_id)`，再点动物，最后在动物位置释放食物。
4. 落点被 mod 夹在安全区：
   - `x ∈ [220, 视口宽 - 220]`
   - `y ∈ [20, 视口高 - 20]`
   避免左下/右下死角卡住动物。
5. 每份食物 5 金币；受每日预算、保留金币、单笔确认线限制。
6. `cursorRestore` 默认关闭；打开后喂完会用 PowerShell 把鼠标还原到原位（会短暂移动）。

---

## 5. 自动巡视（默认每 6 分钟）

`careIntervalSeconds: 360`。每轮严格按下面顺序：

1. **算预算**：今日还能花 = min(今日额度 - 已花, 金币 - 保留)。
2. **喂食**：饥饿低于 `autoFeedThreshold`（默认 30）的，最多 `autoFeedMax`（默认 3）只，按物种选食物。
3. **抚摸**：如果这一轮没喂任何动物，摸最饿的一只。
4. **记账**：喂食花费写进 `pasture-state.json`。
5. **捡金币**：扫地上的金币节点并点击。
6. **扫便便**：调用自动清洁器并点便便。
7. **清理动物**（`autoTrim` 开启时）：
   - 每种最多 `maxPerSpecies`（默认 2）只；
   - 只卖 4 星以下的成年动物；
   - 同种正好 2 只、都低于 4 星且都成年 → 可以两只全卖，用来重买刷星级；
   - 同种只剩 1 只时绝不卖；
   - 4 星及以上保留。
8. **买动物**（`autoBuy` 开启时）：
   - 牧场满员 → 跳过；
   - 候选 = 已解锁且该物种当前数量 < 2；
   - 金币 > 候选最高价 × 1.5 → 买最贵的（优先解锁新物种）；
   - 否则买最便宜的；
   - 买成功后自动喂新动物一份。
9. **新牧场/栏位**（`autoNewPasture` 开启时）：
   - 金币 ≥ 价格 × 2 → 推 `pasture.slotOffer` 询问；
   - 金币 ≥ 价格 × 4 → 自动购买并确认；
   - 不到 2 倍不动作。
10. **收尾**：重新读 summary，推 `pasture.care` 事件，报告这一轮喂了谁、摸了谁、捡了多少、清理了多少、买了什么。

自动巡视失败不会中断 World：单步失败写日志并继续/跳过。

---

## 6. 每小时小日志

1. 默认每 3600 秒生成一份。
2. 内容四行：
   - 时间、牧场名、动物数、金币；
   - 这一小时累计收获、净金币变化；
   - 喂/摸/买/卖/捡金币/打扫次数；
   - 星级分布、生病数、最饿的一只。
3. 最长 500 字，超了截断加省略号。
4. 推 `pasture.digest` 事件，让桌宠念出来。
5. 同时追加到 `dataDir/pasture-log.jsonl`。
6. `pasture_log` 工具和控制台「看小时报」按钮都能读最近几份。

---

## 7. 控制台 UI

位置：Coopanion → World →「牧场」→「牧场控制台」。

- 状态卡：金币、动物数、今日额度、自动巡视开关。
- 动物列表：名字、星级、成年/幼年、饥饿、健康、生病标记。
- 按钮：
  - 刷新、喂 3 份、买食物、摸一只；
  - 清理超量/低星、卖一只低星、买动物；
  - 解锁栏位、今日花费；
  - 动物/物资/装饰目录；
  - 开始游戏、自动巡视开/关、看小时报。
- 面板通过 `ctx.invoke('action', [动作, 参数])` 调 World，不直接碰文件或 HTTP。
- 配置仍在 World 页的配置区；面板里的自动巡视开关只改当前实例，持久化请改配置。

面板产物：`dist/webui.js`，由 esbuild 打包，manifest 的 `cortico.webUiClient` 指向它。

---

## 8. 界面自动关闭

所有由扩展打开的界面，操作完都关：

- 商店 `UIShop`：分析完、买完食物、买完动物、失败/拒绝后都关；
- 牧场 `UI_Farm`：卖完、清理完、买完新牧场后关；
- 卖出确认、新牧场确认：随操作确认关闭；
- 开始菜单：自动按下开始后离开。

---

## 9. 预算与安全规则

| 规则 | 默认 |
|---|---|
| 每日预算 | 当前金币 × 70% |
| 每日兜底 | `dailyBudget: 500`（未设百分比时） |
| 保留金币 | 200 |
| 单笔确认线 | 300 |
| 允许购买 | false（默认关） |
| 自动买动物 | false（默认关） |
| 自动清理 | false（默认关） |
| 重刷低星 | false（默认关） |
| 自动买栏位 | false（默认关） |
| 喂食还原鼠标 | false（默认关） |

固定边界：

- 不改游戏存档、EXE、PCK；
- 不刷金币、不改价格、不写内存；
- 所有动作走游戏自己的按钮/方法，金币与空位由游戏校验；
- 每笔花费写入 `dataDir/pasture-state.json`；
- 出售只卖 4 星以下成年、且不会清到只剩 1 只；
- 新牧场/栏位不到 2 倍价格不询问，不到 4 倍不自动买。

---

## 10. 网络、文件与隐私

**网络：零请求。** 不访问 npm、GitHub、任何 HTTP 地址。

读取：

- `%APPDATA%\TinyPasture\bridge\result.json`
- `%APPDATA%\TinyPasture\bridge\heartbeat.json`

写入/删除：

- `%APPDATA%\TinyPasture\bridge\cmd.json`
- `dataDir/pasture-state.json`
- `dataDir/pasture-log.jsonl`

不读取或上传：游戏存档、API Key、聊天记录、剪贴板、浏览器数据。

唯一外部进程：`cursorRestore: true` 时，喂食后启动一次 `powershell.exe` 执行 `Cursor.Position`；默认关闭。

---

## 11. 工程与测试

- TypeScript + vitest；`src/definition.ts`、`config.ts`、`world.ts`、`bridge.ts`、`policy.ts`、`webui/client.ts`。
- `describe.json` 由 definition 导出，补全 13 个工具与 6 个事件。
- 测试：29 个，覆盖配置默认值、自描述、dry mount、bridge 心跳/超时、买卖/槽位/清理策略、控制台状态接口。
- `pnpm test`、`pnpm typecheck`、`pnpm describe`、`pnpm build:webui` 均通过。
- 安装包：`cortico-world-pasture-0.1.0.tgz`；mod 包：`Coopanion-TinyPastureBridge-0.1.0.zip`。

---

## 12. 当前未完成

- 装饰/背景的购买与摆放；
- 治疗剂对生病动物的实际使用；
- 设施升级的成本/确认逻辑；
- 自动巡视的“跨牧场”管理（目前只操作当前牧场）。

---

## 13. 当前实测快照

- Coopanion：12 个进程，`world:pasture` active；
- 工具：13 个；
- 控制台面板：`dashboard`，`webUiClient` served；
- 牧场：4 只动物（2 兔、1 狗、1 狐），约 5579 金币；
- 自动巡视：开启；自动买/清理/重刷/买栏位：当前配置为开启。
