import { Request, Response } from 'express';
import rosbridgeService from '../services/rosbridgeService';

export const getRobotStatus = async (req: Request, res: Response) => {
  try {
    const connected = rosbridgeService.isConnected();
    
    // 从 rosbridge 获取真实的电池和水位数据
    let batteryLevel = 85;
    let waterLevel = 70;
    
    if (connected) {
      try {
        // 获取电池电量 - 使用 tryGetPoseFromTopic 类似的方法
        const batteryResult = await new Promise((resolve) => {
          let timeoutId: NodeJS.Timeout;
          let messageReceived = false;

          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            rosbridgeService.unsubscribeTopic('/battery_level');
          };

          timeoutId = setTimeout(() => {
            if (!messageReceived) {
              cleanup();
              resolve(null);
            }
          }, 2000);

          const tempHandler = (data: any) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.topic === '/battery_level' && message.msg) {
                messageReceived = true;
                cleanup();
                resolve(message.msg.data);
              }
            } catch (error) {
              console.error('Error parsing battery level:', error);
            }
          };

          const rosbridge = rosbridgeService.getRosbridge();
          if (rosbridge) {
            rosbridge.on('message', tempHandler);
            rosbridgeService.subscribeTopic('/battery_level', 'std_msgs/Float32');

            setTimeout(() => {
              rosbridge.removeListener('message', tempHandler);
            }, 2000);
          } else {
            resolve(null);
          }
        });
        
        if (batteryResult !== null) {
          batteryLevel = Math.round(batteryResult as number);
        }
      } catch (error) {
        console.log('Failed to get battery level, using default value');
      }
      
      try {
        // 获取水位
        const waterResult = await new Promise((resolve) => {
          let timeoutId: NodeJS.Timeout;
          let messageReceived = false;

          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            rosbridgeService.unsubscribeTopic('/water_level');
          };

          timeoutId = setTimeout(() => {
            if (!messageReceived) {
              cleanup();
              resolve(null);
            }
          }, 2000);

          const tempHandler = (data: any) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.topic === '/water_level' && message.msg) {
                messageReceived = true;
                cleanup();
                resolve(message.msg.data);
              }
            } catch (error) {
              console.error('Error parsing water level:', error);
            }
          };

          const rosbridge = rosbridgeService.getRosbridge();
          if (rosbridge) {
            rosbridge.on('message', tempHandler);
            rosbridgeService.subscribeTopic('/water_level', 'std_msgs/Float32');

            setTimeout(() => {
              rosbridge.removeListener('message', tempHandler);
            }, 2000);
          } else {
            resolve(null);
          }
        });
        
        if (waterResult !== null) {
          waterLevel = Math.round(waterResult as number);
        }
      } catch (error) {
        console.log('Failed to get water level, using default value');
      }
    }
    
    res.json({
      connected,
      position: { x: 0, y: 0, z: 0 },
      battery: batteryLevel,
      waterLevel: waterLevel,
      mode: 'auto',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get robot status' });
  }
};

