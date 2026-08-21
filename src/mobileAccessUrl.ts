import { withBasePath } from "../common/basePath";
import { APP_BASE_PATH } from "./basePath";

export const MOBILE_ACCESS_PATH = "/mobile";

export function mobileAccessPath(basePath: string = APP_BASE_PATH): string {
  return withBasePath(MOBILE_ACCESS_PATH, basePath);
}

export function mobileAccessUrl(origin: string = window.location.origin, basePath: string = APP_BASE_PATH): string {
  return `${origin}${mobileAccessPath(basePath)}`;
}
