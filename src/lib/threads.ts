export const DEFAULT_AGENT_NAME = 'research-agent';
export const NEW_THREAD_TITLE = 'New thread';

export type ThreadSummary = {
	id: string;
	agentName: string;
	title: string;
	hasActivity: boolean;
	createdAt: string;
	updatedAt: string;
};
