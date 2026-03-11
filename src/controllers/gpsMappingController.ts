import { Request, Response } from 'express';
import sequelize from '../config/database';
import { UTMConverter } from '../services/utmConverter';

// GPS数据存储（模拟）
interface GPSPoint {
  latitude: number;
  longitude: number;
  altitude: number;
  mapX: number;
  mapY: number;
}

interface RoutePoint extends GPSPoint {
  id: string;
  name: string;
  type: 'normal' | 'turn';
  timestamp: Date;
}

interface TurnPoint extends GPSPoint {
  id: string;
  name: string;
  turnAngle: number; // 转弯角度
  timestamp: Date;
}

interface BeamPosition extends GPSPoint {
  id: string;
  name: string;
  length: number;
  width: number;
  faces: {
    north?: string;
    south?: string;
    east?: string;
    west?: string;
  };
  timestamp: Date;
}

interface GPSMap {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  origin: GPSPoint; // 地图原点
  routePoints: RoutePoint[];
  turnPoints: TurnPoint[];
  beamPositions: BeamPosition[];
  calibrationPoints: {
    gpsPoint: GPSPoint;
    mapPoint: { x: number; y: number };
  }[];
}

// 内存存储（实际应用中应使用数据库）
let savedGPSMaps: GPSMap[] = [];
let currentGPSStatus = {
  quality: 0,
  satellites: 0,
  hdop: 99.99,
  latitude: 0,
  longitude: 0,
  altitude: 0,
  isFixed: false,
  lastUpdate: new Date()
};

// UTM坐标转换服务
const utmConverter = new UTMConverter();

// 获取GPS状态（本地）
export const getGPSStatusLocal = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: currentGPSStatus
    });
  } catch (error) {
    console.error('获取GPS状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取GPS状态失败'
    });
  }
};

// 获取GPS状态（认证）
export const getGPSStatus = async (req: Request, res: Response) => {
  return getGPSStatusLocal(req, res);
};

// 获取保存的GPS地图列表（本地）
export const getSavedMapsLocal = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: savedGPSMaps.map(map => ({
        id: map.id,
        name: map.name,
        description: map.description,
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
        routePointCount: map.routePoints.length,
        turnPointCount: map.turnPoints.length,
        beamPositionCount: map.beamPositions.length
      }))
    });
  } catch (error) {
    console.error('获取GPS地图列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取GPS地图列表失败'
    });
  }
};

// 获取保存的GPS地图列表（认证）
export const getSavedMaps = async (req: Request, res: Response) => {
  return getSavedMapsLocal(req, res);
};

// 保存GPS地图（本地）
export const saveGPSMapLocal = async (req: Request, res: Response) => {
  try {
    const { name, description, origin, routePoints, turnPoints, beamPositions, calibrationPoints } = req.body;

    const newMap: GPSMap = {
      id: `gps-map-${Date.now()}`,
      name: name || `GPS地图 ${savedGPSMaps.length + 1}`,
      description: description || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      origin: origin || { latitude: 0, longitude: 0, altitude: 0, mapX: 0, mapY: 0 },
      routePoints: routePoints || [],
      turnPoints: turnPoints || [],
      beamPositions: beamPositions || [],
      calibrationPoints: calibrationPoints || []
    };

    savedGPSMaps.push(newMap);

    res.json({
      success: true,
      data: newMap,
      message: 'GPS地图保存成功'
    });
  } catch (error) {
    console.error('保存GPS地图失败:', error);
    res.status(500).json({
      success: false,
      message: '保存GPS地图失败'
    });
  }
};

// 保存GPS地图（认证）
export const saveGPSMap = async (req: Request, res: Response) => {
  return saveGPSMapLocal(req, res);
};

// 加载GPS地图（本地）
export const loadGPSMapLocal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const map = savedGPSMaps.find(m => m.id === id);

    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    res.json({
      success: true,
      data: map,
      message: 'GPS地图加载成功'
    });
  } catch (error) {
    console.error('加载GPS地图失败:', error);
    res.status(500).json({
      success: false,
      message: '加载GPS地图失败'
    });
  }
};

// 加载GPS地图（认证）
export const loadGPSMap = async (req: Request, res: Response) => {
  return loadGPSMapLocal(req, res);
};

