export type MentionCandidate = {
  conversationId: number;
  title: string;
  source: string;
  domain: string;
  lastCapturedAt: number;
};

export type MentionSearchResult = {
  candidates: MentionCandidate[];
};


