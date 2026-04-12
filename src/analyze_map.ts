/**
 * 地图数据分析脚本
 * 检查：1) 方向一致性 2) 连通性 3) 点间距 4) 直线度 5) 弧形半径与切线
 */

import * as fs from 'fs';
import * as path from 'path';

interface MapPoint {
  seq: number;
  gps: { latitude: number; longitude: number; altitude: number };
  map_xy: { x: number; y: number };
}

interface RawRoad {
  id: string;
  name: string;
  type: string;
  points: MapPoint[];
}

interface RawIntersection {
  id: string;
  type: string;
  center: { gps: { latitude: number; longitude: number }; map_xy: { x: number; y: number } };
  connected_roads: string[];
  neighbors?: Record<string, string>;
  road_v_id?: string;
  road_h_id?: string;
}

interface RawTurnArc {
  id: string;
  intersection_id: string;
  quadrant: number;
  radius: number;
  center: { x: number; y: number };
  tangent_points: Array<{ x: number; y: number }>;
  points: MapPoint[];
}

interface MapData {
  roads: RawRoad[];
  intersections: RawIntersection[];
  turn_arcs: RawTurnArc[];
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function analyze() {
  const dataPath = path.resolve('/home/jetson/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/gps_routes.json');
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as MapData;

  console.log('='.repeat(80));
  console.log('地图数据分析报告');
  console.log('='.repeat(80));
  console.log(`道路: ${raw.roads.length}, 交叉点: ${raw.intersections.length}, 弧线: ${raw.turn_arcs.length}`);
  console.log();

  // === 1. 道路基本信息和方向 ===
  console.log('--- 1. 道路方向与直线度 ---');
  for (const road of raw.roads) {
    const pts = road.points.map(p => p.map_xy);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const totalLen = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
    const endToEnd = dist(first, last);
    const straightness = endToEnd / totalLen;

    const ang = angle(first, last);
    const degAngle = (ang * 180 / Math.PI);
    let approxDir: string;
    if (Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))) {
      approxDir = Math.cos(ang) > 0 ? '东' : '西';
    } else {
      approxDir = Math.sin(ang) > 0 ? '北' : '南';
    }

