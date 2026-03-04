/** Replaces all occurrences of apiKey in a string with '[REDACTED_KEY]' */
export const redactKey = (text: string, apiKey: string): string =>
	apiKey.length > 0 ? text.split(apiKey).join('[REDACTED_KEY]') : text;
