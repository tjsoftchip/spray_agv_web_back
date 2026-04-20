#!/usr/bin/env node
/**
 * 从数据库加载地图数据并生成地图文件 (简化版本)
 * 用法: node scripts/regenerate_from_db_simple.js
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const backendPath = path.join(__dirname, '..');
const mapsDir = '/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps';
const dbPath = path.join(backendPath, 'data', 'database.sqlite');

// UTM转换函数
function calculateUTMZone(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

function gpsToUtm(lat, lon) {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const utmZone = calculateUTMZone(lon);
  const lonOrigin = ((utmZone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const k0 = 0.9996;
  const a = 6378137.0;
  const e = 0.081819191;

  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = e * e * Math.cos(latRad) * Math.cos(latRad) / (1 - e * e);
  const A = Math.cos(latRad) * (lonRad - lonOrigin);

  const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64) * latRad
    - (3 * e * e / 8 + 3 * e * e * e * e / 32) * Math.sin(2 * latRad)
    + (15 * e * e * e * e / 256) * Math.sin(4 * latRad));

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e * e) * A * A * A * A * A / 120) + 500000;

  const northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e * e) * A * A * A * A * A * A / 720));

  return { zone: utmZone, easting, northing };
}

function mapToGps(x, y, origin) {
  const easting = x + origin.utm.easting;
  const northing = y + origin.utm.northing;
  return utmToGps(easting, northing, origin.utm.zone);
}

function utmToGps(easting, northing, zone) {
  const k0 = 0.9996;
  const a = 6378137.0;
  const e = 0.081819191;
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const x = easting - 500000;
  const y = northing;

  const M = y / k0;
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * e * e * e * e * e * e / 256));

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
    + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);

  const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
  const T1 = Math.tan(phi1) * Math.tan(phi1);
  const C1 = e * e * Math.cos(phi1) * Math.cos(phi1) / (1 - e * e);
  const R1 = a * (1 - e * e) / Math.pow(1 - e * e * Math.sin(phi1) * Math.sin(phi1), 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e * e) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e * e - 3 * C1 * C1) * D * D * D * D * D * D / 720);

  const lon = lonOrigin + (D - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e * e + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1);

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// 生成GPSRoutesJSON
function generateGPSRoutesJSON(origin, roads, intersections, turnArcs) {
  return {
    version: '5.0',
    origin: {
      gps: { lat: origin.gps.latitude, lon: origin.gps.longitude },
      utm: origin.utm,
      rotation: origin.rotation || 0
    },
    roads: roads,
    intersections: intersections,
    turn_arcs: turnArcs,
    beamPositions: []
  };
}

// 生成BeamPositionsJSON
function generateBeamPositionsJSON(beamPositions) {
  return {
    version: '1.0',
    positions: beamPositions || []
  };
}

// 生成YAML配置
function generateYAMLConfig(filename, resolution, origin) {
  return `image: ${filename}
resolution: ${resolution}
origin: [${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}, ${origin[2] || 0}]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
`;
}

// 生成PGM地图
function generatePGMMap(roads, turnArcs, resolution, preferredWidth, highCostWidth, margin = 5.0) {
  console.log(`[generatePGMMap] 开始生成PGM地图, 道路数=${roads.length}, 圆弧数=${turnArcs ? turnArcs.length : 0}, 分辨率=${resolution}m`);

  // 收集所有点 (兼容 map_xy 和 mapXy 两种格式)
  const allPoints = [];
  for (const road of roads) {
    if (!road.points) continue;
    for (const p of road.points) {
      const mapXy = p.map_xy || p.mapXy;
      if (mapXy) allPoints.push(mapXy);
    }
  }
  if (turnArcs) {
    for (const arc of turnArcs) {
      if (!arc.points) continue;
      for (const p of arc.points) {
        const mapXy = p.map_xy || p.mapXy;
        if (mapXy) allPoints.push(mapXy);
      }
    }
  }

  if (allPoints.length === 0) {
    throw new Error('没有道路点数据');
  }

  console.log(`[generatePGMMap] 总点数: ${allPoints.length}`);

  const minX = Math.min(...allPoints.map(p => p.x)) - margin;
  const maxX = Math.max(...allPoints.map(p => p.x)) + margin;
  const minY = Math.min(...allPoints.map(p => p.y)) - margin;
  const maxY = Math.max(...allPoints.map(p => p.y)) + margin;

  const width = Math.floor((maxX - minX) / resolution) + 1;
  const height = Math.floor((maxY - minY) / resolution) + 1;

  console.log(`[generatePGMMap] 地图尺寸: ${width}x${height}, 范围: X[${minX.toFixed(2)}, ${maxX.toFixed(2)}], Y[${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);

  if (width > 10000 || height > 10000) {
    throw new Error(`地图尺寸过大: ${width}x${height}`);
  }

  // 创建中心线图像
  const centerlineImg = [];
  for (let y = 0; y < height; y++) {
    centerlineImg.push(new Array(width).fill(255));
  }

  // 绘制道路
  let lineCount = 0;
  for (const road of roads) {
    if (!road.points) continue;
    for (let i = 0; i < road.points.length - 1; i++) {
      const p0 = road.points[i].map_xy || road.points[i].mapXy;
      const p1 = road.points[i + 1].map_xy || road.points[i + 1].mapXy;
      if (p0 && p1) {
        drawLine(centerlineImg, p0, p1, minX, minY, resolution, 0);
        lineCount++;
      }
    }
  }
  // 绘制圆弧
  if (turnArcs) {
    for (const arc of turnArcs) {
      if (!arc.points) continue;
      for (let i = 0; i < arc.points.length - 1; i++) {
        const p0 = arc.points[i].map_xy || arc.points[i].mapXy;
        const p1 = arc.points[i + 1].map_xy || arc.points[i + 1].mapXy;
        if (p0 && p1) {
          drawLine(centerlineImg, p0, p1, minX, minY, resolution, 0);
          lineCount++;
        }
      }
    }
  }

  console.log(`[generatePGMMap] 绘制线段数: ${lineCount}`);

  // 生成代价地图
  const costmap = generateCostmap(centerlineImg, preferredWidth, highCostWidth, resolution);

  // 创建PGM buffer
  const pgmBuffer = createPGMBuffer(costmap);

  console.log(`[generatePGMMap] PGM地图生成成功, 大小=${pgmBuffer.length}字节`);
  return { pgm: pgmBuffer, width, height, origin: [minX, minY, 0.0] };
}

function drawLine(img, start, end, ox, oy, res, val) {
  const h = img.length, w = img[0] ? img[0].length : 0;
  let x0 = Math.floor((start.x - ox) / res), y0 = h - 1 - Math.floor((start.y - oy) / res);
  let x1 = Math.floor((end.x - ox) / res), y1 = h - 1 - Math.floor((end.y - oy) / res);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (y0 >= 0 && y0 < h && x0 >= 0 && x0 < w) img[y0][x0] = val;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function generateCostmap(centerlineImg, pw, hw, res) {
  const h = centerlineImg.length, w = centerlineImg[0] ? centerlineImg[0].length : 0;
  console.log(`[generateCostmap] 开始生成代价地图, 尺寸=${w}x${h}, 首选宽度=${pw}m, 高代价宽度=${hw}m`);

  const maxDist = pw + hw + res;
  console.log(`[generateCostmap] 最大处理距离: ${maxDist.toFixed(2)}m`);

  const distMap = [];
  for (let y = 0; y < h; y++) {
    distMap.push(new Array(w).fill(null));
  }

  const queue = [];
  let queueHead = 0;
  let centerlineCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (centerlineImg[y][x] === 0) {
        distMap[y][x] = 0;
        queue.push(x, y);
        centerlineCount++;
      }
    }
  }

  console.log(`[generateCostmap] 中心线像素数: ${centerlineCount}`);

  if (centerlineCount === 0) {
    const emptyCostmap = [];
    for (let y = 0; y < h; y++) {
      emptyCostmap.push(new Array(w).fill(254));
    }
    return emptyCostmap;
  }

  const dirs = [0, 1, 0, -1, 1, 0, -1, 0];
  let processedCount = 0;

  while (queueHead < queue.length) {
    const cx = queue[queueHead++];
    const cy = queue[queueHead++];
    processedCount++;

    const currentDist = distMap[cy][cx];
    if (currentDist >= maxDist) continue;

    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d * 2];
      const ny = cy + dirs[d * 2 + 1];

      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const nd = currentDist + res;
        const existing = distMap[ny][nx];
        if (existing === null || nd < existing) {
          distMap[ny][nx] = nd;
          queue.push(nx, ny);
        }
      }
    }
  }

  queue.length = 0;
  console.log(`[generateCostmap] BFS处理完成, 处理像素数: ${processedCount}`);

  const costmap = [];
  let preferredPixels = 0, highCostPixels = 0, keepoutPixels = 0;
  const preferredDistPixels = pw;
  const highCostDistPixels = pw + hw;

  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const d = distMap[y][x];
      let cost;

      if (d === null) {
        cost = 254;
        keepoutPixels++;
      } else if (d <= preferredDistPixels) {
        cost = 0;
        preferredPixels++;
      } else if (d <= highCostDistPixels) {
        cost = 100;
        highCostPixels++;
      } else {
        cost = 254;
        keepoutPixels++;
      }
      row.push(cost);
    }
    costmap.push(row);
  }

  const totalPixels = w * h;
  console.log(`[generateCostmap] 代价地图生成完成: 首选网络=${preferredPixels}像素(${(preferredPixels/totalPixels*100).toFixed(1)}%), 高代价区=${highCostPixels}像素(${(highCostPixels/totalPixels*100).toFixed(1)}%), 禁区=${keepoutPixels}像素(${(keepoutPixels/totalPixels*100).toFixed(1)}%)`);

  return costmap;
}

function createPGMBuffer(img) {
  const h = img.length;
  if (h === 0) throw new Error('图像高度为0');
  const w = img[0] ? img[0].length : 0;
  if (w === 0) throw new Error('图像宽度为0');

  console.log(`[createPGMBuffer] 创建PGM缓冲区, 尺寸=${w}x${h}`);

  const header = `P5\n${w} ${h}\n255\n`;
  const headerBuffer = Buffer.from(header, 'ascii');
  const dataBuffer = Buffer.alloc(h * w);
  let idx = 0;

  for (let y = 0; y < h; y++) {
    const row = img[y];
    if (!row || row.length !== w) {
      for (let x = 0; x < w; x++) {
        dataBuffer[idx++] = 254;
      }
    } else {
      for (let x = 0; x < w; x++) {
        const val = row[x];
        if (typeof val === 'number' && !isNaN(val)) {
          dataBuffer[idx++] = Math.max(0, Math.min(255, Math.floor(val)));
        } else {
          dataBuffer[idx++] = 254;
        }
      }
    }
  }

  return Buffer.concat([headerBuffer, dataBuffer]);
}

// 生成routes YAML
function generateRoutesYaml(roads, turnArcs, origin) {
  const lines = [];
  lines.push('# GPS道路网络路线文件');
  lines.push('# 用于道路网络归档和手动查阅');
  lines.push(`# 生成时间: ${new Date().toISOString()}`);
  lines.push(`# GPS原点: (${origin.gps.latitude}, ${origin.gps.longitude})`);
  lines.push(`# 地图旋转: ${origin.rotation || 0} rad`);
  lines.push('');

  // 为每条道路生成正向和反向路线
  for (const road of roads) {
    if (!road.points || road.points.length === 0) continue;

    // 正向
    lines.push(`road_${road.name}_forward:`);
    for (const p of road.points) {
      lines.push(`  - latitude: ${p.gps.latitude}`);
      lines.push(`    longitude: ${p.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
      const mapXy = p.map_xy || p.mapXy;
      if (mapXy) {
        lines.push(`    # map_xy: (${mapXy.x.toFixed(2)}, ${mapXy.y.toFixed(2)})`);
      }
    }
    lines.push('');

    // 反向
    lines.push(`road_${road.name}_backward:`);
    for (let i = road.points.length - 1; i >= 0; i--) {
      const p = road.points[i];
      lines.push(`  - latitude: ${p.gps.latitude}`);
      lines.push(`    longitude: ${p.gps.longitude}`);
      lines.push(`    yaw: 0.0`);
      const mapXy = p.map_xy || p.mapXy;
      if (mapXy) {
        lines.push(`    # map_xy: (${mapXy.x.toFixed(2)}, ${mapXy.y.toFixed(2)})`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// 主函数
async function main() {
  const db = new sqlite3.Database(dbPath);

  db.all('SELECT id, name, status, updatedAt FROM gps_maps ORDER BY updatedAt DESC LIMIT 5', async (err, maps) => {
    if (err) {
      console.error('数据库错误:', err);
      process.exit(1);
    }

    console.log('=== 最近保存的地图 ===');
    maps.forEach((m, i) => {
      console.log(`${i+1}. ${m.id.substring(0,8)}... Name: "${m.name}" Status: ${m.status} Updated: ${m.updatedAt}`);
    });

    // 使用最新的地图
    const latestMap = maps[0];
    console.log('\n使用最新地图:', latestMap.name);

    db.get('SELECT * FROM gps_maps WHERE id = ?', [latestMap.id], (err2, map) => {
      if (err2 || !map) {
        console.error('获取地图数据失败:', err2);
        db.close();
        process.exit(1);
      }

      // 解析数据
      const origin = JSON.parse(map.origin);
      const roads = JSON.parse(map.roads);
      const intersections = JSON.parse(map.intersections);
      let turnArcs = map.turnArcs;
      if (typeof turnArcs === 'string') {
        try {
          turnArcs = JSON.parse(turnArcs);
        } catch(e) {
          turnArcs = [];
        }
      }
      const beamPositions = JSON.parse(map.beamPositions);

      console.log('\n=== 数据统计 ===');
      console.log('Roads:', roads.length);
      console.log('Intersections:', intersections.length);
      console.log('Turn Arcs:', Array.isArray(turnArcs) ? turnArcs.length : 0);
      console.log('Beam Positions:', beamPositions.length);

      // 确保目录存在
      if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

      // 生成文件
      console.log('\n=== 生成文件 ===');

      // 1. gps_routes.json
      console.log('生成 gps_routes.json...');
      const gpsRoutesJSON = generateGPSRoutesJSON(origin, roads, intersections, turnArcs);
      fs.writeFileSync(path.join(mapsDir, 'gps_routes.json'), JSON.stringify(gpsRoutesJSON, null, 2));
      console.log('  ✓ gps_routes.json');

      // 2. beam_positions.json
      console.log('生成 beam_positions.json...');
      const beamPositionsJSON = generateBeamPositionsJSON(beamPositions);
      fs.writeFileSync(path.join(mapsDir, 'beam_positions.json'), JSON.stringify(beamPositionsJSON, null, 2));
      console.log('  ✓ beam_positions.json');

      // 3. gps_origin.yaml
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
      console.log('  ✓ gps_origin.yaml');

      // 4. gps_routes.yaml
      console.log('生成 gps_routes.yaml...');
      const routesYaml = generateRoutesYaml(roads, turnArcs, origin);
      fs.writeFileSync(path.join(mapsDir, 'gps_routes.yaml'), routesYaml);
      console.log('  ✓ gps_routes.yaml');

      // 5. PGM地图
      console.log('生成PGM地图...');
      const preferredWidth = roads[0]?.params?.preferredWidth || 1.4;
      const highCostWidth = roads[0]?.params?.highCostWidth || 0.3;

      try {
        const { pgm, width, height, origin: mapOrigin } = generatePGMMap(roads, turnArcs, 0.1, preferredWidth, highCostWidth);
        fs.writeFileSync(path.join(mapsDir, 'beam_field_map.pgm'), pgm);
        console.log('  ✓ beam_field_map.pgm (' + width + 'x' + height + ')');

        const yamlConfig = generateYAMLConfig('beam_field_map.pgm', 0.1, mapOrigin);
        fs.writeFileSync(path.join(mapsDir, 'beam_field_map.yaml'), yamlConfig);
        console.log('  ✓ beam_field_map.yaml');

        console.log('\n=== 生成成功! ===');
      } catch (pgmErr) {
        console.error('PGM生成失败:', pgmErr.message);
      }

      // 列出文件
      console.log('\n生成的文件:');
      const files = ['gps_routes.json', 'gps_routes.yaml', 'beam_positions.json', 'gps_origin.yaml', 'beam_field_map.pgm', 'beam_field_map.yaml'];
      files.forEach(f => {
        const p = path.join(mapsDir, f);
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          console.log(`  ✓ ${f}: ${(stat.size / 1024).toFixed(1)} KB`);
        }
      });

      db.close();
    });
  });
}

main();