    console.log(`  ${road.name}(${road.id.slice(-4)}): type=${road.type}, 方向≈${approxDir}(${degAngle.toFixed(1)}°), 长=${totalLen.toFixed(2)}m, 直线度=${(straightness * 100).toFixed(3)}%, 端点距=${endToEnd.toFixed(2)}m, 点数=${pts.length}`);
  }
  console.log();

  // === 2. 交叉点信息 ===
  console.log('--- 2. 交叉点 ---');
  for (const inter of raw.intersections) {
    const cx = inter.center.map_xy.x;
    const cy = inter.center.map_xy.y;
    const neighborStr = inter.neighbors ? Object.entries(inter.neighbors).map(([k, v]) => `${k}=${v}`).join(', ') : '无';
    console.log(`  ${inter.id}(${inter.type}): center=(${cx.toFixed(2)}, ${cy.toFixed(2)}), roads=${inter.connected_roads.map(r => r.slice(-4)).join(',')}, neighbors=[${neighborStr}]`);
  }
  console.log();

  // === 3. 点间距检查 ===
  console.log('--- 3. 点间距检查 (应≤0.5m) ---');
  let maxGap = 0;
  let gapViolations = 0;
  for (const road of raw.roads) {
    const pts = road.points.map(p => p.map_xy);
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (d > maxGap) maxGap = d;
      if (d > 0.5) {
        gapViolations++;
        if (gapViolations <= 5) {
          console.log(`  [违规] ${road.name} seq ${pts[i-1].x.toFixed(2)},${pts[i-1].y.toFixed(2)} → ${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)} 间距=${d.toFixed(3)}m`);
        }
      }
    }
  }
  for (const arc of raw.turn_arcs) {
    const pts = arc.points.map(p => p.map_xy);
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (d > maxGap) maxGap = d;
      if (d > 0.5) {
        gapViolations++;
        if (gapViolations <= 5) {
          console.log(`  [违规] arc_${arc.id} seq ${i-1}→${i} 间距=${d.toFixed(3)}m`);
        }
      }
    }
  }
  if (gapViolations === 0) {
    console.log('  ✓ 所有点间距均在0.5m以内');
  } else {
    console.log(`  ✗ 共${gapViolations}处间距>0.5m, 最大间距=${maxGap.toFixed(3)}m`);
  }
  console.log();

  // === 4. 交叉点与道路端点连通性 ===
  console.log('--- 4. 交叉点与道路端点距离 (应很小) ---');
  for (const inter of raw.intersections) {
    const ic = inter.center.map_xy;
    for (const roadId of inter.connected_roads) {
      const road = raw.roads.find(r => r.id === roadId);
      if (!road) continue;
      const firstPt = road.points[0].map_xy;
      const lastPt = road.points[road.points.length - 1].map_xy;
      const dFirst = dist(ic, firstPt);
      const dLast = dist(ic, lastPt);
      const closer = dFirst < dLast ? '首' : '尾';
      const closerDist = Math.min(dFirst, dLast);
      const furtherDist = Math.max(dFirst, dLast);
      const flag = closerDist > 2.0 ? '⚠️' : '✓';
      console.log(`  ${flag} ${inter.id} ↔ road_${road.name}(${roadId.slice(-4)}): 首端=${dFirst.toFixed(2)}m, 尾端=${dLast.toFixed(2)}m, 更近=${closer}(${closerDist.toFixed(2)}m), 更远=${furtherDist.toFixed(2)}m`);
    }
  }
  console.log();

  // === 5. 弧线分析 ===
  console.log('--- 5. 弧线分析 ---');
  for (const arc of raw.turn_arcs) {
    const pts = arc.points.map(p => p.map_xy);
    const inter = raw.intersections.find(i => i.id === arc.intersection_id);
    const ic = inter ? inter.center.map_xy : { x: 0, y: 0 };

    const arcLen = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

    // 检查弧线首尾点与交叉点中心距离
    const dFirst = dist(ic, pts[0]);
    const dLast = dist(ic, pts[pts.length - 1]);

    // 检查弧线是否连接两条道路
    // 弧线首尾应接近某条道路的某端点
    let firstConnectRoad = '无';
    let lastConnectRoad = '无';
    let firstConnectDist = Infinity;
    let lastConnectDist = Infinity;
    for (const road of raw.roads) {
      if (!inter || !inter.connected_roads.includes(road.id)) continue;
      const rpts = road.points.map(p => p.map_xy);
      const rpFirst = rpts[0];
      const rpLast = rpts[rpts.length - 1];
      for (const rp of [rpFirst, rpLast]) {
        const d1 = dist(pts[0], rp);
        const d2 = dist(pts[pts.length - 1], rp);
        if (d1 < firstConnectDist) {
          firstConnectDist = d1;
          firstConnectRoad = road.name;
        }
        if (d2 < lastConnectDist) {
          lastConnectDist = d2;
          lastConnectRoad = road.name;
        }
      }
    }

    // 拟合半径：从弧线中心到弧线各点的平均距离
    const arcCenter = arc.center;
    const radii = pts.map(p => dist(arcCenter, p));
    const avgRadius = radii.reduce((s, r) => s + r, 0) / radii.length;
    const radiusVariance = Math.sqrt(radii.reduce((s, r) => s + (r - avgRadius) ** 2, 0) / radii.length);

    // 弧线首尾方向
    const startAngle = angle(pts[0], pts[1]);
    const endAngle = angle(pts[pts.length - 2], pts[pts.length - 1]);
    const startDir = Math.abs(Math.cos(startAngle)) > Math.abs(Math.sin(startAngle))
      ? (Math.cos(startAngle) > 0 ? '东' : '西')
      : (Math.sin(startAngle) > 0 ? '北' : '南');
    const endDir = Math.abs(Math.cos(endAngle)) > Math.abs(Math.sin(endAngle))
      ? (Math.cos(endAngle) > 0 ? '东' : '西')
      : (Math.sin(endAngle) > 0 ? '北' : '南');

    console.log(`  arc_${arc.id}(${arc.intersection_id}, Q${arc.quadrant}): R声明=${arc.radius.toFixed(2)}m, R拟合=${avgRadius.toFixed(2)}m(σ=${radiusVariance.toFixed(3)}), 弧长=${arcLen.toFixed(2)}m`);
    console.log(`    首尾距交叉中心: ${dFirst.toFixed(2)}m / ${dLast.toFixed(2)}m`);
    console.log(`    首端连${firstConnectRoad}(${firstConnectDist.toFixed(2)}m), 尾端连${lastConnectRoad}(${lastConnectDist.toFixed(2)}m)`);
    console.log(`    首端方向≈${startDir}(${(startAngle * 180 / Math.PI).toFixed(1)}°), 尾端方向≈${endDir}(${(endAngle * 180 / Math.PI).toFixed(1)}°)`);
    console.log(`    切点: ${arc.tangent_points.map(tp => `(${tp.x.toFixed(2)},${tp.y.toFixed(2)})`).join(' → ')}`);
  }
  console.log();

  // === 6. 弧线与道路的切线检查 ===
  console.log('--- 6. 弧线与道路切线连接检查 ---');
  for (const arc of raw.turn_arcs) {
    const arcPts = arc.points.map(p => p.map_xy);
    const inter = raw.intersections.find(i => i.id === arc.intersection_id);
    if (!inter) continue;

    // 弧线首点方向
    const arcStartAngle = angle(arcPts[0], arcPts[1]);
    const arcEndAngle = angle(arcPts[arcPts.length - 2], arcPts[arcPts.length - 1]);

    // 查找弧线首尾最近的道路端点
    const connectRoads = inter.connected_roads.map(rid => raw.roads.find(r => r.id === rid)).filter(Boolean) as RawRoad[];
    
    for (const road of connectRoads) {
      const rpts = road.points.map(p => p.map_xy);
      const rpFirst = rpts[0];
      const rpLast = rpts[rpts.length - 1];

      // 道路首端方向（前两个点的方向）
      const roadStartAngle = angle(rpts[0], rpts[1]);
      // 道路尾端方向（最后两个点的方向）
      const roadEndAngle = angle(rpts[rpts.length - 2], rpts[rpts.length - 1]);

      const dArcFirst2RoadFirst = dist(arcPts[0], rpFirst);
      const dArcFirst2RoadLast = dist(arcPts[0], rpLast);
      const dArcLast2RoadFirst = dist(arcPts[arcPts.length - 1], rpFirst);
      const dArcLast2RoadLast = dist(arcPts[arcPts.length - 1], rpLast);

      // 只报告实际连接的端点
      const threshold = 1.0; // 1m以内认为连接
      if (dArcFirst2RoadFirst < threshold || dArcFirst2RoadLast < threshold) {
        const roadAngle = dArcFirst2RoadFirst < dArcFirst2RoadLast ? roadStartAngle : roadEndAngle;
        const angleDiff = Math.abs(arcStartAngle - roadAngle);
        const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
        const degDiff = normalizedDiff * 180 / Math.PI;
        const ok = degDiff < 5;
        console.log(`  ${ok ? '✓' : '✗'} arc_${arc.id}首端 ↔ road_${road.name}: 方向差=${degDiff.toFixed(1)}°, 距离=${Math.min(dArcFirst2RoadFirst, dArcFirst2RoadLast).toFixed(3)}m`);
      }
      if (dArcLast2RoadFirst < threshold || dArcLast2RoadLast < threshold) {
        const roadAngle = dArcLast2RoadFirst < dArcLast2RoadLast ? roadStartAngle : roadEndAngle;
        const angleDiff = Math.abs(arcEndAngle - roadAngle);
        const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
        const degDiff = normalizedDiff * 180 / Math.PI;
        const ok = degDiff < 5;
        console.log(`  ${ok ? '✓' : '✗'} arc_${arc.id}尾端 ↔ road_${road.name}: 方向差=${degDiff.toFixed(1)}°, 距离=${Math.min(dArcLast2RoadFirst, dArcLast2RoadLast).toFixed(3)}m`);
      }
    }
  }
  console.log();

  // === 7. 道路穿越交叉点检查 ===
  console.log('--- 7. 道路与交叉点位置关系 ---');
  for (const road of raw.roads) {
    const pts = road.points.map(p => p.map_xy);
    const connected = raw.intersections.filter(i => i.connected_roads.includes(road.id));
    for (const inter of connected) {
      const ic = inter.center.map_xy;
      // 找到道路最接近交叉点的点
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < pts.length; i++) {
        const d = dist(ic, pts[i]);
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      // 道路在该点的方向
      let roadDirAtInter: string;
      if (minIdx === 0) {
        roadDirAtInter = '首端';
      } else if (minIdx === pts.length - 1) {
        roadDirAtInter = '尾端';
      } else {
        roadDirAtInter = `中间(seq=${minIdx})`;
      }
      const flag = minDist > 2.0 ? '⚠️' : '✓';
      console.log(`  ${flag} road_${road.name} ↔ ${inter.id}: 最近点在${roadDirAtInter}, 距离=${minDist.toFixed(2)}m`);
    }
  }
  console.log();

  // === 8. 弧线quadrant方向验证 ===
  console.log('--- 8. 弧线quadrant与实际方向的对应关系 ---');
  const QUADRANT_MAP: Record<number, { entry: string; exit: string }> = {
    0: { entry: 'south', exit: 'east' },   // SW: 从南入，向东出
    1: { entry: 'south', exit: 'west' },   // SE: 从南入，向西出
    2: { entry: 'north', exit: 'west' },   // NE: 从北入，向西出
    3: { entry: 'north', exit: 'east' },   // NW: 从北入，向东出
  };
  for (const arc of raw.turn_arcs) {
    const mapping = QUADRANT_MAP[arc.quadrant];
    const pts = arc.points.map(p => p.map_xy);
    const startAngle = angle(pts[0], pts[1]);
    const endAngle = angle(pts[pts.length - 2], pts[pts.length - 1]);
    
    const startDir = Math.abs(Math.cos(startAngle)) > Math.abs(Math.sin(startAngle))
      ? (Math.cos(startAngle) > 0 ? 'east' : 'west')
      : (Math.sin(startAngle) > 0 ? 'north' : 'south');
    const endDir = Math.abs(Math.cos(endAngle)) > Math.abs(Math.sin(endAngle))
      ? (Math.cos(endAngle) > 0 ? 'east' : 'west')
      : (Math.sin(endAngle) > 0 ? 'north' : 'south');
    
    // entry direction = 车辆进入交叉点的方向（从哪个方向驶来），应与弧线首点方向相反
    // 因为车辆从南方来 = 车辆朝北行驶 = 弧线起点方向应朝北
    const expectedStartDir = mapping.entry; // IN方向 = 车辆来的方向 = 弧线方向
    const expectedEndDir = mapping.exit;     // OUT方向 = 车辆去的方向 = 弧线末端方向
    
    const startMatch = startDir === expectedStartDir;
    const endMatch = endDir === expectedEndDir;
    
    console.log(`  arc_${arc.id}(Q${arc.quadrant}): 预期入=${expectedStartDir}/出=${expectedEndDir}, 实际首方向=${startDir}/${startMatch ? '✓' : '✗'}, 尾方向=${endDir}/${endMatch ? '✓' : '✗'}`);
  }
}

analyze();
