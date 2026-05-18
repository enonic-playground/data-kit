import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import {
  Boxes,
  Coffee,
  ExternalLink,
  Info,
  Monitor,
  Moon,
  Package,
  Palette,
  Sun,
  SunMoon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement, ReactNode } from 'react';

import { useTheme } from '../components/theme-provider';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Progress } from '../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { systemInfoQueryOptions } from '../lib/api/system';

const DOCS_URL = 'https://developer.enonic.com';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '\u2014';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

//
// * InfoRow
//

type InfoRowProps = {
  label: string;
  children: ReactNode;
};

const INFO_ROW_NAME = 'InfoRow';

const InfoRow = ({ label, children }: InfoRowProps): ReactElement => {
  return (
    <div
      data-component={INFO_ROW_NAME}
      className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm"
    >
      <dt className="text-muted-foreground font-medium">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
};

InfoRow.displayName = INFO_ROW_NAME;

//
// * DiskUsage
//

type DiskUsageProps = {
  total: number;
  usable: number;
};

const DISK_USAGE_NAME = 'DiskUsage';

const DiskUsage = ({ total, usable }: DiskUsageProps): ReactElement | null => {
  const { t } = useTranslation();
  if (total <= 0) return null;

  const used = Math.max(total - usable, 0);
  const percent = Math.min(100, Math.round((used / total) * 100));

  return (
    <div data-component={DISK_USAGE_NAME} className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          {t('system.disk.usage', { used: formatBytes(used), total: formatBytes(total) })}
        </span>
        <span>{percent}%</span>
      </div>
      <Progress value={percent} />
    </div>
  );
};

DiskUsage.displayName = DISK_USAGE_NAME;

//
// * ThemeSettings
//

const THEME_SETTINGS_NAME = 'ThemeSettings';

const ThemeSettings = (): ReactElement => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div
      data-component={THEME_SETTINGS_NAME}
      className="grid grid-cols-[8rem_1fr] items-center gap-x-4 text-sm"
    >
      <span className="text-muted-foreground font-medium">{t('system.field.theme')}</span>
      <Select
        value={theme}
        onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
      >
        <SelectTrigger className="max-w-48" aria-label={t('system.field.theme')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">
            <span className="flex items-center gap-2">
              <Sun className="size-4" />
              {t('theme.light')}
            </span>
          </SelectItem>
          <SelectItem value="dark">
            <span className="flex items-center gap-2">
              <Moon className="size-4" />
              {t('theme.dark')}
            </span>
          </SelectItem>
          <SelectItem value="system">
            <span className="flex items-center gap-2">
              <SunMoon className="size-4" />
              {t('theme.system')}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

ThemeSettings.displayName = THEME_SETTINGS_NAME;

//
// * SystemPage
//

const SYSTEM_PAGE_NAME = 'SystemPage';

const SystemPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data: info } = useSuspenseQuery(systemInfoQueryOptions());

  return (
    <div data-component={SYSTEM_PAGE_NAME} className="flex flex-col gap-4 p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SystemCard icon={<Boxes className="size-5" />} title={t('system.card.xpRuntime')}>
          <InfoRow label={t('system.field.version')}>{info.xpVersion}</InfoRow>
          <InfoRow label={t('system.field.home')}>
            <span className="font-mono text-xs">{info.xpHome}</span>
          </InfoRow>
          <DiskUsage total={info.diskTotal} usable={info.diskUsable} />
        </SystemCard>

        <SystemCard icon={<Package className="size-5" />} title={t('system.card.application')}>
          <InfoRow label={t('system.field.key')}>
            <span className="font-mono text-xs">{info.appName}</span>
          </InfoRow>
          <InfoRow label={t('system.field.version')}>{info.appVersion}</InfoRow>
        </SystemCard>

        <SystemCard icon={<Coffee className="size-5" />} title={t('system.card.javaRuntime')}>
          <InfoRow label={t('system.field.version')}>{info.javaVersion}</InfoRow>
          <InfoRow label={t('system.field.vendor')}>{info.javaVendor}</InfoRow>
        </SystemCard>

        <SystemCard icon={<Monitor className="size-5" />} title={t('system.card.os')}>
          <InfoRow label={t('system.field.name')}>{info.osName}</InfoRow>
          <InfoRow label={t('system.field.architecture')}>{info.osArch}</InfoRow>
          <InfoRow label={t('system.field.version')}>{info.osVersion}</InfoRow>
        </SystemCard>
      </div>

      <SystemCard icon={<Palette className="size-5" />} title={t('system.card.appearance')}>
        <ThemeSettings />
      </SystemCard>

      <div className="flex items-center justify-end px-1">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          {t('system.docs.link')}
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
};

SystemPage.displayName = SYSTEM_PAGE_NAME;

//
// * SystemCard
//

type SystemCardProps = {
  icon: ReactNode;
  title: string;
  children: ReactNode;
};

const SYSTEM_CARD_NAME = 'SystemCard';

const SystemCard = ({ icon, title, children }: SystemCardProps): ReactElement => {
  return (
    <Card data-component={SYSTEM_CARD_NAME}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">{children}</dl>
      </CardContent>
    </Card>
  );
};

SystemCard.displayName = SYSTEM_CARD_NAME;

//
// * SystemError
//

const SYSTEM_ERROR_NAME = 'SystemError';

const SystemError = ({ error }: ErrorComponentProps): ReactElement => {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : t('common.error.unexpected');

  return (
    <div data-component={SYSTEM_ERROR_NAME} className="flex flex-col gap-4 p-4">
      <EmptyState icon={Info} title={t('system.error.loadFailed')} description={message} />
    </div>
  );
};

SystemError.displayName = SYSTEM_ERROR_NAME;

export const Route = createFileRoute('/system')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(systemInfoQueryOptions()),
  component: SystemPage,
  errorComponent: SystemError,
});
