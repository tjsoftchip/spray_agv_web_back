#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import Header

class WebCmdVelMux(Node):
    def __init__(self):
        super().__init__('web_cmd_vel_mux')
        
        # 订阅web控制命令
        self.web_subscription = self.create_subscription(
            Twist,
            '/web_cmd_vel',
            self.web_cmd_vel_callback,
            10  # 高QoS以获得更高优先级
        )
        
        # 发布到manual/cmd_vel，让cmd_vel_mux_node统一处理
        self.cmd_vel_publisher = self.create_publisher(
            Twist,
            '/manual/cmd_vel',
            10
        )
        
        # 创建定时器，持续发送最后一次的web命令（如果非零）
        self.timer = self.create_timer(0.05, self.timer_callback)  # 20Hz
        self.last_web_cmd = Twist()
        self.last_web_cmd_time = 0
        
        self.get_logger().info('WebCmdVelMux node started')

    def web_cmd_vel_callback(self, msg):
        """接收web控制命令并立即转发"""
        self.last_web_cmd = msg
        self.last_web_cmd_time = self.get_clock().now().nanoseconds
        
        # 立即转发命令
        self.cmd_vel_publisher.publish(msg)
        self.get_logger().info(f'Relayed web cmd_vel: linear.x={msg.linear.x:.2f}, angular.z={msg.angular.z:.2f}')

    def timer_callback(self):
        """定时器回调，只在有活跃的摇杆控制时持续发送命令"""
        current_time = self.get_clock().now().nanoseconds
        
        # 如果500ms内有web命令且命令非零，则持续发送
        # 缩短时间窗口确保摇杆松开后能快速停止
        if (current_time - self.last_web_cmd_time < 5e8 and 
            (abs(self.last_web_cmd.linear.x) > 0.01 or abs(self.last_web_cmd.angular.z) > 0.01)):
            self.cmd_vel_publisher.publish(self.last_web_cmd)
        elif current_time - self.last_web_cmd_time >= 5e8:
            # 超过时间窗口，发送停止命令确保机器人停止
            stop_cmd = Twist()
            self.cmd_vel_publisher.publish(stop_cmd)
            self.get_logger().debug('Timeout reached, sending stop command')

def main(args=None):
    rclpy.init(args=args)
    node = WebCmdVelMux()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()