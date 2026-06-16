#!/bin/bash
# 开机自启 ROS2 四层服务
# 被 systemd yahboom-ros2.service 调用

set -e

LOG_DIR="/home/jetson/yahboomcar_ros2_ws/web/logs"
mkdir -p "$LOG_DIR"

export ROS_DOMAIN_ID=76
export ROS_LOCALHOST_ONLY=1
export ROBOT_TYPE=r2
export RPLIDAR_TYPE=4ROS
export CAMERA_TYPE=astraplus

source /opt/ros/humble/setup.bash
source /home/jetson/yahboomcar_ros2_ws/software/library_ws/install/setup.bash
source /home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/install/setup.bash

cleanup() {
    echo "[ROS2] 收到退出信号，关闭所有 ros2 launch 进程..."
    pkill -f "ros2 launch" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

echo "[ROS2] Layer 1: 启动常驻节点 (resident_nodes)..."
ros2 launch yahboomcar_bringup resident_nodes_launch.py >> "$LOG_DIR/layer1_resident.log" 2>&1 &
PID1=$!
sleep 5

echo "[ROS2] Layer 2: 启动传感器 (shared_sensors)..."
ros2 launch yahboomcar_nav shared_sensors_launch.py >> "$LOG_DIR/layer2_sensors.log" 2>&1 &
PID2=$!
sleep 3

echo "[ROS2] Layer 3: 启动导航栈 (navigation_unified_gps)..."
ros2 launch yahboomcar_nav navigation_unified_gps_launch.py >> "$LOG_DIR/layer3_nav.log" 2>&1 &
PID3=$!
sleep 5

echo "[ROS2] Layer 4: 启动导航作业 (navigation_operation)..."
ros2 launch yahboomcar_nav navigation_operation_launch.py >> "$LOG_DIR/layer4_operation.log" 2>&1 &
PID4=$!

echo "[ROS2] 四层服务已全部启动，PID: $PID1 $PID2 $PID3 $PID4"
echo "[ROS2] 日志目录: $LOG_DIR"

wait
