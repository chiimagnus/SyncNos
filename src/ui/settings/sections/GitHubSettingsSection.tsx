import type { KeyboardEvent } from 'react';

import { t } from '@i18n';
import { SettingsFormRow } from '@ui/settings/sections/SettingsFormRow';
import {
  buttonClassName,
  cardClassName,
  checkboxClassName,
  dangerButtonClassName,
  primaryButtonClassName,
  textInputClassName,
} from '@ui/settings/ui';
import { SelectMenu } from '@ui/shared/SelectMenu';

type GithubAuthSummary =
  | { state: 'disconnected' }
  | { state: 'connected' }
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number; nextPollAt: number };

type GithubRepositoryOption = {
  fullName: string;
  contentWriteCapable: boolean;
};

type GithubConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'uninitialized' }
  | { status: 'initializing' }
  | { status: 'success'; target: { repository: string; branch: string; remoteKey: string } }
  | { status: 'error'; error: string };

export function GitHubSettingsSection(props: {
  busy: boolean;
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  auth: GithubAuthSummary;
  account: { login: string; avatarUrl: string; url: string } | null;
  repositoryStatus: 'ready' | 'github_app_not_installed' | 'github_no_accessible_repositories' | null;
  repositories: GithubRepositoryOption[];
  targetUnavailable: boolean;
  repository: string;
  branch: string;
  verificationUrl: string;
  appUrl: string;
  installUrl: string;
  connectionTest: GithubConnectionTestState;
  githubLogoUrl: string;
  onToggleSyncEnabled: (enabled: boolean) => void;
  onToggleAutoSyncEnabled: (enabled: boolean) => void;
  onConnect: () => void;
  onCancelDeviceFlow: () => void;
  onDisconnect: () => void;
  onRefreshRepositories: () => void;
  onChangeRepository: (repository: string) => void;
  onChangeBranch: (branch: string) => void;
  onSaveBranch: () => void;
  onTestConnection: () => void;
  onInitializeRepository: () => void;
}) {
  const {
    busy,
    syncEnabled,
    autoSyncEnabled,
    auth,
    account,
    repositoryStatus,
    repositories,
    targetUnavailable,
    repository,
    branch,
    verificationUrl,
    appUrl,
    installUrl,
    connectionTest,
    githubLogoUrl,
    onToggleSyncEnabled,
    onToggleAutoSyncEnabled,
    onConnect,
    onCancelDeviceFlow,
    onDisconnect,
    onRefreshRepositories,
    onChangeRepository,
    onChangeBranch,
    onSaveBranch,
    onTestConnection,
    onInitializeRepository,
  } = props;

  const repositoryOptions = [
    ...(repository && targetUnavailable
      ? [{ value: repository, label: `${repository} — ${t('githubRepositoryUnavailable')}`, disabled: true }]
      : []),
    ...repositories
      .filter((item) => !(targetUnavailable && item.fullName === repository))
      .map((item) => ({
        value: item.fullName,
        label: item.contentWriteCapable ? item.fullName : `${item.fullName} — ${t('githubRepositoryReadOnly')}`,
        disabled: !item.contentWriteCapable,
      })),
  ];
  if (!repositoryOptions.length) {
    repositoryOptions.push({ value: '', label: t('githubRepositoryPlaceholder'), disabled: true });
  }

  const onSaveKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onSaveBranch();
  };

  const connectedStatus = account?.login ? `${t('githubConnectedAs')} ${account.login}` : t('githubConnected');
  const testStatus =
    connectionTest.status === 'testing'
      ? t('statusTesting')
      : connectionTest.status === 'initializing'
        ? t('githubInitializingRepository')
        : connectionTest.status === 'uninitialized'
          ? t('githubRepositoryUninitializedHint')
          : connectionTest.status === 'success'
            ? `${t('githubTestSuccess')} · ${connectionTest.target.remoteKey}`
            : connectionTest.status === 'error'
              ? `${t('statusError')}: ${connectionTest.error}`
              : '';

  return (
    <>
      <section className={cardClassName} aria-label={t('githubSettingsTitle')}>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-inline-flex tw-h-6 tw-w-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-[var(--radius-control)] tw-bg-white tw-p-0.5">
            <img className="tw-h-5 tw-w-5" src={githubLogoUrl} alt="" aria-hidden="true" />
          </span>
          <div className="tw-min-w-0 tw-flex-1">
            <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
              {t('githubSettingsTitle')}
            </h2>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {auth.state === 'connected'
                ? connectedStatus
                : auth.state === 'pending'
                  ? t('githubStatusWaiting')
                  : t('statusNotConnected')}
            </div>
          </div>
          {auth.state === 'disconnected' ? (
            <button type="button" className={primaryButtonClassName} onClick={onConnect} disabled={busy}>
              {t('githubConnect')}
            </button>
          ) : auth.state === 'connected' ? (
            <button type="button" className={dangerButtonClassName} onClick={onDisconnect} disabled={busy}>
              {t('disconnect')}
            </button>
          ) : null}
        </div>

        <div className="tw-mt-3 tw-grid tw-gap-2">
          <SettingsFormRow label={t('githubSyncEnabledLabel')}>
            <input
              id="githubSyncEnabledToggle"
              type="checkbox"
              className={checkboxClassName}
              checked={syncEnabled}
              disabled={busy}
              aria-label={t('githubSyncEnabledLabel')}
              onChange={(event) => onToggleSyncEnabled(event.target.checked)}
            />
          </SettingsFormRow>
          {syncEnabled ? (
            <SettingsFormRow label={t('githubAutoSyncEnabledLabel')}>
              <input
                id="githubAutoSyncEnabledToggle"
                type="checkbox"
                className={checkboxClassName}
                checked={autoSyncEnabled}
                disabled={busy}
                aria-label={t('githubAutoSyncEnabledLabel')}
                onChange={(event) => onToggleAutoSyncEnabled(event.target.checked)}
              />
            </SettingsFormRow>
          ) : null}
        </div>

        {auth.state === 'pending' ? (
          <div className="tw-mt-3 tw-grid tw-gap-2 tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('githubDeviceCodeLabel')}
            </div>
            <code
              className="tw-select-all tw-break-all tw-text-lg tw-font-black tw-tracking-[0.12em] tw-text-[var(--text-primary)]"
              data-github-device-user-code="true"
            >
              {auth.userCode}
            </code>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('githubDeviceInstruction')}
            </div>
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('githubDeviceExpiresAt')}: {new Date(auth.expiresAt).toLocaleTimeString()}
            </div>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              <a
                className={primaryButtonClassName}
                href={verificationUrl}
                target="_blank"
                rel="noreferrer"
                data-github-device-link="true"
              >
                {t('githubOpenDevicePage')}
              </a>
              <button type="button" className={buttonClassName} onClick={onCancelDeviceFlow} disabled={busy}>
                {t('githubCancelDeviceFlow')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {auth.state === 'connected' ? (
        <>
          <section className={cardClassName} aria-label={t('githubRepositoryLabel')}>
            <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
              {t('githubRepositoryLabel')}
            </h2>

            <div className="tw-mt-3 tw-grid tw-gap-2">
              {repositoryStatus === 'github_app_not_installed' ? (
                <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  {t('githubInstallRequired')}
                </div>
              ) : repositoryStatus === 'github_no_accessible_repositories' ? (
                <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  {t('githubNoAccessibleRepositories')}
                </div>
              ) : null}

              <SettingsFormRow label={t('githubRepositoryLabel')}>
                <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                  <SelectMenu<string>
                    buttonId="githubRepository"
                    className="tw-min-w-0 tw-flex-1"
                    buttonClassName={`${buttonClassName} tw-w-full`}
                    value={repository}
                    options={repositoryOptions}
                    disabled={busy || repositoryStatus !== 'ready'}
                    ariaLabel={t('githubRepositoryLabel')}
                    maxHeight={360}
                    onChange={onChangeRepository}
                  />
                  <button
                    type="button"
                    title={t('refresh')}
                    onClick={onRefreshRepositories}
                    disabled={busy}
                    className="webclipper-btn webclipper-btn--icon"
                    aria-label={t('githubRefreshRepositories')}
                  >
                    ↻
                  </button>
                </div>
              </SettingsFormRow>

              {targetUnavailable ? (
                <div className="tw-text-xs tw-font-semibold tw-text-[var(--error)]" role="status">
                  {t('githubTargetUnavailableHint')}
                </div>
              ) : null}

              <SettingsFormRow label={t('githubBranchLabel')}>
                <input
                  value={branch}
                  onChange={(event) => onChangeBranch(event.target.value)}
                  onBlur={onSaveBranch}
                  onKeyDown={onSaveKeyDown}
                  disabled={busy || !repository || targetUnavailable}
                  spellCheck={false}
                  placeholder="main"
                  className={textInputClassName}
                  aria-label={t('githubBranchLabel')}
                />
              </SettingsFormRow>

              <div className="tw-flex tw-flex-wrap tw-gap-2">
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={onTestConnection}
                  disabled={
                    busy ||
                    !repository ||
                    targetUnavailable ||
                    connectionTest.status === 'testing' ||
                    connectionTest.status === 'initializing'
                  }
                >
                  {t('githubTestConnection')}
                </button>
                {connectionTest.status === 'uninitialized' || connectionTest.status === 'initializing' ? (
                  <button
                    type="button"
                    className={primaryButtonClassName}
                    onClick={onInitializeRepository}
                    disabled={busy || connectionTest.status === 'initializing'}
                  >
                    {connectionTest.status === 'initializing'
                      ? t('githubInitializingRepository')
                      : t('githubInitializeRepository')}
                  </button>
                ) : null}
                <a
                  className={buttonClassName}
                  href={repositoryStatus === 'github_app_not_installed' ? installUrl : appUrl || installUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('githubInstallOrConfigureApp')}
                </a>
              </div>

              {testStatus ? (
                <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]" role="status">
                  {testStatus}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
