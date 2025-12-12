# 梁场养护机器人 - Web后端服务

基于Node.js + Express + TypeScript + Socket.IO的后端服务，提供RESTful API和WebSocket实时通信。

## 技术栈

- **运行环境**: Node.js 18.x
- **Web框架**: Express 5.x
- **实时通信**: Socket.IO 4.x
- **数据库**: SQLite 3.x
- **ORM**: Sequelize 6.x
- **认证**: JWT
- **语言**: TypeScript 5.x

## 项目结构

```
backend/
├── src/
│   ├── config/          # 配置文件
│   ├── models/          # 数据模型
│   ├── controllers/     # 控制器
│   ├── routes/          # 路由
│   ├── middleware/      # 中间件
│   ├── services/        # 服务层
│   ├── utils/           # 工具函数
│   ├── types/           # TypeScript类型定义
│   └── app.ts           # 应用入口
├── data/                # 数据库文件
├── dist/                # 编译输出
├── .env                 # 环境变量
├── .env.example         # 环境变量示例
├── tsconfig.json        # TypeScript配置
└── package.json         # 项目配置

```

## 安装依赖

```bash
npm install
```

## 环境配置

复制 `.env.example` 到 `.env` 并修改配置：

```bash
cp .env.example .env
```

## 开发模式

```bash
npm run dev
```

## 构建生产版本

```bash
npm run build
```

## 启动生产服务

```bash
npm start
```

## API文档

### 认证接口

- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `POST /api/auth/refresh` - 刷新令牌

### 模板管理接口

- `GET /api/templates` - 获取模板列表
- `GET /api/templates/:id` - 获取模板详情
- `POST /api/templates` - 创建模板
- `PUT /api/templates/:id` - 更新模板
- `DELETE /api/templates/:id` - 删除模板

### 任务管理接口

- `GET /api/tasks` - 获取任务列表
- `GET /api/tasks/:id` - 获取任务详情
- `POST /api/tasks` - 创建任务
- `PUT /api/tasks/:id` - 更新任务
- `DELETE /api/tasks/:id` - 删除任务
- `POST /api/tasks/:id/execute` - 执行任务
- `POST /api/tasks/:id/pause` - 暂停任务
- `POST /api/tasks/:id/resume` - 恢复任务
- `POST /api/tasks/:id/stop` - 停止任务

## WebSocket事件

- `ros_message` - ROS消息推送
- `ros_command` - 发送ROS命令

## 默认用户

- 用户名: `admin`
- 密码: `admin123`
- 角色: 管理员

## 注意事项

1. 确保ROS2 rosbridge服务已启动（默认端口9090）
2. 生产环境请修改JWT密钥
3. 数据库文件存储在 `data/` 目录
