export type MentionCandidate = {
  conversationId: number;
  title: string;
  source: string;
  domain: string;
  lastActivityAt: number;
};

export type MentionSearchResult = {
  candidates: MentionCandidate[];
};
