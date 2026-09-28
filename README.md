# 昆虫标本采集记录台（gbinsectlog）

面向野外昆虫调查队与标本馆技术员，把「标本采集 → 采集地与生境 → 鉴定状态 → 保藏位置」串成一条可追溯的编目链路，解决采集标签手写易错、鉴定进度无人跟踪、标本入柜后找不到位置的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21815>

常用命令：

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbinsectlog
FRONTEND_PORT=21815
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落，支持直接刷新子路由） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21815
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1115/
├── docker-compose.yml          # 顶层 name: gbinsectlog，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── tailwind.config.js / postcss.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # specimen.ts / site.ts / storage.ts / determination.ts / index.ts
│       ├── stores/             # specimenStore / siteStore / storageStore / determinationStore（Zustand）
│       ├── components/common/  # SpecimenCard / StatusTag / CabinetGrid / SitePicker
│       ├── hooks/              # usePersistentStore / useSpecimenFilter
│       ├── pages/              # SpecimensPage / SitesPage / CollectPage / DeterminationPage / StoragePage
│       ├── router/index.tsx
│       └── utils/              # codec.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Specimen 标本 | 编号、目/科/属/种、暂定名、采集日期与人、性别虫态、体长、采集方式、数量、鉴定状态 | `specimens` |
| CollectSite 采集地 | 代码、名称、行政区、经纬度海拔、生境类型、小生境、微气候、采集日期区间 | `sites` |
| Storage 保藏位置 | 保藏方式、柜/抽屉/盒/插位序号、入柜日期、经手人 | `storages` |
| Determination 鉴定记录 | 类型（初鉴/复核）、鉴定人、日期、结论（学名）、依据文献、置信度、是否需复核、复核是否与原结论一致 | `determinations` |

- 数据库名 `gbinsectlog`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史标本补齐默认采集方式（扫网）；`version(3)` 为历史鉴定记录补齐「初鉴」类型与空的复核一致性字段；
- 标本编号规则：`采集地代码-年份-流水号`（如 `QLB-2026-0007`），提交时自动分配并查重；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/specimens` | 标本清单：按目/科、鉴定状态、采集地、采集日期区间与关键字组合筛选，多选批量推进鉴定状态，导出命中清单 |
| `/collect` | 采集登记：选择采集地后自动带出生境/小生境/微气候，一次提交多条同批次标本，编号自动生成并查重 |
| `/sites` | 采集地管理：经纬度格式校验、各地采集次数统计、50 米内邻近采集地提示与一键合并 |
| `/determination` | 鉴定工作流：待鉴定队列逐条处理；初鉴疑难标本转「待复核」后由另一名鉴定人独立复核（同人不保存，一致进已鉴定、不一致保留待复核），全部初鉴/复核意见留痕 |
| `/storage` | 保藏柜位图：柜-抽屉-盒-位三级展开，空位/占用一目了然，拖拽入柜，重复占用给出占用提示 |

## 七、业务约定

- 采集地代码是标本编号前缀，代码重复会被拒绝；
- 坐标 50 米内视为同一采集地，页面上给出合并提示，合并会把原采集地标本自动改挂；
- 初鉴提交后自动把标本推进为「已鉴定」；勾选「需复核」则置为「待复核」，原初鉴结论与依据始终保留可查；
- **独立复核**：「待复核」标本只能在鉴定工作流中复核——复核人与初鉴人为同一人时不保存；须独立填好复核依据与结论，与原结论一致才进入「已鉴定」，不一致则保留「待复核」等待再次复核；每条复核记录标注「一致 / 不一致」，谁初鉴、谁复核均可追溯；
- 复核结束前，标本清单的「批量推进状态」会跳过「待复核」标本（给出编号提示），保藏柜位图也禁止把「待复核」标本拖入/选入柜位，两条路都不能绕过复核把它当成已定名；
- 同一柜位（柜-屉-盒-位）只允许一份标本，冲突时列出已有标本编号。
