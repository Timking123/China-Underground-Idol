import "ip2region.js";
// 3.1.8 已导出此校验函数，但其官方声明暂未覆盖；不改变运行时代码。
declare module "ip2region.js" {
  export function verify(fd: number): void;
}
