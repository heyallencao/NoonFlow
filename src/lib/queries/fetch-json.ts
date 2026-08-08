export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parse failures and keep the generic error.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
