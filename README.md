# Coopanion × Tiny Pasture

让 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 的桌面伙伴「看见」并操作
[动物栏：桌面牧场 / Tiny Pasture](https://store.steampowered.com/app/3167550/) 的本地桥。

> 非官方项目，与 CaveLiquid、Pal AI Lab 无关联。单机自用；使用前请备份存档。

## 架构

```
Coopanion（world 扩展：决策 / 预算 / 说话）
   ⇅  %APPDATA%\TinyPasture\bridge\cmd.json → result.json
TinyPastureBridge（Godot mod：读 GState、按游戏自己的按钮）
   ⇅
Tiny Pasture（Godot 4.3 + Godot Mod Loader）
```

- **扩展**跑在 Coopanion 的 Node 进程里，负责读状态、做决定、说话、记账。
- **mod**跑在游戏进程里，只做两件事：把状态写出来、调用游戏自己的按钮/方法。
- 两者通过 `%APPDATA%\TinyPasture\bridge\` 下的 JSON 文件通信，不经过网络。

完整的「从打开游戏开始」行为清单见 [FEATURES.md](FEATURES.md)。

## 当前状态

| 能力 | 状态 |
|---|---|
| mod 加载、心跳、自动点「开始游戏」 | 可用 |
| 读取金币、农场、动物（饥饿/健康/稀有度/产币） | 可用 |
| 抚摸（`play_action("heart")`） | 可用 |
| 喂食（花 5 金币买食物丢给最饿的动物） | 可用 |
| 商店分析（动物/物资/设施/装饰页，返回名称、价格、解锁状态） | 可用 |
| 在物资页买食物并喂给动物（操作完自动关界面） | 可用 |
| 买动物（开商店 → 选物种 → 买一只 → 接受） | 可用，受每日预算限制 |
| 自动巡视（每 6 分钟喂最饿的、摸一只、报告） | 可用 |
| 一次投喂多份（按物种选食物，避开左右边缘） | 可用 |
| 自动捡金币 / 打扫便便 | 自动巡视时顺带处理 |
| 自动买动物（每种≤2只；钱够 1.5 倍最贵价时优先最贵，买完自动喂） | 可用，预算 = 当前金币的 70% |
| 超量动物自动清理（4 星以下成年才卖；同种 2 只都低星可全卖重刷；单只不卖） | 可用 |
| 新牧场/栏位（金币 ≥2 倍价格询问，≥4 倍自动买） | 可用（当前 6000×4=24000，金币不足） |
| 出售动物（只卖 3 星以下，需确认） | 可用 |
| 创建新牧场（检查价格，金币不足拒绝） | 可用（当前 6000 金币，牧场 3545，暂时不够） |
| 每小时小日志（收获/驯养，≤500 字） | 可用 |
| 买装饰 / 换背景 | 只读目录，购买未实现（下一版） |

> 每日预算默认是**当前金币的 70%**（`dailyBudgetPercent`），另加 `reserveCoins`
> 花完保留、`confirmOver` 单笔确认线。每笔写入 `dataDir/pasture-state.json`。
> 所有动作都走游戏自己的按钮/方法，金币、空位由游戏校验。

## 安装 mod

1. 构建或在 Releases 下载 `Coopanion-TinyPastureBridge-<version>.zip`。
2. 放到 `TinyPasture/mods/`（与 `TinyPasture.exe` 同级）。
3. 启动游戏；日志在 `%APPDATA%\TinyPasture\logs\modloader.log`。
4. mod 的用户配置在 `%APPDATA%\TinyPasture\mod_user_profiles.json`，确保
   `Coopanion-TinyPastureBridge.is_active` 为 `true`。

zip 结构必须是：

```
mods-unpacked/Coopanion-TinyPastureBridge/manifest.json
mods-unpacked/Coopanion-TinyPastureBridge/mod_main.gd
mods-unpacked/Coopanion-TinyPastureBridge/probe.gd
```

## 安装扩展

扩展是标准 Coopanion World 包（npm tarball）：

1. 构建或在 Releases 下载 `cortico-world-pasture-0.1.0.tgz`。
2. 在 Coopanion 的 `data/extensions/` 里安装：
   ```powershell
   pnpm add .\cortico-world-pasture-0.1.0.tgz
   ```
   或解压到 `data/extensions/node_modules/cortico-world-pasture/`，并在
   `data/extensions/package.json` 的 `dependencies` 里加
   `"cortico-world-pasture": "file:./cortico-world-pasture"`。
3. 在 `data/home/companion/config.json` 的 `worlds` 里加：
   ```json
   "pasture": { "enabled": true }
   ```
4. 重启 Coopanion（扩展是 ESM，新增包必须重启进程）。

扩展提供 `pasture_status`、`pasture_pet`、`pasture_feed`、`pasture_buy_animal`、
`pasture_start` 五个工具；配置项与预算说明见
[extension/README.md](extension/README.md)。

## 桥协议

写 `bridge/cmd.json`（UTF-8，无 BOM）：

```json
{"cmd":"animals","id":"a1"}
```

mod 处理后在 `bridge/result.json` 返回，并把 `cmd.json` 删除。

| cmd | 参数 | 作用 |
|---|---|---|
| `ping` | – | 存活检查 |
| `state` | – | 导出 GState / FarmDB / GSave |
| `dump` | – | 导出场景树 + 状态到 `cmd_dump.json` |
| `animals` | – | 导出牧场动物（含 `animal_save`、屏幕矩形） |
| `node` | `path` | 单个节点信息 + 脚本变量 |
| `methods` | `path` | 节点的脚本方法 |
| `call` | `path`, `method`, `args` | 调用方法 |
| `press` | `path` | 发出 `pressed` 信号 |
| `click` | `path` | 在节点中心注入鼠标按下/抬起 |
| `keys` | `node`, `prop` | 导出字典键类型 |
| `summary` | – | 精简状态：金币、农场、动物（给扩展用） |
| `cards` | – | 商店动物卡片（路径/type_id/价格/是否锁定） |
| `unfold` | – | 展开主界面（如果处于折叠状态） |
| `pet` | `index` | 摸一只动物（默认最饿的） |
| `feed_pick` | – | 拿起一份食物（5 金币） |
| `feed_drop` | `x`, `y` | 在牧场坐标放下食物 |
| `accept` | – | 接受开包结果（新动物落地） |
| `start_game` | – | 点开始菜单的「开始游戏」 |

mod 启动 2 秒后会自动调用一次 `start_game`（即使开始菜单把场景树暂停，probe 也以
`PROCESS_MODE_ALWAYS` 运行）。

## 构建

```powershell
pwsh -ExecutionPolicy Bypass -File .\build-all.ps1
```

产物：

- `dist/Coopanion-TinyPastureBridge-<version>.zip`（游戏 mod）
- `dist/cortico-world-pasture-<version>.tgz`（Coopanion 扩展，`npm pack`）

## 安全边界

- 不修改 `TinyPasture.exe` / `.pck` / 存档。
- 不写内存、不刷金币、不改价格或掉率。
- 动作只调用游戏自己的按钮与方法；金币、空位、确认页都由游戏校验。
- mod 是纯增量，删除 `mods/` 下的 zip 即完全恢复。
- 买动物默认关闭（`allowBuy: false`），开启后受每日预算限制；不提供卖动物、拆装饰的动作。

## 许可

MIT。Godot Mod Loader 为 CC0；Coopanion 为 AGPL-3.0-or-later，本项目不复制其代码。
