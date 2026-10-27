# 牧场 · Coopanion World

让 Coopanion 的桌宠照看《动物栏：桌面牧场》（Tiny Pasture）：

- 读金币、牧场名、动物数量、饥饿/健康/稀有度
- 喂食（一次多份、按物种选食物、避开左右边缘）
- 抚摸、捡金币、扫便便
- 商店目录、买食物、买动物、卖动物、清理超量/低星、解锁新牧场/栏位
- 自动巡视、每小时小日志
- World 页里的「牧场控制台」可视化面板

## 依赖

1. **Tiny Pasture** 1.7.x（Godot 4.3）
2. **Godot Mod Loader**（游戏侧）
3. 配套的 **TinyPastureBridge** mod：把 `mods/Coopanion-TinyPastureBridge-<version>.zip`
   解压/放进游戏的 `mods-unpacked/`，或在 Mod Loader 里启用。

扩展本身不下载、不安装 mod；只通过本地 JSON 文件与 mod 通信。

## 安装（从 npm，推荐）

1. 先按上面的「依赖」装好 mod，启动一次游戏确认 `%APPDATA%\TinyPasture\bridge\heartbeat.json` 会更新。
2. 打开 Coopanion → 左侧「扩展」→ **World**。
3. 搜索 `cortico-world-pasture`；如果搜索索引还没更新，选「手动填 npm 包名」输入
   `cortico-world-pasture` 安装。
4. 重启 Coopanion；在 **World 总览** 里启用「牧场」。

## 安装（从本机目录）

1. 先按上面的「依赖」装好 mod，启动一次游戏确认 `%APPDATA%\TinyPasture\bridge\heartbeat.json` 会更新。
2. 打开 Coopanion → 左侧「扩展」→ 选 **World** 分类。
3. 点「从本机目录安装」，选这个 `extension/` 目录（里面有 `package.json`）。
   安装会以 link 方式装入，不会复制代码。
4. 重启 Coopanion；在 **World 总览** 里启用「牧场」。
5. 打开「牧场」页 →「牧场控制台」，点「刷新」应能看到金币和动物。

> 修改代码后重启 Coopanion（或重装一次）生效。重新打 WebUI 包要跑
> `corepack pnpm build:webui`。

## 控制台面板

World 页的 **牧场控制台** 提供：

- 状态卡：金币、动物数、今日额度、自动巡视开关
- 按钮：刷新、喂 3 份、买食物、摸一只、清理超量/低星、卖一只低星、买动物、解锁栏位、今日花费、动物/物资/装饰目录、开始游戏、自动巡视开/关、看小时报
- 动物列表：名字、星级、成年/幼年、饥饿、健康、生病标记

配置项仍然在 World 页的「配置」里改；面板里的开关只改当前运行实例，要持久化请改配置。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | false | 是否启用 |
| `bridgeDir` | 空 | 自定义 bridge 目录，空则用 `%APPDATA%\TinyPasture\bridge` |
| `pollSeconds` | 30 | 状态轮询间隔 |
| `dailyBudget` | 500 | 每日预算兜底值；只约束买动物/装饰 |
| `dailyBudgetPercent` | 70 | 每日预算 = 当前金币 × 70%；喂食不占用 |
| `reserveCoins` | 200 | 花完后至少保留的金币（喂食也保留） |
| `confirmOver` | 300 | 单笔超过这个金额要先问用户 |
| `allowBuy` | false | 允许花金币买东西 |
| `autoCare` | true | 自动巡视 |
| `careIntervalSeconds` | 360 | 自动巡视间隔（6 分钟） |
| `autoFeedMax` | 3 | 每轮最多喂几只 |
| `autoFeedThreshold` | 30 | 饥饿低于多少才自动喂 |
| `autoPet` | true | 没喂时摸一只 |
| `autoBuy` | false | 自动买动物 |
| `autoBuyTypeId` | 空 | 指定物种 `type_id`；空则按策略 |
| `maxPerSpecies` | 2 | 每种动物最多保留几只 |
| `autoTrim` | false | 自动清理超量/低星动物 |
| `rerollLowStar` | false | 同种 2 只低星时全卖重刷 |
| `autoNewPasture` | false | 槽位价格 2 倍询问、4 倍自动买 |
| `digestEnabled` | true | 每小时小日志 |
| `digestIntervalSeconds` | 3600 | 小日志间隔 |
| `digestMaxChars` | 500 | 小日志最大字数 |
| `hungerThreshold` | 30 | 饥饿事件阈值 |
| `cursorRestore` | false | 喂食后用 PowerShell 还原鼠标；默认关闭 |

喂食预算按**实时金币**算：可用 = 当前金币 - `reserveCoins`，不占用每日预算。
只要还有动物饥饿且可用 ≥ 5，就可以继续买食物/喂食；买动物和装饰仍受
`dailyBudgetPercent` 与 `reserveCoins` 限制。

默认偏保守：花钱、卖动物、刷星级、自动买栏位都关闭；需要时在配置里打开。

## 访问与隐私

- **网络：无。** 不访问 npm、GitHub 或任何 HTTP 地址。
- 读取：`%APPDATA%\TinyPasture\bridge\result.json`、`heartbeat.json`
- 写入/删除：`%APPDATA%\TinyPasture\bridge\cmd.json`
- 数据：`dataDir/pasture-state.json`（今日花费）、`dataDir/pasture-log.jsonl`（小时报）
- 不读写游戏存档、EXE、PCK；不读取或上传 API Key、聊天记录、剪贴板。
- 唯一的外部进程：`cursorRestore: true` 时，喂食后启动一次
  `powershell.exe` 执行 `Cursor.Position` 还原鼠标。默认关闭。

## 开发

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build:webui
corepack pnpm describe
```

- 测试不要求游戏在运行：`tests/` 用 fake bridge/host。
- `describe.json` 由 `src/definition.ts` 导出，`pnpm describe` 重新生成。
- WebUI 面板源码在 `src/webui/client.ts`，构建产物 `dist/webui.js`，
  `package.json` 的 `cortico.webUiClient` 指向它。

## 许可与来源

- 本扩展：MIT，见 [LICENSE](LICENSE)。
- 工程结构参考 [Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico)
  的 `templates/extension/world`（MIT）。
- 游戏侧依赖 [Godot Mod Loader](https://github.com/GodotModding/godot-mod-loader)，
  按其自身许可证使用；本包不打包其代码。
- 不包含《动物栏：桌面牧场》的图片、音频或其它游戏素材。

## 已知限制

- 装饰/背景购买、治疗剂使用、设施升级尚未实现。
- `cursorRestore` 开启时会短暂移动鼠标再还原；默认关闭。
- 自动买卖需要游戏侧 mod 在运行；mod 未启动时工具回执会说明“没在运行”。
