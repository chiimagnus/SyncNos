import { assertCollectorDef, type CollectorDefinition } from '@collectors/collector-contract.ts';

type CollectorLocation = {
  href?: string;
  hostname?: string;
  pathname?: string;
};

export function createCollectorsRegistry() {
  const definitions: CollectorDefinition[] = [];

  function register(definition: CollectorDefinition): boolean {
    const checked = assertCollectorDef(definition);
    if (definitions.some((item) => item.id === checked.id)) return false;
    definitions.push(checked);
    return true;
  }

  function pickActive(locationArg?: CollectorLocation): CollectorDefinition | null {
    const locationValue = locationArg || {
      href: location.href,
      hostname: location.hostname,
      pathname: location.pathname,
    };
    for (const definition of definitions) {
      try {
        if (definition.matches(locationValue)) return definition;
      } catch (_e) {
        // ignore and keep trying others
      }
    }
    return null;
  }

  function list() {
    return definitions.slice();
  }

  return { register, pickActive, list };
}

export type CollectorsRegistry = ReturnType<typeof createCollectorsRegistry>;
