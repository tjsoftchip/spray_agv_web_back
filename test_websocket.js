const io = require('../frontend/node_modules/socket.io-client');

console.log('开始测试WebSocket连接到后端...');

const socket = io('http://localhost:3000', {
  transports: ['websocket']
});

let connected = false;
let msgCount = 0;

socket.on('connect', () => {
  connected = true;
  console.log('✓ Socket连接成功! ID:', socket.id);
  
  // 订阅odom_raw话题
  const subscribeCmd = {
    op: 'subscribe',
    topic: '/odom_raw',
    type: 'nav_msgs/Odometry'
  };
  
  socket.emit('ros_command', subscribeCmd);
  console.log('✓ 已发送odom_raw订阅请求:', subscribeCmd);
});

socket.on('disconnect', () => {
  connected = false;
  console.log('✗ Socket连接断开');
});

socket.on('connect_error', (error) => {
  console.error('✗ Socket连接错误:', error.message);
});

socket.on('ros_message', (data) => {
  if (data.topic === '/odom_raw') {
    msgCount++;
    const linearVel = data.msg?.twist?.twist?.linear?.x || 0;
    const angularVel = data.msg?.twist?.twist?.angular?.z || 0;
    
    console.log(`[${msgCount}] 收到odom_raw数据:`, {
      线速度: linearVel.toFixed(6),
      角速度: angularVel.toFixed(6),
      合速度: Math.abs(linearVel).toFixed(6)
    });
  }
});

// 10秒后断开连接
setTimeout(() => {
  if (connected) {
    console.log('测试结束，断开连接');
    console.log(`总共收到 ${msgCount} 条odom消息`);
  } else {
    console.log('测试失败，未能建立连接');
  }
  socket.disconnect();
  process.exit(0);
}, 10000);

console.log('等待连接...');