const noExtractor = () => null;

// ponytail: generic article capture only; add an explicit site extractor before restoring special extraction.
export const ExtractorRegistry = {
  findExtractor: noExtractor,
  findAsyncExtractor: noExtractor,
  findPreferredAsyncExtractor: noExtractor,
};
