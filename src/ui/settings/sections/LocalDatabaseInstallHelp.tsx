import { t } from '@i18n';
import type { LocalDataMigrationStatus } from '@services/local-data/migration-status';
import { buttonClassName } from '@ui/settings/ui';

export const SYNCNOS_CLI_INSTALL_COMMAND = 'npm install -g @chiimagnus/syncnoscli' as const;
export const SYNCNOS_CLI_AI_PROMPT = `请你安装SyncNos CLI：${SYNCNOS_CLI_INSTALL_COMMAND}` as const;
export const SYNCNOS_CLI_DOCTOR_COMMAND = 'syncnoscli doctor --fix' as const;

export type LocalDatabaseInstallHelpProps = Readonly<{
  copiedText: string;
  onCopyText: (text: string) => void;
  status: LocalDataMigrationStatus;
}>;

function hasDiagnostic(status: LocalDataMigrationStatus, code: string): boolean {
  return status.diagnostics.some((diagnostic) => diagnostic.code === code);
}

function CopyRow(
  props: Readonly<{ label: string; text: string; copiedText: string; onCopyText: (text: string) => void }>,
) {
  const copied = props.copiedText === props.text;
  return (
    <div className="tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-2.5">
      <div className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">{props.label}</div>
      <div className="tw-mt-1.5 tw-flex tw-items-start tw-gap-2">
        <code className="tw-min-w-0 tw-flex-1 tw-overflow-x-auto tw-whitespace-nowrap tw-rounded tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1.5 tw-text-xs tw-text-[var(--text-primary)]">
          {props.text}
        </code>
        <button type="button" className={buttonClassName} onClick={() => props.onCopyText(props.text)}>
          {copied ? t('localDatabaseCopied') : t('localDatabaseCopyAction')}
        </button>
      </div>
    </div>
  );
}

export function LocalDatabaseInstallHelp(props: LocalDatabaseInstallHelpProps) {
  const { status } = props;
  if (status.capability.browser === 'safari') {
    return (
      <div className="tw-mt-3 tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3 tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
        {t('localDatabaseSafariNoInstallHelp')}
      </div>
    );
  }
  if (!status.capability.officialIdentity || status.capability.browser === 'development') {
    return (
      <div className="tw-mt-3 tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3 tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
        {t('localDatabaseDevelopmentIdentityHelp')}
      </div>
    );
  }

  const hostUnavailable = status.host.registration === 'unavailable';
  const hostMismatch =
    status.host.compatibility === 'protocol_mismatch' || status.host.compatibility === 'schema_mismatch';
  const unsupportedRuntime =
    status.host.compatibility === 'unsupported' || hasDiagnostic(status, 'UNSUPPORTED_PLATFORM');
  const permissionDenied = hasDiagnostic(status, 'ORIGIN_DENIED');
  const busy = hasDiagnostic(status, 'BUSY');
  const integrityFailure = hasDiagnostic(status, 'JOURNAL_CORRUPT');
  if (!hostUnavailable && !hostMismatch && !unsupportedRuntime && !permissionDenied && !busy && !integrityFailure)
    return null;

  const showInstall = hostUnavailable || hostMismatch || unsupportedRuntime;
  const showDoctor = hostUnavailable || hostMismatch || unsupportedRuntime || permissionDenied || integrityFailure;
  const summary = hostUnavailable
    ? t('localDatabaseHostMissingHelp')
    : hostMismatch
      ? t('localDatabaseHostMismatchHelp')
      : unsupportedRuntime
        ? t('localDatabaseUnsupportedRuntimeHelp')
        : permissionDenied
          ? t('localDatabasePermissionHelp')
          : busy
            ? t('localDatabaseBusyHelp')
            : t('localDatabaseIntegrityHelp');

  return (
    <div className="tw-mt-3 tw-space-y-2.5" aria-label={t('localDatabaseInstallHelpTitle')}>
      <div className="tw-text-xs tw-font-bold tw-leading-5 tw-text-[var(--text-secondary)]">{summary}</div>

      {showInstall ? (
        <>
          <CopyRow
            label={t('localDatabaseInstallCommandLabel')}
            text={SYNCNOS_CLI_INSTALL_COMMAND}
            copiedText={props.copiedText}
            onCopyText={props.onCopyText}
          />
          <CopyRow
            label={t('localDatabaseAiPromptLabel')}
            text={SYNCNOS_CLI_AI_PROMPT}
            copiedText={props.copiedText}
            onCopyText={props.onCopyText}
          />
          <div className="tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
            {t('localDatabaseNodeRequirementHelp')}
          </div>
        </>
      ) : null}

      {showDoctor ? (
        <CopyRow
          label={t('localDatabaseDoctorCommandLabel')}
          text={SYNCNOS_CLI_DOCTOR_COMMAND}
          copiedText={props.copiedText}
          onCopyText={props.onCopyText}
        />
      ) : null}
      {showDoctor ? (
        <div className="tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
          {t('localDatabaseDoctorScopeHelp')}
        </div>
      ) : null}
      {status.capability.platform === 'linux' ? (
        <div className="tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2.5 tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
          {t('localDatabaseLinuxSandboxHelp')}
        </div>
      ) : null}
    </div>
  );
}