// 获取电池状态详情
export const getBatteryStatus = async (req: Request, res: Response) => {
  try {
    if (!rosbridgeService.isConnected()) {
      return res.status(503).json({ 
        error: 'ROS bridge not connected',
        batteryLevel: 0,
        voltage: 0,
        current: 0,
        temperature: 0,
        chargeStatus: 'unknown'
      });
    }
    
    try {
      // 获取电池完整状态
      const batteryResult = await new Promise((resolve) => {
        let timeoutId: NodeJS.Timeout;
        let messageReceived = false;

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          rosbridgeService.unsubscribeTopic('/battery_status');
        };

        timeoutId = setTimeout(() => {
          if (!messageReceived) {
            cleanup();
            resolve(null);
          }
        }, 2000);

        const tempHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.topic === '/battery_status' && message.msg) {
              messageReceived = true;
              cleanup();
              resolve(message.msg);
            }
          } catch (error) {
            console.error('Error parsing battery status:', error);
          }
        };

        const rosbridge = rosbridgeService.getRosbridge();
        if (rosbridge) {
          rosbridge.on('message', tempHandler);
          rosbridgeService.subscribeTopic('/battery_status', 'sensor_msgs/BatteryState');

          setTimeout(() => {
            rosbridge.removeListener('message', tempHandler);
          }, 2000);
        } else {
          resolve(null);
        }
      }) as any;
      
      if (batteryResult) {
        res.json({
          batteryLevel: Math.round(batteryResult.percentage || 0),
          voltage: batteryResult.voltage || 0,
          current: batteryResult.current || 0,
          temperature: batteryResult.temperature || 0,
          charge: batteryResult.charge || 0,
          capacity: batteryResult.capacity || 0,
          power: batteryResult.power_supply_status === 1 ? (batteryResult.voltage * batteryResult.current) : 0,
          chargeStatus: batteryResult.power_supply_status === 1 ? 'charging' 
                       : batteryResult.power_supply_status === 2 ? 'discharging' 
                       : 'idle',
          lastUpdate: new Date().toISOString()
        });
      } else {
        // 如果获取失败，返回默认值
        res.json({
          batteryLevel: 0,
          voltage: 0,
          current: 0,
          temperature: 0,
          chargeStatus: 'unknown',
          lastUpdate: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.error('Failed to get battery status:', error);
      res.json({
        batteryLevel: 0,
        voltage: 0,
        current: 0,
        temperature: 0,
        chargeStatus: 'error',
        error: error.message,
        lastUpdate: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get battery status' });
  }
};

// 获取水位状态详情
export const getWaterStatus = async (req: Request, res: Response) => {
  try {
    if (!rosbridgeService.isConnected()) {
      return res.status(503).json({ 
        error: 'ROS bridge not connected',
        waterLevel: 0,
        status: 'unknown'
      });
    }
    
    try {
      // 获取水位数据
      const waterResult = await new Promise((resolve) => {
        let timeoutId: NodeJS.Timeout;
        let messageReceived = false;

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          rosbridgeService.unsubscribeTopic('/water_level');
        };

        timeoutId = setTimeout(() => {
          if (!messageReceived) {
            cleanup();
            resolve(null);
          }
        }, 2000);

        const tempHandler = (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.topic === '/water_level' && message.msg) {
              messageReceived = true;
              cleanup();
              resolve(message.msg.data);
            }
          } catch (error) {
            console.error('Error parsing water level:', error);
          }
        };

        const rosbridge = rosbridgeService.getRosbridge();
        if (rosbridge) {
          rosbridge.on('message', tempHandler);
          rosbridgeService.subscribeTopic('/water_level', 'std_msgs/Float32');

          setTimeout(() => {
            rosbridge.removeListener('message', tempHandler);
          }, 2000);
        } else {
          resolve(null);
        }
      });
      
      // 从水位百分比计算状态
      const level = waterResult !== null ? (waterResult as number) : 0;
      let status = 'unknown';
      let isLow = false;
      if (level < 10) {
        status = 'critical';
        isLow = true;
      } else if (level < 30) {
        status = 'low';
        isLow = true;
      } else if (level < 80) {
        status = 'normal';
      } else {
        status = 'high';
      }

      res.json({
        waterLevel: Math.round(level),
        status: status,
        isLow: isLow,
        lastUpdate: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Failed to get water status:', error);
      res.json({
        waterLevel: 0,
        status: 'error',
        isLow: false,
        error: error.message,
        lastUpdate: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get water status' });
  }
};

export const controlMotion = async (req: Request, res: Response) => {
  try {
    const { linear, angular } = req.body;
    
    rosbridgeService.publish('/manual/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: linear.x || 0, y: linear.y || 0, z: linear.z || 0 },
      angular: { x: angular.x || 0, y: angular.y || 0, z: angular.z || 0 },
    });

    res.json({ message: 'Motion command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control motion' });
  }
};

export const stopMotion = async (req: Request, res: Response) => {
  try {
    rosbridgeService.publish('/manual/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    res.json({ message: 'Robot stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop robot' });
  }
};

export const controlSpray = async (req: Request, res: Response) => {
  try {
    const { pump, leftArm, rightArm, leftValve, rightValve, height } = req.body;

    if (pump !== undefined) {
      rosbridgeService.publish('/spray/pump_control', 'std_msgs/Bool', { data: pump });
    }
    if (leftArm !== undefined) {
      rosbridgeService.publish('/spray/left_arm_control', 'std_msgs/String', { data: leftArm });
    }
    if (rightArm !== undefined) {
      rosbridgeService.publish('/spray/right_arm_control', 'std_msgs/String', { data: rightArm });
    }
    if (leftValve !== undefined) {
      rosbridgeService.publish('/spray/left_valve_control', 'std_msgs/Bool', { data: leftValve });
    }
    if (rightValve !== undefined) {
      rosbridgeService.publish('/spray/right_valve_control', 'std_msgs/Bool', { data: rightValve });
    }
    if (height !== undefined) {
      rosbridgeService.publish('/spray/arm_height_control', 'std_msgs/Bool', { data: height });
    }

    res.json({ message: 'Spray control command sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to control spray' });
  }
};

export const startNavigation = async (req: Request, res: Response) => {
  try {
    console.log('Starting navigation...');
    
    // 如果提供了导航目标，发送目标点
    if (req.body.goal) {
      const { goal } = req.body;
      
      // 获取当前时间戳
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      const nanosec = (now % 1000) * 1000000;
      
      // 使用话题发布导航目标
      const goalMessage = {
        header: {
          stamp: { sec, nanosec },
          frame_id: 'map'
        },
        pose: {
          position: {
            x: goal.position?.x || 0,
            y: goal.position?.y || 0,
            z: goal.position?.z || 0
          },
          orientation: {
            x: goal.orientation?.x || 0,
            y: goal.orientation?.y || 0,
            z: goal.orientation?.z || 0,
            w: goal.orientation?.w || 1
          }
        }
      };
      
      // 发布导航目标到Nav2
      rosbridgeService.publish('/goal_pose', 'geometry_msgs/PoseStamped', goalMessage);
      
      console.log('Navigation mode started and goal sent');
      
      res.json({ 
        message: '导航已启动，目标点已发送',
        goal: goalMessage,
        timestamp: new Date().toISOString()
      });
    } else {
      // 只切换模式，不发送目标
      console.log('Navigation mode started without goal');
      
      res.json({ 
        message: '导航已启动',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error starting navigation:', error);
    res.status(500).json({ error: 'Failed to start navigation' });
  }
};

export const stopNavigation = async (req: Request, res: Response) => {
  try {
    console.log('Stopping navigation via ROS topic...');
    
    // 通过 ROS2 话题发送停止导航指令（clean shutdown）
    rosbridgeService.publish('/navigation_task/stop', 'std_msgs/Empty', {});
    
    res.json({ 
      message: '导航已停止',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error stopping navigation:', error);
    res.status(500).json({ error: 'Failed to stop navigation' });
  }
};

// 紧急停止控制
export const emergencyStop = async (req: Request, res: Response) => {
  try {
    const { action } = req.body; // 'stop' 或 'reset'
    
    if (action === 'stop') {
      // 触发紧急停止
      const result = await rosbridgeService.callService('/emergency_stop', 'std_srvs/SetBool', { data: true });
      
      res.json({
        success: true,
        message: '紧急停止已激活 - 所有运动和喷淋已停止',
        timestamp: new Date().toISOString(),
        action: 'stop'
      });
      
    } else if (action === 'reset') {
      // 复位紧急停止
      const result = await rosbridgeService.callService('/emergency_stop', 'std_srvs/SetBool', { data: false });
      
      res.json({
        success: true,
        message: '紧急停止已复位 - 系统可正常操作',
        timestamp: new Date().toISOString(),
        action: 'reset'
      });
      
    } else {
      res.status(400).json({ 
        success: false,
        error: '无效的操作类型，仅支持 "stop" 或 "reset"' 
      });
    }
    
  } catch (error) {
    console.error('Emergency stop error:', error);
    res.status(500).json({ 
      success: false,
      error: '紧急停止操作失败' 
    });
  }
};
