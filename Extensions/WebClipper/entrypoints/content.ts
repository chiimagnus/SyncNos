export default defineContentScript({
  // P1: temporary match-all for scaffolding verification.
  // P1-05 will align this to the current manifest's supported sites/strategy.
  matches: ['http://*/*', 'https://*/*'],
  main() {
    console.log('WebClipper content (WXT)');
  },
});

