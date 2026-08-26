export type DetailHeaderActionKind = 'external-link' | 'open-target' | 'copy-text';

export type DetailHeaderActionProvider = string;

export type DetailHeaderActionSlot = 'open' | 'copy' | 'tools';

export type DetailHeaderAction = {
  id: string;
  label: string;
  kind: DetailHeaderActionKind;
  provider: DetailHeaderActionProvider;
  slot: DetailHeaderActionSlot;
  disabled?: boolean;
  href?: string;
  afterTriggerLabel?: string;
  onTrigger: () => Promise<void>;
};

export type DetailHeaderActionPort = {
  openExternalUrl: (url: string) => Promise<boolean>;
  launchProtocolUrl: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  reportError: (message: string) => void;
};
