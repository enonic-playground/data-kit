declare interface SystemInfoProvider {
  getJavaVersion: () => string;
  getJavaVendor: () => string;
  getOsName: () => string;
  getOsArch: () => string;
  getOsVersion: () => string;
  getXpHome: () => string;
  getDiskTotal: () => number;
  getDiskUsable: () => number;
}

interface XpBeans {
  'com.enonic.app.datakit.SystemInfoProvider': SystemInfoProvider;
}
