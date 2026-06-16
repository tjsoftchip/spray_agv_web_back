#!/usr/bin/env python3
"""
充电桩MODBUS TCP代理服务器

提供一个HTTP API接口,用于与充电桩进行MODBUS TCP通信
这样可以避免Node.js的modbus-serial库在高延迟网络下的问题
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from pymodbus.client import ModbusTcpClient
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# 充电桩配置
CHARGING_IP = '192.168.0.65'
CHARGING_PORT = 502

def get_modbus_client():
    """获取MODBUS客户端"""
    client = ModbusTcpClient(
        host=CHARGING_IP,
        port=CHARGING_PORT,
        timeout=15.0,
        retries=2
    )
    return client

@app.route('/api/charging/status', methods=['GET'])
def get_charging_status():
    """获取充电桩状态"""
    try:
        ip = request.args.get('ip', CHARGING_IP)
        port = int(request.args.get('port', CHARGING_PORT))
        
        logger.info(f"Getting charging status from {ip}:{port}")
        
        client = ModbusTcpClient(
            host=ip,
            port=port,
            timeout=15.0,
            retries=2
        )
        
        if not client.connect():
            return jsonify({
                'success': False,
                'error': 'Connection failed',
                'ip': ip,
                'port': port
            }), 500
        
        # 读取保持寄存器 4x00-4x07 (地址 0-7)
        result = client.read_holding_registers(address=0, count=8)
        
        if result.isError():
            client.close()
            return jsonify({
                'success': False,
                'error': str(result),
                'ip': ip,
                'port': port
            }), 500
        
        # 读取充电模式寄存器 4x04 (地址4)
        mode_result = client.read_holding_registers(address=4, count=1)
        
        # 读取心跳寄存器 4x20 (地址32)
        heartbeat_result = client.read_holding_registers(address=32, count=1)
        
        client.close()
        
        return jsonify({
            'success': True,
            'data': {
                'chargingStatus': result.registers[0],
                'brushStatus': result.registers[1],
                'batteryVoltage': result.registers[5],
                'chargingCurrent': result.registers[6],
                'endCurrent': result.registers[7],
                'chargingMode': mode_result.registers[0] if not mode_result.isError() else 0,
                'heartbeat': heartbeat_result.registers[0] if not heartbeat_result.isError() else 0,
                'ip': ip,
                'port': port
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting charging status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/charging/start', methods=['POST'])
def start_charging():
    """开始充电"""
    try:
        data = request.get_json()
        ip = data.get('ip', CHARGING_IP)
        port = int(data.get('port', CHARGING_PORT))
        
        logger.info(f"Starting charging on {ip}:{port}")

        client = ModbusTcpClient(
            host=ip,
            port=port,
            timeout=15.0,
            retries=2
        )
        
        if not client.connect():
            return jsonify({
                'success': False,
                'error': 'Connection failed'
            }), 500
        
        # 写入寄存器 4x02 (地址2) = 1 开始充电
        result = client.write_register(address=2, value=1)
        
        client.close()
        
        if result.isError():
            return jsonify({
                'success': False,
                'error': str(result)
            }), 500
        
        return jsonify({
            'success': True,
            'message': 'Charging started'
        })
        
    except Exception as e:
        logger.error(f"Error starting charging: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/charging/stop', methods=['POST'])
def stop_charging():
    """停止充电"""
    try:
        data = request.get_json()
        ip = data.get('ip', CHARGING_IP)
        port = int(data.get('port', CHARGING_PORT))
        
        logger.info(f"Stopping charging on {ip}:{port}")

        client = ModbusTcpClient(
            host=ip,
            port=port,
            timeout=15.0,
            retries=2
        )
        
        if not client.connect():
            return jsonify({
                'success': False,
                'error': 'Connection failed'
            }), 500
        
        # 写入寄存器 4x03 (地址3) = 1 结束充电
        result = client.write_register(address=3, value=1)
        
        client.close()
        
        if result.isError():
            return jsonify({
                'success': False,
                'error': str(result)
            }), 500
        
        return jsonify({
            'success': True,
            'message': 'Charging stopped'
        })
        
    except Exception as e:
        logger.error(f"Error stopping charging: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'service': 'charging-proxy'
    })

if __name__ == '__main__':
    print("="*60)
    print("充电桩MODBUS TCP代理服务器")
    print("="*60)
    print(f"充电桩地址: {CHARGING_IP}:{CHARGING_PORT}")
    print("服务器端口: 5001")
    print("="*60)
    print()
    
    app.run(host='0.0.0.0', port=5001, debug=False)