// 删除GPS地图（本地）
export const deleteGPSMapLocal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const index = savedGPSMaps.findIndex(m => m.id === id);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    savedGPSMaps.splice(index, 1);

    res.json({
      success: true,
      message: 'GPS地图删除成功'
    });
  } catch (error) {
    console.error('删除GPS地图失败:', error);
    res.status(500).json({
      success: false,
      message: '删除GPS地图失败'
    });
  }
};

// 删除GPS地图（认证）
export const deleteGPSMap = async (req: Request, res: Response) => {
  return deleteGPSMapLocal(req, res);
};

// 添加路线点
export const addRoutePoint = async (req: Request, res: Response) => {
  try {
    const { mapId, name, latitude, longitude, altitude, type } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    // 转换为地图坐标
    const { x: mapX, y: mapY } = utmConverter.convertGPSToMap(latitude, longitude, map.origin);

    const newPoint: RoutePoint = {
      id: `rp-${Date.now()}`,
      name: name || `路线点 ${map.routePoints.length + 1}`,
      latitude,
      longitude,
      altitude: altitude || 0,
      mapX,
      mapY,
      type: type || 'normal',
      timestamp: new Date()
    };

    map.routePoints.push(newPoint);
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: newPoint,
      message: '路线点添加成功'
    });
  } catch (error) {
    console.error('添加路线点失败:', error);
    res.status(500).json({
      success: false,
      message: '添加路线点失败'
    });
  }
};

// 删除路线点
export const deleteRoutePoint = async (req: Request, res: Response) => {
  try {
    const { pointId } = req.params;
    const { mapId } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const index = map.routePoints.findIndex(p => p.id === pointId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '路线点不存在'
      });
    }

    map.routePoints.splice(index, 1);
    map.updatedAt = new Date();

    res.json({
      success: true,
      message: '路线点删除成功'
    });
  } catch (error) {
    console.error('删除路线点失败:', error);
    res.status(500).json({
      success: false,
      message: '删除路线点失败'
    });
  }
};

// 更新路线点
export const updateRoutePoint = async (req: Request, res: Response) => {
  try {
    const { pointId } = req.params;
    const { mapId, name, type } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const point = map.routePoints.find(p => p.id === pointId);
    if (!point) {
      return res.status(404).json({
        success: false,
        message: '路线点不存在'
      });
    }

    if (name) point.name = name;
    if (type) point.type = type;
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: point,
      message: '路线点更新成功'
    });
  } catch (error) {
    console.error('更新路线点失败:', error);
    res.status(500).json({
      success: false,
      message: '更新路线点失败'
    });
  }
};

// 添加转弯点
export const addTurnPoint = async (req: Request, res: Response) => {
  try {
    const { mapId, name, latitude, longitude, altitude, turnAngle } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const { x: mapX, y: mapY } = utmConverter.convertGPSToMap(latitude, longitude, map.origin);

    const newPoint: TurnPoint = {
      id: `tp-${Date.now()}`,
      name: name || `转弯点 ${map.turnPoints.length + 1}`,
      latitude,
      longitude,
      altitude: altitude || 0,
      mapX,
      mapY,
      turnAngle: turnAngle || 90,
      timestamp: new Date()
    };

    map.turnPoints.push(newPoint);
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: newPoint,
      message: '转弯点添加成功'
    });
  } catch (error) {
    console.error('添加转弯点失败:', error);
    res.status(500).json({
      success: false,
      message: '添加转弯点失败'
    });
  }
};

// 删除转弯点
export const deleteTurnPoint = async (req: Request, res: Response) => {
  try {
    const { pointId } = req.params;
    const { mapId } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const index = map.turnPoints.findIndex(p => p.id === pointId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '转弯点不存在'
      });
    }

    map.turnPoints.splice(index, 1);
    map.updatedAt = new Date();

    res.json({
      success: true,
      message: '转弯点删除成功'
    });
  } catch (error) {
    console.error('删除转弯点失败:', error);
    res.status(500).json({
      success: false,
      message: '删除转弯点失败'
    });
  }
};

