/**
 * 控制栏视图模型：由内容脚本持有并原地修改，组件只读。
 *
 * 字段全部是原始值（没有嵌套对象/数组），这样 `reactive()` 的写入路径最短，
 * 也不会出现"组件里改了对象父级看不到"的问题。
 */

export interface ControlBarModel {
  /** 图片识别是否运行中。 */
  running: boolean;
  /** 页面内候选漫画图总数。 */
  count: number;
  /** 视口附近（±1 屏）的候选图数量。 */
  nearViewportCount: number;
  /** 是否深色主题（由页面偏好或用户设置决定）。 */
  dark: boolean;
  /** 是否已配置服务地址、模型与 API Key。 */
  providerReady: boolean;
  /** 是否正在翻译。 */
  translating: boolean;
  /** 本轮计划翻译的图片数。 */
  translateTotal: number;
  /** 已成功返回的图片数。 */
  translatedCount: number;
  /** 失败的图片数。 */
  failedCount: number;
  /** 已拿到的文字区域总数。 */
  regionCount: number;
  /** 最近一条错误提示（成功时清空）。 */
  lastError: string | null;
}
