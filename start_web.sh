#!/bin/bash
# 生产模式启动Web服务（后端 + 充电桩代理）
# 用法: ./start_web.sh
# systemctl自启动: ExecStart=/home/jetson/yahboomcar_ros2_ws/web/backend/start_web.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# --- 充电桩代理服务 (端口 5001) ---
PROXY_PID=$(pgrep -f "charging_proxy_server" | head -1)
if [ -n "$PROXY_PID" ]; then
    echo "[充电桩代理] 已在运行 (PID: $PROXY_PID)"
else
    echo "[充电桩代理] 启动中..."
    python3 "$SCRIPT_DIR/charging_proxy_server.py" >> "$LOG_DIR/charging_proxy.log" 2>&1 &
    PROXY_PID=$!
    sleep 1
    if ps -p $PROXY_PID > /dev/null 2>&1; then
        echo "[充电桩代理] 已启动 (PID: $PROXY_PID)"
    else
        echo "[充电桩代理] 启动失败（充电控制不可用）"
    fi
fi

# --- 停止旧的后端进程 ---
OLD_PID=$(pgrep -f "node.*dist/app.js" | head -1)
if [ -n "$OLD_PID" ]; then
    echo "[后端] 停止旧进程 (PID: $OLD_PID)..."
    kill $OLD_PID 2>/dev/null
    sleep 1
    if ps -p $OLD_PID > /dev/null 2>&1; then
        kill -9 $OLD_PID 2>/dev/null
    fi
    echo "[后端] 旧进程已停止"
fi

# --- 启动后端（已包含前端静态文件托管） ---
cd "$SCRIPT_DIR"

if [ ! -d "dist" ]; then
    echo "[后端] 未找到编译产物，请先运行 npm run build"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[后端] 安装依赖..."
    npm install --production
fi

echo "[后端] 启动生产服务 (端口 3000)..."
NODE_ENV=production node dist/app.js