// 更新转弯点
export const updateTurnPoint = async (req: Request, res: Response) => {
  try {
    const { pointId } = req.params;
    const { mapId, name, turnAngle } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const point = map.turnPoints.find(p => p.id === pointId);
    if (!point) {
      return res.status(404).json({
        success: false,
        message: '转弯点不存在'
      });
    }

    if (name) point.name = name;
    if (turnAngle !== undefined) point.turnAngle = turnAngle;
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: point,
      message: '转弯点更新成功'
    });
  } catch (error) {
    console.error('更新转弯点失败:', error);
    res.status(500).json({
      success: false,
      message: '更新转弯点失败'
    });
  }
};

// 添加梁位置
export const addBeamPosition = async (req: Request, res: Response) => {
  try {
    const { mapId, name, latitude, longitude, altitude, length, width, faces } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const { x: mapX, y: mapY } = utmConverter.convertGPSToMap(latitude, longitude, map.origin);

    const newPosition: BeamPosition = {
      id: `bp-${Date.now()}`,
      name: name || `梁位 ${map.beamPositions.length + 1}`,
      latitude,
      longitude,
      altitude: altitude || 0,
      mapX,
      mapY,
      length: length || 30,
      width: width || 2,
      faces: faces || {},
      timestamp: new Date()
    };

    map.beamPositions.push(newPosition);
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: newPosition,
      message: '梁位置添加成功'
    });
  } catch (error) {
    console.error('添加梁位置失败:', error);
    res.status(500).json({
      success: false,
      message: '添加梁位置失败'
    });
  }
};

// 删除梁位置
export const deleteBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const { mapId } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const index = map.beamPositions.findIndex(p => p.id === beamId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '梁位置不存在'
      });
    }

    map.beamPositions.splice(index, 1);
    map.updatedAt = new Date();

    res.json({
      success: true,
      message: '梁位置删除成功'
    });
  } catch (error) {
    console.error('删除梁位置失败:', error);
    res.status(500).json({
      success: false,
      message: '删除梁位置失败'
    });
  }
};

// 更新梁位置
export const updateBeamPosition = async (req: Request, res: Response) => {
  try {
    const { beamId } = req.params;
    const { mapId, name, length, width, faces } = req.body;

    const map = savedGPSMaps.find(m => m.id === mapId);
    if (!map) {
      return res.status(404).json({
        success: false,
        message: 'GPS地图不存在'
      });
    }

    const position = map.beamPositions.find(p => p.id === beamId);
    if (!position) {
      return res.status(404).json({
        success: false,
        message: '梁位置不存在'
      });
    }

    if (name) position.name = name;
    if (length !== undefined) position.length = length;
    if (width !== undefined) position.width = width;
    if (faces) position.faces = faces;
    map.updatedAt = new Date();

    res.json({
      success: true,
      data: position,
      message: '梁位置更新成功'
    });
  } catch (error) {
    console.error('更新梁位置失败:', error);
    res.status(500).json({
      success: false,
      message: '更新梁位置失败'
    });
  }
};

// GPS坐标转地图坐标
export const convertGPSToMap = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, originLatitude, originLongitude } = req.body;

    const origin = {
      latitude: originLatitude,
      longitude: originLongitude,
      altitude: 0,
      mapX: 0,
      mapY: 0
    };

    const { x, y } = utmConverter.convertGPSToMap(latitude, longitude, origin);

    res.json({
      success: true,
      data: { x, y },
      message: '坐标转换成功'
    });
  } catch (error) {
    console.error('坐标转换失败:', error);
    res.status(500).json({
      success: false,
      message: '坐标转换失败'
    });
  }
};

// 地图坐标转GPS坐标
export const convertMapToGPS = async (req: Request, res: Response) => {
  try {
    const { x, y, originLatitude, originLongitude } = req.body;

    const origin = {
      latitude: originLatitude,
      longitude: originLongitude,
      altitude: 0,
      mapX: 0,
      mapY: 0
    };

    const { latitude, longitude } = utmConverter.convertMapToGPS(x, y, origin);

    res.json({
      success: true,
      data: { latitude, longitude },
      message: '坐标转换成功'
    });
  } catch (error) {
    console.error('坐标转换失败:', error);
    res.status(500).json({
      success: false,
      message: '坐标转换失败'
    });
  }
};
