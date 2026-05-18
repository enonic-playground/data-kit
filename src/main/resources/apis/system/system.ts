import { getVersion } from '/lib/xp/admin';

import type { Request, Response } from '@enonic-types/core';

import { jsonResponse, requireAdmin } from '../../lib/api';

type SystemInfo = {
  xpVersion: string;
  appName: string;
  appVersion: string;
  javaVersion: string;
  javaVendor: string;
  osName: string;
  osArch: string;
  osVersion: string;
  xpHome: string;
  diskTotal: number;
  diskUsable: number;
};

export function get(_req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const provider = __.newBean<SystemInfoProvider>('com.enonic.app.datakit.SystemInfoProvider');

  const info: SystemInfo = {
    xpVersion: getVersion(),
    appName: app.name,
    appVersion: app.version,
    javaVersion: provider.getJavaVersion(),
    javaVendor: provider.getJavaVendor(),
    osName: provider.getOsName(),
    osArch: provider.getOsArch(),
    osVersion: provider.getOsVersion(),
    xpHome: provider.getXpHome(),
    diskTotal: provider.getDiskTotal(),
    diskUsable: provider.getDiskUsable(),
  };

  return jsonResponse(info);
}
