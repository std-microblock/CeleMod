import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const describeRequest = (input: Parameters<typeof tauriFetch>[0]) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
};

export const fetch = async (...args: Parameters<typeof tauriFetch>) => {
  const request = describeRequest(args[0]);
  try {
    const response = await tauriFetch(...args);
    if (!response.ok) {
      console.error(
        `HTTP request failed: ${request} returned ${response.status} ${response.statusText}`,
      );
    }
    return response;
  } catch (error) {
    console.error(`HTTP request failed: ${request}`, error);
    throw error;
  }
};
