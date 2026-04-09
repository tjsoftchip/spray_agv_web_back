/**
 * 作业路线规划器 - Facade入口
 * 使用模块化的RouteBuilder实现
 */

import { RouteBuilder } from './route_planner/routeBuilder';
import { JobRoute, BeamPosition, RouteSegment } from './route_planner/types';

export class JobRoutePlanner {
  private builder: RouteBuilder;

  constructor() {
    this.builder = new RouteBuilder();
  }

  /**
   * 加载数据文件
   */
  loadData(mapsDir: string): boolean {
    return this.builder.loadData(mapsDir);
  }

  /**
   * 规划作业路线
   */
  planJobRoute(beamIds: string[]): JobRoute {
    return this.builder.buildRoute(beamIds);
  }

  /**
   * 生成YAML格式路线
   */
  generateYAMLRoute(route: JobRoute): string {
    return this.builder.generateYAML(route);
  }
}

// 导出类型
export { JobRoute, BeamPosition, RouteSegment };

// 导出单例
export const jobRoutePlanner = new JobRoutePlanner();