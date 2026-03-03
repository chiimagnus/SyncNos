let backgroundInstanceId: string | null = null;

function createInstanceId(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getBackgroundInstanceId(): string {
  if (!backgroundInstanceId) backgroundInstanceId = createInstanceId();
  return backgroundInstanceId;
}

