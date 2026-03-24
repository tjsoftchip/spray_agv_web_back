/**
 * UTM坐标转换服务
 * 用于GPS坐标（经纬度）与地图坐标之间的转换
 */

interface GPSPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  mapX?: number;
  mapY?: number;
}

interface UTMCoordinate {
  easting: number;
  northing: number;
  zoneNumber: number;
  zoneLetter: string;
}

export class UTMConverter {
  // WGS84椭球参数
  private static readonly a = 6378137.0; // 长半轴
  private static readonly f = 1 / 298.257223563; // 扁率
  private static readonly k0 = 0.9996; // 比例因子
  private static readonly e = Math.sqrt(2 * UTMConverter.f - Math.pow(UTMConverter.f, 2)); // 第一偏心率
  private static readonly e1 = (1 - Math.sqrt(1 - Math.pow(UTMConverter.e, 2))) / (1 + Math.sqrt(1 - Math.pow(UTMConverter.e, 2))); // 第二偏心率

  /**
   * 将GPS坐标转换为UTM坐标
   */
  private latLonToUTM(latitude: number, longitude: number): UTMCoordinate {
    const latRad = this.degToRad(latitude);
    const lonRad = this.degToRad(longitude);

    // 计算UTM区号
    const zoneNumber = Math.floor((longitude + 180) / 6) + 1;

    // 中央子午线
    const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;
    const lonOriginRad = this.degToRad(lonOrigin);

    // 计算UTM坐标
    const N = UTMConverter.a / Math.sqrt(1 - Math.pow(UTMConverter.e * Math.sin(latRad), 2));
    const T = Math.pow(Math.tan(latRad), 2);
    const C = Math.pow(UTMConverter.e * Math.cos(latRad), 2) / (1 - Math.pow(UTMConverter.e, 2));
    const A = Math.cos(latRad) * (lonRad - lonOriginRad);

    const M = UTMConverter.a * (
      (1 - Math.pow(UTMConverter.e, 2) / 4 - 3 * Math.pow(UTMConverter.e, 4) / 64 - 5 * Math.pow(UTMConverter.e, 6) / 256) * latRad
      - (3 * Math.pow(UTMConverter.e, 2) / 8 + 3 * Math.pow(UTMConverter.e, 4) / 32 + 45 * Math.pow(UTMConverter.e, 6) / 1024) * Math.sin(2 * latRad)
      + (15 * Math.pow(UTMConverter.e, 4) / 256 + 45 * Math.pow(UTMConverter.e, 6) / 1024) * Math.sin(4 * latRad)
      - (35 * Math.pow(UTMConverter.e, 6) / 3072) * Math.sin(6 * latRad)
    );

    const easting = UTMConverter.k0 * N * (
      A + (1 - T + C) * Math.pow(A, 3) / 6
      + (5 - 18 * T + Math.pow(T, 2) + 72 * C - 58 * Math.pow(UTMConverter.e1, 2)) * Math.pow(A, 5) / 120
    ) + 500000;

    const northing = UTMConverter.k0 * (
      M + N * Math.tan(latRad) * (
        Math.pow(A, 2) / 2
        + (5 - T + 9 * C + 4 * Math.pow(C, 2)) * Math.pow(A, 4) / 24
        + (61 - 58 * T + Math.pow(T, 2) + 600 * C - 330 * Math.pow(UTMConverter.e1, 2)) * Math.pow(A, 6) / 720
      )
    );

    // 确定UTM区字母
    const zoneLetter = this.getUTMLetterDesignator(latitude);

    return {
      easting,
      northing,
      zoneNumber,
      zoneLetter
    };
  }

  /**
   * 将GPS坐标转换为相对于原点的地图坐标
   */
  public convertGPSToMap(latitude: number, longitude: number, origin: GPSPoint): { x: number; y: number } {
    const utmPoint = this.latLonToUTM(latitude, longitude);
    const utmOrigin = this.latLonToUTM(origin.latitude, origin.longitude);

    // 计算相对于原点的偏移（转换为米）
    const x = utmPoint.easting - utmOrigin.easting;
    const y = utmPoint.northing - utmOrigin.northing;

    return { x, y };
  }

