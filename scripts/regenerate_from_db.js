#!/usr/bin/env node
/**
 * 从数据库加载地图数据并生成地图文件
 * 用法: node scripts/regenerate_from_db.js [map_id]
 */

const path = require('path');
const fs = require('fs');

// 设置后端路径
const backendPath = path.join(__dirname, '..');
process.chdir(backendPath);

// 加载数据库模型
const { Sequelize } = require('sequelize');
const GPSMap = require('./src/models/GPSMap').default || require('./src/models/GPSMap');

// 加载服务
const gpsMappingService = require('./src/services/gpsMappingService');

async function main() {
  const mapId = process.argv[2];

  if (!mapId) {
    // 列出所有地图
    const maps = await GPSMap.findAll({
      attributes: ['id', 'name', 'status', 'createdAt'],
      order: [['updatedAt', 'DESC']],
      limit: 10
    });

    console.log('=== 可用的地图 ===');
    maps.forEach((m, i) => {
      console.log(`${i+1}. ${m.id.substring(0,8)}... Name: "${m.name}" Status: ${m.status} Created: ${m.createdAt}`);
    });
    console.log('\n用法: node scripts/regenerate_from_db.js <map_id>');
    process.exit(0);
  }

  console.log('正在加载地图:', mapId);

  const gpsMap = await GPSMap.findByPk(mapId);
  if (!gpsMap) {
    console.error('地图不存在');
    process.exit(1);
  }

  console.log('地图名称:', gpsMap.name);
  console.log('状态:', gpsMap.status);

  // 解析数据
  const origin = gpsMap.origin;
  const roads = gpsMap.roads;
  const intersections = gpsMap.intersections;
  let turnArcs = (gpsMap.turnArcs);
  const beamPositions = gpsMap.beamPositions;

  // 如果turnArcs是字符串，解析它
  if (typeof turnArcs === 'string') {
    try {
      turnArcs = JSON.parse(turnArcs);
      console.log('turnArcs解析成功');
    } catch(e) {
      console.error('turnArcs解析失败:', e.message);
      turnArcs = [];
    }
  }

  console.log('\n=== 数据统计 ===');
  console.log('Roads:', roads?.length || 0);
  console.log('Intersections:', intersections?.length || 0);
  console.log('Turn Arcs:', Array.isArray(turnArcs) ? turnArcs.length : 0);
  console.log('Beam Positions:', beamPositions?.length || 0);

  if (!origin) {
    console.error('没有原点数据');
    process.exit(1);
  }

  if (!roads || roads.length === 0) {
    console.error('没有道路数据');
    process.exit(1);
  }

  // 初始化服务
  const { CoordinateService, MapFileGenerator } = gpsMappingService;

  const coordinateService = new CoordinateService({
    gps: origin.gps,
    utm: origin.utm,
    rotation: origin.rotation || 0
  });

  const mapFileGenerator = new MapFileGenerator(coordinateService);

  // 生成文件
  console.log('\n=== 生成地图文件 ===');

  const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
  if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

  // 生成JSON文件
  console.log('生成 gps_routes.json...');
  const gpsRoutesJSON = mapFileGenerator.generateGPSRoutesJSON(origin, roads, intersections, turnArcs);
  fs.writeFileSync(path.join(mapsDir, 'gps_routes.json'), JSON.stringify(gpsRoutesJSON, null, 2));
  console.log('  写入:', path.join(mapsDir, 'gps_routes.json'));

  // 生成 beam_positions.json
  console.log('生成 beam_positions.json...');
  const beamPositionsJSON = mapFileGenerator.generateBeamPositionsJSON(beamPositions || []);
  fs.writeFileSync(path.join(mapsDir, 'beam_positions.json'), JSON.stringify(beamPositionsJSON, null, 2));
  console.log('  写入:', path.join(mapsDir, 'beam_positions.json'));

  // 生成 gps_origin.yaml
  console.log('生成 gps_origin.yaml...');
  const gpsOriginYaml = `# GPS原点配置 - ROS2参数格式
# 生成时间: ${new Date().toISOString()}

/**:
  ros__parameters:
    origin_latitude: ${origin.gps.latitude}
    origin_longitude: ${origin.gps.longitude}
    origin_altitude: ${origin.gps.altitude || 0}
    map_rotation: ${origin.rotation || 0}
    utm_zone: ${origin.utm.zone}
    origin_easting: ${origin.utm.easting}
    origin_northing: ${origin.utm.northing}
`;
  fs.writeFileSync(path.join(mapsDir, 'gps_origin.yaml'), gpsOriginYaml);
  console.log('  写入:', path.join(mapsDir, 'gps_origin.yaml'));

  // 生成PGM地图
  console.log('生成PGM地图...');

  // 获取道路参数
  const defaultPreferredWidth = 1.4;
  const defaultHighCostWidth = 0.3;
  let preferredWidth = defaultPreferredWidth;
  let highCostWidth = defaultHighCostWidth;

  if (roads.length > 0 && roads[0].params) {
    if (roads[0].params.preferredWidth !== undefined) {
      preferredWidth = roads[0].params.preferredWidth;
    }
    if (roads[0].params.highCostWidth !== undefined) {
      highCostWidth = roads[0].params.highCostWidth;
    }
  }

  console.log(`  地图参数: 首选网络宽度=${preferredWidth}m, 高代价区宽度=${highCostWidth}m`);

  try {
    const { pgm, width, height, origin: mapOrigin } = mapFileGenerator.generatePGMMap(
      roads, turnArcs || [], 0.1, preferredWidth, highCostWidth
    );

    fs.writeFileSync(path.join(mapsDir, 'beam_field_map.pgm'), pgm);
    console.log('  写入:', path.join(mapsDir, 'beam_field_map.pgm'));
    console.log(`  地图尺寸: ${width}x${height}`);

    const yamlConfig = mapFileGenerator.generateYAMLConfig('beam_field_map.pgm', 0.1, mapOrigin);
    fs.writeFileSync(path.join(mapsDir, 'beam_field_map.yaml'), yamlConfig);
    console.log('  写入:', path.join(mapsDir, 'beam_field_map.yaml'));

    console.log('\n=== 生成成功! ===');

    // 列出生成的文件
    console.log('\n生成的文件:');
    const files = ['gps_routes.json', 'gps_routes.yaml', 'beam_positions.json', 'gps_origin.yaml', 'beam_field_map.pgm', 'beam_field_map.yaml'];
    files.forEach(f => {
      const fullPath = path.join(mapsDir, f);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        console.log(`  ✓ ${f}: ${(stat.size / 1024).toFixed(1)} KB`);
      } else {
        console.log(`  ✗ ${f}: 未生成`);
      }
    });

  } catch (pgmError) {
    console.error('PGM生成失败:', pgmError.message);
    console.error(pgmError.stack);
  }

  process.exit(0);
}

// 数据库连接
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(backendPath, 'data', 'database.sqlite'),
  logging: false
});

// 初始化模型
GPSMap.init({
  id: { type: 'UUID', primaryKey: true },
  name: { type: 'VARCHAR(255)' },
  description: { type: 'TEXT' },
  origin: { type: 'JSON' },
  supplyStation: { type: 'JSON' },
  roads: { type: 'JSON' },
  intersections: { type: 'JSON' },
  turnPaths: { type: 'JSON' },
  beamPositions: { type: 'JSON' },
  status: { type: 'TEXT' },
  createdAt: { type: 'DATETIME' },
  updatedAt: { type: 'DATETIME' },
  turnArcs: { type: 'TEXT' },
  statistics: { type: 'TEXT' }
}, {
  sequelize,
  modelName: 'gps_maps',
  tableName: 'gps_maps',
  timestamps: false
});

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
