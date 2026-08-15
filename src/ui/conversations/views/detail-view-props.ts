export type DetailViewSharedProps = {
  selected: any;
  activeId: unknown;
  detail: any;
  imageAssetResolver: (assetId: number) => Promise<Readonly<{ blob: Blob }> | null>;
  listError?: string | null;
  loadingDetail?: boolean;
  detailError?: string | null;
  setMessagesRootRef: (node: HTMLDivElement | null) => void;
};
