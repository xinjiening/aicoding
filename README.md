# 我们家 — V1 经期助手

夫妻共用的 AI 家庭仪表盘 · 微信小程序。设计文档：`~/.gstack/projects/ai-family/`。

## 当前进度

V1 P0 已经全部落代码（mock 模式可直接运行）：

- ✅ 数据模型 + 类型契约（`miniprogram/types/event.d.ts`）
- ✅ 4 个云函数：`whoami` / `home-bundle` / `data-rw` / `ping`（含 M2 upsert + M3 24h 去重事务）
- ✅ 3 个自定义组件：`widget-card` / `recorder-badge` / `period-calendar`（D4 自写，不依赖第三方 UI 库）
- ✅ 4 个页面：`home`（仪表盘 + 一键今天来了 + 撤销 toast）/ `period`（日历 + 列表 + 软删除）/ `record`（subject 选 + 快速标签 + 流量 + 备注）/ `about`（设置 + 隐藏调试菜单）
- ✅ 核心算法（`utils/period.ts` 严格遵循 M1：4 case 显式处理 + null 兜底）
- ✅ 统一云函数代理 + 1 秒去抖（`utils/api.ts`）
- ⏸ P1 AI 自然语言解析（占位入口在 record 页底部，待 V1.1）
- ⏸ P2 订阅消息推送（按 plan 暂砍到 V2）

## 在开发者工具里跑起来（5 步）

1. 打开「微信开发者工具」→ 导入项目 → 选 **`/Users/ningxinjie/Documents/z_learn/ai-family/aicoding`** 目录（注意是 `aicoding/`，不是 `ai-family/`）
2. AppID 已配置：`wx984692737e087236`，无需改
3. 第一次打开会弹「云开发未配置」横幅 — **正常**，进入 mock 模式即可立刻看 UI
4. 点底部 tab 切换 4 个页面，点「今天来了」「记一笔」感受流程
5. mock 数据存本地 storage（仅当前设备 / 项目）

## 接入云开发（让数据真正在云端持久化）

1. 微信开发者工具顶部 → 「云开发」 → 开通环境（免费），拿到 **envId**
2. 编辑 `miniprogram/constants.ts`，把 `CLOUD_ENV` 改成实际 envId
3. 在 `cloudfunctions/` 下：右键每个云函数文件夹 → **上传并部署：云端安装依赖**
   - `whoami` / `ping` / `home-bundle` / `data-rw`
4. 云开发控制台 → 数据库，建 2 个集合：`families` / `events`，权限均设为 **「仅创建者可读写」**（V1 简化版；正式部署应按 design D1 设为 `{read:false, write:false}`，强制走云函数）
5. 重新编译 → 进首页应不再看到「mock 模式」横幅

## 目录结构

```
aicoding/
├── cloudfunctions/
│   ├── whoami/             # bootstrap：注册 family + 推断角色
│   ├── ping/               # 保活
│   ├── home-bundle/        # 首屏一次性返回 user+events+stats
│   └── data-rw/            # 所有 events 表读写代理（含 24h 去重事务）
├── miniprogram/
│   ├── app.ts              # 云开发初始化 + bootstrap whoami + 周期 ping
│   ├── app.json            # tabBar / Skyline / glass-easel
│   ├── app.less            # 全局设计语言（卡片/按钮/chip/空态）
│   ├── constants.ts        # CLOUD_ENV / DEDUP_WINDOW / SYMPTOM_TAGS / FLOW_LEVELS
│   ├── types/event.d.ts    # AppEvent / Family / UserInfo / PeriodStats / HomeBundle
│   ├── utils/
│   │   ├── api.ts          # 云函数代理 + 1s 去抖 + Mock 降级层
│   │   ├── period.ts       # 状态机算法（M1 显式 4 case）
│   │   ├── auth.ts         # 角色文案 + 权限判定
│   │   └── format.ts       # 日期/时间格式化
│   ├── components/
│   │   ├── navigation-bar/ # ✅ 已有模板
│   │   ├── widget-card/    # 仪表盘卡片
│   │   ├── recorder-badge/ # by 我 / by 老婆 标签
│   │   └── period-calendar/# 自写月历（Skyline 兼容）
│   └── pages/
│       ├── home/           # 仪表盘
│       ├── period/         # 日历 + 备注列表
│       ├── record/         # 记一笔
│       └── about/          # 设置 + 调试菜单
└── typings/                # TS 类型定义
```

## 关键设计契约（M1/M2/M3 实现位置）

- **M1（period.ts 4 case 显式处理）** → `miniprogram/utils/period.ts:calculatePeriodStats`
- **M2（whoami atomic upsert + addToSet）** → `cloudfunctions/whoami/index.js`、`cloudfunctions/home-bundle/index.js:ensureFamilyMembership`
- **M3（24h 去重事务）** → `cloudfunctions/data-rw/index.js:createEvent` 内的 `db.runTransaction`
- **D1（前端不直连 db）** → `miniprogram/utils/api.ts` 全部走 `wx.cloud.callFunction`
- **D4（自写月历）** → `miniprogram/components/period-calendar/`
- **D5（统一 API + 共享类型 + 1s 去抖）** → `miniprogram/utils/api.ts:callWithDedup`
- **D7（home-bundle 一次拉满）** → `cloudfunctions/home-bundle/`

## Manual Smoke Test（上线前 30 分钟过一遍）

参考 `~/.gstack/projects/ai-family/ningxinjie-initial-eng-review-test-plan-20260506-150153.md`：T1-T14 共 14 个手测用例。Mock 模式下也能完整跑（含双人切换 → about 页隐藏菜单：连点「关于」标题 7 下解锁）。

## 下一步（按 design 文档优先级）

1. 验证医疗类目（R2，1h，编码前最高优先级 — 个人主体能否上线经期类目）
2. 接入云开发（按上面 5 步），完成 P0 → 在真机跑一遍
3. P1 AI 自然语言（在 record 页加自由输入框 + 写 ai-parse 云函数 + 调智谱 GLM-4-Flash）
4. P2 订阅消息（如时间够，5h 上限，超时砍到 V2）