  /**
   * 将地图坐标转换为GPS坐标
   */
  public convertMapToGPS(x: number, y: number, origin: GPSPoint): { latitude: number; longitude: number } {
    const utmOrigin = this.latLonToUTM(origin.latitude, origin.longitude);

    // 计算目标点的UTM坐标
    const targetEasting = utmOrigin.easting + x;
    const targetNorthing = utmOrigin.northing + y;

    // 转换回经纬度
    const { latitude, longitude } = this.utmToLatLon(
      targetEasting,
      targetNorthing,
      utmOrigin.zoneNumber,
      utmOrigin.zoneLetter
    );

    return { latitude, longitude };
  }

  /**
   * 将UTM坐标转换为GPS坐标
   */
  private utmToLatLon(easting: number, northing: number, zoneNumber: number, zoneLetter: string): { latitude: number; longitude: number } {
    const x = easting - 500000;
    let y = northing;

    // 南半球处理
    const northernHemisphere = zoneLetter >= 'N';
    if (!northernHemisphere) {
      y -= 10000000;
    }

    const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;

    const e1sq = Math.pow(UTMConverter.e1, 2);
    const M = y / UTMConverter.k0;
    const mu = M / (UTMConverter.a * (1 - Math.pow(UTMConverter.e, 2) / 4 - 3 * Math.pow(UTMConverter.e, 4) / 64 - 5 * Math.pow(UTMConverter.e, 6) / 256));

    const phi1Rad = mu
      + (3 * UTMConverter.e1 / 2 - 27 * e1sq / 32) * Math.sin(2 * mu)
      + (21 * e1sq / 16 - 55 * Math.pow(e1sq, 2) / 32) * Math.sin(4 * mu)
      + (151 * e1sq / 96) * Math.sin(6 * mu);

    const N1 = UTMConverter.a / Math.sqrt(1 - Math.pow(UTMConverter.e * Math.sin(phi1Rad), 2));
    const T1 = Math.pow(Math.tan(phi1Rad), 2);
    const C1 = Math.pow(UTMConverter.e * Math.cos(phi1Rad), 2) / (1 - Math.pow(UTMConverter.e, 2));
    const R1 = UTMConverter.a * (1 - Math.pow(UTMConverter.e, 2)) / Math.pow(1 - Math.pow(UTMConverter.e * Math.sin(phi1Rad), 2), 1.5);
    const D = x / (N1 * UTMConverter.k0);

    const latRad = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (
      Math.pow(D, 2) / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * Math.pow(C1, 2) - 9 * Math.pow(UTMConverter.e, 2)) * Math.pow(D, 4) / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * Math.pow(T1, 2) - 252 * Math.pow(UTMConverter.e, 2) - 3 * Math.pow(C1, 2)) * Math.pow(D, 6) / 720
    );

    const lonRad = lonOrigin * Math.PI / 180 + (
      D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * Math.pow(C1, 2) + 8 * Math.pow(UTMConverter.e, 2) + 24 * Math.pow(T1, 2)) * Math.pow(D, 5) / 120
    ) / Math.cos(phi1Rad);

    return {
      latitude: this.radToDeg(latRad),
      longitude: this.radToDeg(lonRad)
    };
  }

  /**
   * 获取UTM区字母
   */
  private getUTMLetterDesignator(latitude: number): string {
    if (latitude >= 72) return 'X';
    if (latitude >= 64) return 'W';
    if (latitude >= 56) return 'V';
    if (latitude >= 48) return 'U';
    if (latitude >= 40) return 'T';
    if (latitude >= 32) return 'S';
    if (latitude >= 24) return 'R';
    if (latitude >= 16) return 'Q';
    if (latitude >= 8) return 'P';
    if (latitude >= 0) return 'N';
    if (latitude >= -8) return 'M';
    if (latitude >= -16) return 'L';
    if (latitude >= -24) return 'K';
    if (latitude >= -32) return 'J';
    if (latitude >= -40) return 'H';
    if (latitude >= -48) return 'G';
    if (latitude >= -56) return 'F';
    if (latitude >= -64) return 'E';
    if (latitude >= -72) return 'D';
    return 'C';
  }

  /**
   * 角度转弧度
   */
  private degToRad(deg: number): number {
    return deg * Math.PI / 180;
  }

  /**
   * 弧度转角度
   */
  private radToDeg(rad: number): number {
    return rad * 180 / Math.PI;
  }

  /**
   * 计算两个GPS点之间的距离（米）
   */
  public calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // 地球半径（米）
    const dLat = this.degToRad(lat2 - lat1);
    const dLon = this.degToRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(this.degToRad(lat1)) * Math.cos(this.degToRad(lat2))
      * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * 计算两个GPS点之间的方位角（度）
     */
    public calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const lat1Rad = this.degToRad(lat1);
      const lat2Rad = this.degToRad(lat2);
      const dLonRad = this.degToRad(lon2 - lon1);
  
      const y = Math.sin(dLonRad) * Math.cos(lat2Rad);
      const x = Math.cos(lat1Rad) * Math.sin(lat2Rad)
        - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);
  
      const bearing = this.radToDeg(Math.atan2(y, x));
  
      return (bearing + 360) % 360;
    }
  
    /**
     * 将GPS坐标转换为UTM坐标（简化接口）
     * 返回zone, easting, northing
     */
    public toUTM(latitude: number, longitude: number): { zone: number; easting: number; northing: number } {
      const utm = this.latLonToUTM(latitude, longitude);
      return {
        zone: utm.zoneNumber,
        easting: utm.easting,
        northing: utm.northing
      };
    }
  
    /**
     * 将UTM坐标转换为GPS坐标（简化接口）
     */
    public toLatLon(utm: { zone: number; easting: number; northing: number }): { latitude: number; longitude: number; altitude: number } {
      // 正确估计纬度：
      // 北半球：northing 是从赤道开始的距离（米）
      // 南半球：northing 是从南极开始的距离 - 10,000,000 米的偏移
      // 判断方法：如果 northing < 0 或者在南半球区域，使用 false northing
      
      // 对于北半球（中国天津在北半球，zone 50），northing 直接代表从赤道的距离
      // 纬度 ≈ northing / 111000（每度纬度约111公里）
      let approxLat: number;
      let zoneLetter: string;
      
      // 根据UTM规范，南半球的 northing 会有 false northing (10,000,000m)
      // 北半球的 northing 从赤道开始计算
      // 中国天津纬度约39度，northing 约 4,321,423 米
      // 如果 northing 在合理范围内（0-10,000,000），假设为北半球
      if (utm.northing >= 0 && utm.northing < 10000000) {
        // 北半球
        approxLat = utm.northing / 111000;
        zoneLetter = this.getUTMLetterDesignator(approxLat);
      } else if (utm.northing >= 10000000) {
        // 可能是南半球的 false northing，或者高纬度北半球
        // 尝试北半球解释
        approxLat = utm.northing / 111000;
        if (approxLat <= 84) {
          zoneLetter = this.getUTMLetterDesignator(approxLat);
        } else {
          // 超出正常范围，使用南半球解释
          approxLat = (utm.northing - 10000000) / 111000;
          zoneLetter = this.getUTMLetterDesignator(approxLat);
        }
      } else {
        // 负值，南半球
        approxLat = (utm.northing + 10000000) / 111000;
        zoneLetter = this.getUTMLetterDesignator(approxLat);
      }
      
      const result = this.utmToLatLon(utm.easting, utm.northing, utm.zone, zoneLetter);
      return {
        latitude: result.latitude,
        longitude: result.longitude,
        altitude: 0
      };
    }
  }
