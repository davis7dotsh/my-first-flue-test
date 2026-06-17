import { DEFAULT_AGENT_NAME } from '$lib/threads';

export type FlueAgentTarget = {
	agentName: typeof DEFAULT_AGENT_NAME;
	threadId: string;
};

export function parseFlueAgentPath(path: string): FlueAgentTarget | null {
	const [resource, encodedAgentName, encodedThreadId, ...rest] = path.split('/');
	if (resource !== 'agents' || !encodedAgentName || !encodedThreadId || rest.length > 0) {
		return null;
	}

	try {
		const agentName = decodeURIComponent(encodedAgentName);
		const threadId = decodeURIComponent(encodedThreadId);
		if (agentName !== DEFAULT_AGENT_NAME || !threadId) {
			return null;
		}

		return { agentName, threadId };
	} catch {
		return null;
	}
}
